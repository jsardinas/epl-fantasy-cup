// GET /api/standings?cup=1
// Group-phase totals per team for a cup, computed from team_points over the
// qualifier window: game weeks qualifier_start .. qualifier_start + qualifier_legs - 1.
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  const cupId = Number.parseInt(req.query?.cup ?? "1", 10);
  if (!Number.isInteger(cupId) || cupId < 1) {
    return res.status(400).json({ error: "Invalid cup id" });
  }
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: "DATABASE_URL is not configured" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    const [cup] = await sql`
      select id, btrim(name, E' \t\r\n') as name, season_id, qualifier_start, qualifier_legs,
             quarter_final_start, quarter_final_legs, semi_final_start, semi_final_legs,
             final_start, final_legs
      from cups where id = ${cupId}`;
    if (!cup) return res.status(404).json({ error: `Cup ${cupId} not found` });

    const gwFrom = cup.qualifier_start;
    const gwTo = cup.qualifier_start + cup.qualifier_legs - 1;

    // Knockout rounds: each covers game weeks start .. start + legs - 1.
    const round = (start, legs) => {
      const s = Number(start), n = Math.max(0, Number(legs) || 0);
      return Number.isInteger(s) ? { start: s, legs: n, gameWeeks: Array.from({ length: n }, (_, i) => s + i) } : null;
    };
    const rounds = {
      qf: round(cup.quarter_final_start, cup.quarter_final_legs),
      sf: round(cup.semi_final_start, cup.semi_final_legs),
      final: round(cup.final_start, cup.final_legs),
    };
    const koWeeks = [...new Set(Object.values(rounds).flatMap(r => (r ? r.gameWeeks : [])))];

    // Group membership for this cup, in seed order: { A: [teamId, ...], ... }.
    const groupRows = await sql`
      select group_name, team_id from cup_groups
      where cup_id = ${cupId} order by group_name, seed`;
    if (!groupRows.length) {
      return res.status(409).json({ error: `Cup ${cupId} has no groups configured` });
    }
    const groups = {};
    for (const r of groupRows) (groups[r.group_name] ||= []).push(r.team_id);
    const teamIds = groupRows.map(r => r.team_id);

    // Only this cup's teams. Left join so teams with no rows yet still appear with zeros.
    // Bonus points are not stored yet, so they are reported as 0.
    const teams = await sql`
      select t.id, t.name, t.manager,
             coalesce(t.cups, 0)::int as cups,
             coalesce(t.leagues, 0)::int as leagues,
             coalesce(sum(p.points), 0)::int as points,
             coalesce(max(p.points), 0)::int as high,
             0 as bonus,
             count(p.game_week)::int as weeks
      from cup_groups g
      join teams t on t.id = g.team_id
      left join team_points p
        on p.team_id = t.id
       and p.season_id = ${cup.season_id}
       and p.game_week between ${gwFrom} and ${gwTo}
      where g.cup_id = ${cupId}
      group by t.id, t.name, t.manager, t.cups, t.leagues
      order by t.id`;

    // Per-team, per-game-week points for every knockout game week: { teamId: { gw: points } }.
    const koRows = koWeeks.length
      ? await sql`
          select team_id, game_week, points from team_points
          where season_id = ${cup.season_id}
            and game_week = any(${koWeeks})
            and team_id = any(${teamIds})`
      : [];
    const koPoints = {};
    for (const r of koRows) (koPoints[r.team_id] ||= {})[r.game_week] = r.points;

    // Short edge cache only: DB edits (e.g. cups settings) show up within a minute.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    return res.status(200).json({
      cup: { id: cup.id, name: cup.name, seasonId: cup.season_id, gwFrom, gwTo, legs: cup.qualifier_legs },
      groups,
      teams,
      knockout: { rounds, points: koPoints },
    });
  } catch (err) {
    console.error("standings query failed", err);
    return res.status(500).json({ error: "Could not load standings" });
  }
}
