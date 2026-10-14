-- Admin -> Golfer Stats: pasted season stats the Play tab uses as each golfer's baseline.
-- Anyone can read them (the game runs before sign-in too); only admins write. Also folded into
-- schema.sql. Safe to re-run.
create table if not exists golfer_stats (
  player_id   text primary key,
  player_name text not null,
  stats       jsonb not null default '{}'::jsonb,   -- keys as in CONTRACTS.md (sg_ott, drive_dist, gir, ...)
  updated_at  timestamptz not null default now()
);
alter table golfer_stats enable row level security;
drop policy if exists golfer_stats_read on golfer_stats;
create policy golfer_stats_read on golfer_stats for select using (true);
drop policy if exists golfer_stats_write on golfer_stats;
create policy golfer_stats_write on golfer_stats for all using (is_admin()) with check (is_admin());
