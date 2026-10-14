"""Stamp a content hash onto every JS module URL in index.html, via an import map.

GitHub Pages serves files with a 10-minute cache, and the site is ~20 ES modules, so a reload right
after a deploy can mix old and new modules. The import map maps each module (as imported anywhere,
e.g. "./admin.js" from js/app.js) to "js/admin.js?v=<hash>"; a changed file gets a new URL and is
fetched fresh, unchanged ones stay cached. Run before committing (the local pre-commit hook does).
"""
import hashlib
import json
import re
from pathlib import Path

SITE = Path(__file__).resolve().parents[2]
INDEX = SITE / "index.html"


def version(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:10]


def main():
    mods = sorted(p for p in (SITE / "js").rglob("*.js") if "_test" not in p.name)
    imports = {f"./{p.relative_to(SITE).as_posix()}": f"./{p.relative_to(SITE).as_posix()}?v={version(p)}" for p in mods}
    block = ('<script type="importmap">\n' + json.dumps({"imports": imports}, indent=1) + "\n</script>\n  ")
    html = INDEX.read_text(encoding="utf-8")
    html = re.sub(r'<script type="importmap">.*?</script>\s*', "", html, flags=re.S)
    app = imports["./js/app.js"]
    html = re.sub(r'<script type="module" src="[^"]*app\.js[^"]*"></script>',
                  lambda m: block + f'<script type="module" src="{app}"></script>', html, count=1)
    INDEX.write_text(html, encoding="utf-8")
    print(f"stamped {len(imports)} modules")


if __name__ == "__main__":
    main()
