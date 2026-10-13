# Data contracts

Static site (GitHub Pages, no build step, plain ES modules) + Supabase. Everything a page needs comes
from one of two places.

## Supabase (see supabase/schema.sql)

| Table / view | Written by | Read by |
|---|---|---|
| `tournaments` | `supabase/seed_2027.sql`; admins update `status` | everyone |
| `field` | admins (Admin -> Paste field) | everyone |
| `results` | admins (Admin -> Paste results; projected mid-event, `is_projected=false` once finalized) | everyone |
| `picks` | members (own, before `lock_at`); admins set `bonus_points` | own always; others' after lock |
| `pick_scores` (view) | - | members; leaderboards are built from this |
| `profiles` | `join_league()` RPC | members |
| `monthly_winners` | `finalize_tournament()`, once every event in the month is official | members |

Client config: `js/config.js` exports `SUPABASE_URL`, `SUPABASE_KEY` (publishable, public by design).
Supabase JS v2 from `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`.

Sign-up flow: `auth.signUp({email, password})` -> `rpc('join_league', {p_code, p_display_name})`.
A signed-in user with no `profiles` row is sent back to finish joining (code + name).

Pick errors come back as Postgres exception messages (e.g. "You have already selected Scottie
Scheffler this season (The Masters)."). Show `error.message` verbatim.

Current tournament = earliest `tournaments` row whose `end_date >= today` (ET).
Month for monthly leaderboards = `tournaments.month` ('YYYY-MM').
Winner of a tournament = `results.position = '1'` and `is_projected = false`.

## Static JSON in `data/` (built once by scripts in `pga_fantasy/tools/`, committed to the repo)

There is no daily job: pgatour.com's terms forbid automated pulls, so the commissioner pastes results.

`data/meta.json`
```json
{"refreshed_at": "2027-01-16T10:02:00-05:00", "season": 2027}
```

`data/courses.json` (array, one per 2027 course; built once by `pga_fantasy/tools/build_osm_courses.py`)
```json
[{"id": "tpc-sawgrass", "name": "TPC Sawgrass - THE PLAYERS Stadium Course", "location": "Ponte Vedra Beach, Florida",
  "description": "short original text",
  "par": 72, "yardage": 7352, "tournament_ids": ["R2027011"],     // official tournament par / yardage
  "images": [{"url": "https://upload.wikimedia.org/...", "credit": "Author", "license": "CC BY-SA 2.0", "source": "https://commons.wikimedia.org/wiki/File:..."}],
  "layout_source": "osm",                                          // "osm" | "generated"
  "attribution": "Hole layouts © OpenStreetMap contributors (ODbL)",
  "osm_par": 72, "osm_yardage": 7195,                              // as mapped, before any tournament-par fix
  "geo_file": "courses/tpc-sawgrass.json",                         // null when generated
  "holes": [{"n": 17, "par": 3, "yards": 137, "shape": "dogleg_left|dogleg_right|straight",
             "hazards": ["greenside_bunker", "water_green"],       // coarse tags, derived from the geometry
             "par_source": "osm|tournament|inferred|generated"}]}]
```
`par_source`: `tournament` = a member par 5 played as a par 4 (or vice versa) so the card matches the
official par; `generated` = no mapped hole, so it's illustrated (no geometry). A course can mix both.
`difficulty` (scoring average minus par) is optional; the sim treats it as 0 when absent.

`data/courses/{id}.json` (real layouts, loaded lazily per course; coordinates are yards in a
course-local frame, x east / y north)
```json
{"id": "tpc-sawgrass", "attribution": "...",
 "features": {"fairway": [[[x, y], ...]], "green": [...], "tee": [...], "bunker": [...], "water": [...],
              "trees": [...], "boundary": [...], "tree_row": [[[x, y], ...]], "trees_pts": [[x, y], ...]},
 "holes": [{"n": 17, "tee": [x, y], "pin": [x, y], "gc": [x, y], "line": [[x, y], ...]}]}
```
`js/game/geo.js` `attachCourseGeo(course, file)` cuts each hole's window out of `features` and sets
`hole.geo` in the hole frame the sim uses: yards, tee at (0, 0), pin at (`geo.pin[0]`, 0), s forward, x
to the golfer's right. `boundary` is the course polygon; landing outside it counts as out of bounds.

`data/players.json` (object keyed by PGA TOUR player id)
```json
{"46046": {"name": "Scottie Scheffler", "headshot_url": "https://...", "country": "USA",
           "stats": {"drive_dist": 312.4, "drive_acc": 0.62, "gir": 0.74, "scrambling": 0.66,
                     "sg_ott": 0.9, "sg_app": 1.3, "sg_arg": 0.4, "sg_putt": 0.5,
                     "putts_per_round": 28.6, "birdie_avg": 4.6}}}
```
Rates are 0-1 fractions. Missing stats are omitted; consumers fall back to tour averages.
