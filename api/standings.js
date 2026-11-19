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
      select id, btrim(name, E' \t\r\n') as name, season_id, qualifier_start, qualifier_legs
      from cups where id = ${cupId}`;
    if (!cup) return res.status(404).json({ error: `Cup ${cupId} not found` });

    const gwFrom = cup.qualifier_start;
    const gwTo = cup.qualifier_start + cup.qualifier_legs - 1;

    // Left join so teams with no rows yet still appear with zeros.
    // Bonus points are not stored yet, so they are reported as 0.
    const teams = await sql`
      select t.id, t.name, t.manager,
             coalesce(sum(p.points), 0)::int as points,
             coalesce(max(p.points), 0)::int as high,
             0 as bonus,
             count(p.game_week)::int as weeks
      from teams t
      left join team_points p
        on p.team_id = t.id
       and p.season_id = ${cup.season_id}
       and p.game_week between ${gwFrom} and ${gwTo}
      group by t.id, t.name, t.manager
      order by t.id`;

    // Short edge cache only: DB edits (e.g. cups settings) show up within a minute.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    return res.status(200).json({
      cup: { id: cup.id, name: cup.name, seasonId: cup.season_id, gwFrom, gwTo, legs: cup.qualifier_legs },
      teams,
    });
  } catch (err) {
    console.error("standings query failed", err);
    return res.status(500).json({ error: "Could not load standings" });
  }
}
