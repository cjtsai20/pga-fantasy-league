-- PGA Fantasy League schema. Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
--
-- Rules enforced here (not just in the browser):
--   * signing up needs the league code (join_league), which no client can read
--   * two golfers per tournament plus one bonus pick where the event has one
--   * a golfer can be picked once per season (main slots); the error says so
--   * picks lock at the tournament's lock time; nobody sees anyone else's picks before then
--   * only admins (the commissioner) write fields and results, by pasting them on the Admin tab;
--     finalize_tournament() marks an event official and records the month's winners

-- ---------------------------------------------------------------- settings (private)
create table if not exists league_settings (
  key   text primary key,
  value text not null
);
alter table league_settings enable row level security;  -- no policies: invisible to every client

-- ---------------------------------------------------------------- members
create table if not exists profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null check (length(trim(display_name)) between 2 and 40),
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table profiles enable row level security;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid()) $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (is_member());
drop policy if exists profiles_rename on profiles;
create policy profiles_rename on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from profiles p where p.id = auth.uid()));

-- Called right after sign-up. Checks the code server-side and creates the member row.
create or replace function join_league(p_code text, p_display_name text) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.';
  end if;
  if not exists (select 1 from league_settings where key = 'league_code' and value = trim(p_code)) then
    raise exception 'That league code is not correct.';
  end if;
  insert into profiles (id, display_name) values (auth.uid(), trim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
end
$$;
revoke all on function join_league(text, text) from public, anon;
grant execute on function join_league(text, text) to authenticated;

-- ---------------------------------------------------------------- reference data (Action-owned)
create table if not exists tournaments (
  id           text primary key,              -- PGA TOUR tournament id, e.g. R2027006
  season       int  not null,
  name         text not null,
  start_date   date not null,
  end_date     date not null,
  month        text not null,                 -- 'YYYY-MM' the event counts toward (month of the final round)
  event_type   text not null,                 -- major | signature | players | regular | opposite | team
  course_id    text,
  course_name  text,
  location     text,
  lock_at      timestamptz not null,          -- picks close (first tee time)
  bonus_label  text,                          -- e.g. 'Amateur pick'; null = no bonus pick
  status       text not null default 'upcoming'  -- upcoming | in_progress | official
);

-- the 2026 league scored majors at 1.25x FedEx Cup points (e.g. Rahm T38 = 23 x 1.25 = 28.75)
alter table tournaments add column if not exists points_multiplier numeric(4,2) not null default 1;

create table if not exists field (
  tournament_id text references tournaments on delete cascade,
  player_id     text,
  player_name   text not null,
  is_amateur    boolean not null default false,
  fedex_eligible boolean not null default true,
  headshot_url  text,
  primary key (tournament_id, player_id)
);

create table if not exists results (
  tournament_id text references tournaments on delete cascade,
  player_id     text,
  player_name   text not null,
  position      text,                         -- '1', 'T2', 'CUT', 'WD'
  points        numeric(8,3) not null default 0,  -- FedEx Cup pts, or position-equivalent if ineligible
  is_projected  boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

alter table tournaments enable row level security;
alter table field enable row level security;
alter table results enable row level security;
drop policy if exists tournaments_read on tournaments;
create policy tournaments_read on tournaments for select using (true);
drop policy if exists field_read on field;
create policy field_read on field for select using (true);
drop policy if exists results_read on results;
create policy results_read on results for select using (true);

-- the commissioner pastes fields and results on the Admin tab
drop policy if exists field_admin on field;
create policy field_admin on field for all using (is_admin()) with check (is_admin());
drop policy if exists results_admin on results;
create policy results_admin on results for all using (is_admin()) with check (is_admin());
drop policy if exists tournaments_admin_status on tournaments;
create policy tournaments_admin_status on tournaments for update using (is_admin()) with check (is_admin());
revoke insert, update, delete on tournaments from anon, authenticated;
grant update (status) on tournaments to authenticated;   -- admins may change status only

-- ---------------------------------------------------------------- picks
create table if not exists picks (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references profiles on delete cascade,
  tournament_id text not null references tournaments on delete cascade,
  season        int  not null,
  slot          text not null check (slot in ('1', '2', 'bonus')),
  player_id     text not null,
  player_name   text not null,
  headshot_url  text,
  bonus_points  numeric(8,3),                 -- set by an admin for bonus picks only
  created_at    timestamptz not null default now(),
  unique (user_id, tournament_id, slot)
);
create unique index if not exists picks_once_per_season
  on picks (user_id, season, player_id) where slot in ('1', '2');

create or replace function picks_guard() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  t   tournaments%rowtype;
  dup text;
begin
  -- an admin scoring a bonus pick (anyone's, any time): only bonus_points may change
  if tg_op = 'UPDATE' and is_admin()
     and (new.user_id, new.tournament_id, new.slot, new.player_id) = (old.user_id, old.tournament_id, old.slot, old.player_id)
     and new.bonus_points is distinct from old.bonus_points then
    if new.slot <> 'bonus' then raise exception 'Only bonus picks take manual points.'; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    select * into t from tournaments where id = old.tournament_id;
    if now() >= t.lock_at then raise exception 'Picks for % are locked.', t.name; end if;
    return old;
  end if;

  select * into t from tournaments where id = new.tournament_id;
  if not found then raise exception 'Unknown tournament.'; end if;
  if now() >= t.lock_at then raise exception 'Picks for % are locked.', t.name; end if;
  new.season := t.season;
  new.user_id := auth.uid();
  new.bonus_points := case when tg_op = 'INSERT' then null else old.bonus_points end;

  if new.slot = 'bonus' then
    if t.bonus_label is null then raise exception '% has no bonus pick.', t.name; end if;
  else
    -- once the commissioner has pasted a field, picks must come from it; before that, any golfer
    if exists (select 1 from field f where f.tournament_id = t.id)
       and not exists (select 1 from field f where f.tournament_id = t.id and f.player_id = new.player_id) then
      raise exception '% is not in the field for %.', new.player_name, t.name;
    end if;
    select t2.name into dup
      from picks p join tournaments t2 on t2.id = p.tournament_id
     where p.user_id = new.user_id and p.season = new.season and p.player_id = new.player_id
       and p.slot in ('1', '2') and p.id is distinct from new.id;
    if dup is not null then
      raise exception 'You have already selected % this season (%).', new.player_name, dup;
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists picks_guard on picks;
create trigger picks_guard before insert or update or delete on picks
  for each row execute function picks_guard();

alter table picks enable row level security;
drop policy if exists picks_read on picks;
create policy picks_read on picks for select using (
  is_member() and (user_id = auth.uid()
    or now() >= (select t.lock_at from tournaments t where t.id = tournament_id)));
drop policy if exists picks_insert on picks;
create policy picks_insert on picks for insert with check (is_member() and user_id = auth.uid());
drop policy if exists picks_update on picks;
create policy picks_update on picks for update using (user_id = auth.uid() or is_admin());
drop policy if exists picks_delete on picks;
create policy picks_delete on picks for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------- scoring
drop view if exists pick_scores;
create view pick_scores with (security_invoker = true) as
select p.id as pick_id, p.user_id, pr.display_name, p.tournament_id, t.name as tournament_name,
       t.month, t.season, t.event_type, t.status, p.slot, p.player_id, p.player_name, p.headshot_url,
       r.position, p.bonus_points, t.points_multiplier,
       -- golfer picks: FedEx-equivalent points x the event's multiplier; bonus picks: as the admin scored them
       case when p.slot = 'bonus' then coalesce(p.bonus_points, 0)
            else round(coalesce(r.points, 0) * t.points_multiplier, 3) end as points,
       coalesce(r.is_projected, true) and p.slot <> 'bonus' as is_projected
  from picks p
  join profiles pr on pr.id = p.user_id
  join tournaments t on t.id = p.tournament_id
  left join results r on r.tournament_id = p.tournament_id and r.player_id = p.player_id;

create table if not exists monthly_winners (
  season       int  not null,
  month        text not null,                 -- 'YYYY-MM'
  user_id      uuid not null references profiles on delete cascade,
  display_name text not null,
  points       numeric(10,3) not null,
  recorded_at  timestamptz not null default now(),
  primary key (season, month, user_id)        -- ties: every tied member is a winner
);
alter table monthly_winners enable row level security;
drop policy if exists monthly_winners_read on monthly_winners;
create policy monthly_winners_read on monthly_winners for select using (is_member());

grant select on pick_scores to authenticated;

-- ---------------------------------------------------------------- finalizing results (admin)
-- Recompute one month's winners: every member tied on the top total, once all its events are official.
create or replace function record_month_winners(p_season int, p_month text) returns void
language plpgsql security definer set search_path = public as
$$
begin
  delete from monthly_winners where season = p_season and month = p_month;
  if exists (select 1 from tournaments where season = p_season and month = p_month and status <> 'official')
     or not exists (select 1 from tournaments where season = p_season and month = p_month) then
    return;
  end if;
  insert into monthly_winners (season, month, user_id, display_name, points)
  select season, month, user_id, display_name, total
    from (select s.season, s.month, s.user_id, s.display_name, sum(s.points) as total,
                 rank() over (order by sum(s.points) desc) as rk
            from pick_scores s   -- security_invoker view; this function runs as its owner, so it sees every pick
           where s.season = p_season and s.month = p_month
           group by s.season, s.month, s.user_id, s.display_name) m
   where rk = 1 and total > 0;
end
$$;
revoke all on function record_month_winners(int, text) from public, anon, authenticated;

create or replace function finalize_tournament(p_tournament_id text) returns void
language plpgsql security definer set search_path = public as
$$
declare t tournaments%rowtype;
begin
  if not is_admin() then raise exception 'Only the commissioner can finalize results.'; end if;
  select * into t from tournaments where id = p_tournament_id;
  if not found then raise exception 'Unknown tournament.'; end if;
  update results set is_projected = false, updated_at = now() where tournament_id = t.id;
  update tournaments set status = 'official' where id = t.id;
  perform record_month_winners(t.season, t.month);
end
$$;

create or replace function reopen_tournament(p_tournament_id text) returns void
language plpgsql security definer set search_path = public as
$$
declare t tournaments%rowtype;
begin
  if not is_admin() then raise exception 'Only the commissioner can reopen results.'; end if;
  select * into t from tournaments where id = p_tournament_id;
  if not found then raise exception 'Unknown tournament.'; end if;
  update results set is_projected = true, updated_at = now() where tournament_id = t.id;
  update tournaments set status = case when now() >= t.lock_at then 'in_progress' else 'upcoming' end where id = t.id;
  perform record_month_winners(t.season, t.month);  -- month no longer complete: clears its winners
end
$$;
revoke all on function finalize_tournament(text), reopen_tournament(text) from public, anon;
grant execute on function finalize_tournament(text), reopen_tournament(text) to authenticated;

-- ---------------------------------------------------------------- admin: members list
create or replace function admin_members(p_tournament_id text default null)
returns table (user_id uuid, display_name text, email text, is_admin boolean, signed_up timestamptz,
               joined timestamptz, last_sign_in timestamptz, picks_this_event int, picks_season int)
language plpgsql stable security definer set search_path = public as
$$
begin
  if not is_admin() then raise exception 'Commissioners only.'; end if;
  return query
    select u.id, p.display_name, u.email::text, coalesce(p.is_admin, false), u.created_at, p.created_at,
           u.last_sign_in_at,
           (select count(*)::int from picks k where k.user_id = u.id and k.tournament_id = p_tournament_id and k.slot in ('1', '2')),
           (select count(*)::int from picks k where k.user_id = u.id and k.slot in ('1', '2'))
      from auth.users u left join profiles p on p.id = u.id   -- no profile = signed up, never entered the code
     order by p.created_at nulls last, u.created_at;
end
$$;
revoke all on function admin_members(text) from public, anon;
grant execute on function admin_members(text) to authenticated;
