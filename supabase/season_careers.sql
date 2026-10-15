-- Race to the FedEx Cup careers saved to each member's account, so they follow you to any device.
-- One row per member and career slot (1 or 2); only that member can read or change it. `progress` ranks how far along a
-- career is (season, phase, week, holes/matches played); an update that would move a career
-- backwards is ignored, so the further-along copy always wins even if two devices save at once.
-- Abandoning a career deletes the row. Also folded into schema.sql. Safe to re-run.
create table if not exists season_careers (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  slot       smallint not null default 1 constraint season_careers_slot_check check (slot in (1, 2)),
  career     jsonb not null,
  progress   bigint not null,
  updated_at timestamptz not null default now(),
  constraint season_careers_pkey primary key (user_id, slot)
);
alter table season_careers enable row level security;
drop policy if exists season_careers_own on season_careers;
create policy season_careers_own on season_careers for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function season_careers_keep_further() returns trigger
language plpgsql as
$$
begin
  if new.progress < old.progress then
    return old;  -- an older copy from another device: keep the further-along career
  end if;
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists season_careers_keep_further on season_careers;
create trigger season_careers_keep_further before update on season_careers
  for each row execute function season_careers_keep_further();
