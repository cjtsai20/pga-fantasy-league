-- Admin -> Members -> Remove: lets the commissioner take someone out of the league. Removing deletes
-- their account, so their profile, picks, monthly wins and saved careers go with it. picks_guard is
-- re-created with one change: picks of a member being removed skip the "locked" check (otherwise the
-- delete fails on any event that has started). Also folded into schema.sql. Safe to re-run.
--
-- A removed member can sign up again if they still know the league code; change it to keep them out:
--   update league_settings set value = 'NEW-CODE' where key = 'league_code';

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
    -- the member's profile is already gone: the commissioner is removing them (admin_remove_member)
    if not exists (select 1 from profiles where id = old.user_id) then return old; end if;
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

-- Admin -> Members -> Remove. Deletes the account, which takes the member's profile, picks, monthly
-- wins and saved careers with it (the picks of a removed member skip the lock in picks_guard).
create or replace function admin_remove_member(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not is_admin() then raise exception 'Commissioners only.'; end if;
  if p_user_id = auth.uid() then raise exception 'You can''t remove yourself.'; end if;
  if exists (select 1 from profiles where id = p_user_id and is_admin) then
    raise exception 'Commissioners can''t be removed here.';
  end if;
  delete from auth.users where id = p_user_id;
  if not found then raise exception 'That member has already been removed.'; end if;
end
$$;
revoke all on function admin_remove_member(uuid) from public, anon;
grant execute on function admin_remove_member(uuid) to authenticated;
