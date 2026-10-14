"""Monday reminder to paste this week's field.

Opens a GitHub issue assigned to the commissioner for each tournament starting in the next 4 days
whose field hasn't been pasted yet; GitHub emails the assignee. Reads Supabase with the publishable
key (tournaments and field are public), so it needs no secrets beyond the workflow's GITHUB_TOKEN.
Field data itself is never fetched automatically: pgatour.com's terms forbid it.
"""
import datetime as dt
import json
import os
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

SUPABASE_URL = "https://wapxrrpvqshlgsqodxuj.supabase.co"
SUPABASE_KEY = "sb_publishable_pXcCUVyfr4Obdn-mIbr7Gw_xzM5X8kO"
SITE = "https://cjtsai20.github.io/pga-fantasy-league/"
REPO = os.environ.get("GITHUB_REPOSITORY", "cjtsai20/pga-fantasy-league")
ASSIGNEE = os.environ.get("COMMISSIONER", "cjtsai20")
LOOKAHEAD_DAYS = 4


def get_json(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return json.load(r)


def supabase(path):
    return get_json(f"{SUPABASE_URL}/rest/v1/{path}", {"apikey": SUPABASE_KEY})


def github(method, path, body=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                 "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    today = dt.datetime.now(ZoneInfo("America/New_York")).date()
    until = today + dt.timedelta(days=LOOKAHEAD_DAYS)
    events = supabase(f"tournaments?select=id,name,start_date,lock_at"
                      f"&start_date=gte.{today}&start_date=lte.{until}&order=start_date")
    if not events:
        print(f"no tournaments start {today}..{until}")
        return

    open_titles = {i["title"] for i in github("GET", f"/repos/{REPO}/issues?state=open&labels=field-reminder&per_page=100")}
    for t in events:
        has_field = supabase(f"field?select=player_id&limit=1&tournament_id=eq.{urllib.parse.quote(t['id'])}")
        title = f"Paste the field: {t['name']} ({t['start_date']})"
        if has_field:
            print(f"{t['name']}: field already pasted")
            continue
        if title in open_titles:
            print(f"{t['name']}: reminder already open")
            continue
        lock = dt.datetime.fromisoformat(t["lock_at"]).astimezone(ZoneInfo("America/New_York"))
        body = (f"**{t['name']}** starts {t['start_date']}. Picks lock {lock:%a %b %d, %I:%M %p} ET.\n\n"
                f"1. Copy the field from the tournament's field page on pgatour.com.\n"
                f"2. Paste it here: {SITE}#/admin/{t['id']} (Admin → Paste field).\n\n"
                f"Until the field is pasted, members can pick any tour golfer. "
                f"Close this issue once it's done (it's skipped automatically next time if the field is in).")
        github("POST", f"/repos/{REPO}/issues",
               {"title": title, "body": body, "assignees": [ASSIGNEE], "labels": ["field-reminder"]})
        print(f"{t['name']}: reminder opened")


if __name__ == "__main__":
    main()
