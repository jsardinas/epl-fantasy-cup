-- Bonus points per team and gameweek: sum of stats.bonus over the final lineup
-- (starting 11 with automatic subs applied). Written by epl-fantasy-function.
alter table team_points add column if not exists bonus integer not null default 0;
