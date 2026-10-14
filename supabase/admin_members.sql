-- Admin -> Members list. Emails live in auth.users, which the site can't read; this function lets
-- admins (only) see them. Also folded into schema.sql. Safe to re-run.
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
