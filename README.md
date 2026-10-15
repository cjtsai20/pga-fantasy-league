# The Gentlemen's League

Fantasy golf league for the 2027 PGA TOUR season (January through the week before the FedEx St. Jude).
Each member picks two golfers per tournament and scores their FedEx Cup points (majors x1.25). A golfer
can be used once per season. Golfers who can't earn FedEx Cup points (LIV, amateurs) score what their
finishing position pays.

Static site on GitHub Pages; accounts and picks in Supabase. No build step.

## Setup (once)
1. Supabase -> SQL Editor: run `supabase/schema.sql`, then `supabase/seed_2027.sql`.
2. Set the league code: `insert into league_settings values ('league_code', 'YOUR-CODE')
   on conflict (key) do update set value = excluded.value;`
3. Supabase -> Authentication -> URL Configuration: Site URL `https://cjtsai20.github.io/pga-fantasy-league/`.
4. Sign up on the site, then make yourself commissioner:
   `update profiles set is_admin = true where id = (select id from auth.users where email = 'you@example.com');`

## Each week (commissioner)
- Admin -> Paste field (optional; until then members can pick any tour golfer).
- Admin -> Paste results: paste the leaderboard from anywhere. Save as projected during the event,
  Save & finalize when it's over. Finalizing the last event of a month records the monthly winner.
- Score bonus picks (majors) in Admin -> Bonus picks.

## Removing a member
Admin -> Members -> Remove deletes the member's account with their picks, points and saved careers.
Run `supabase/remove_member.sql` once to turn it on (fresh installs get it from `schema.sql`). A removed
member can sign up again with the league code, so change the code if they shouldn't come back.

## Credits
Hole layouts (c) OpenStreetMap contributors, ODbL. Course photos from Wikimedia Commons (credited on
each course page). Not affiliated with the PGA TOUR or any tournament or club.

Preview with sample data: `python -m http.server` in this folder, then open `http://localhost:8000/?demo=1`.
