-- Group membership per cup. seed = order inside the group; it breaks a full
-- tie on points, highest score and bonus points.
create table if not exists cup_groups (
  cup_id     integer  not null references cups(id) on delete cascade,
  team_id    integer  not null references teams(id),
  group_name text     not null check (group_name ~ '^[A-Z]$'),
  seed       smallint not null check (seed between 1 and 4),
  primary key (cup_id, team_id),
  unique (cup_id, group_name, seed)
);

-- Cup 1 (Copa de Invierno) groups, same order as the old hard-coded GROUPS.
insert into cup_groups (cup_id, team_id, group_name, seed) values
  (1,  1, 'A', 1), (1,  5, 'A', 2), (1,  2, 'A', 3), (1, 12, 'A', 4),
  (1,  4, 'B', 1), (1,  8, 'B', 2), (1,  9, 'B', 3), (1, 10, 'B', 4),
  (1, 11, 'C', 1), (1,  7, 'C', 2), (1,  6, 'C', 3), (1,  3, 'C', 4)
on conflict do nothing;
