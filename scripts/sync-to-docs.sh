#!/usr/bin/env bash
# 将前端与数据同步到 /docs，供 GitHub Pages（仓库 Settings → Pages → Branch /docs）托管。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p docs/data

cp -f frontend/index.html docs/index.html
cp -f frontend/login.html docs/login.html
cp -f frontend/styles.css docs/styles.css
cp -f frontend/auth.js docs/auth.js
cp -f frontend/app.js docs/app.js
cp -f data/articles.json docs/data/articles.json

python3 <<'PY'
import json
from pathlib import Path
base = Path("data/wechat-channel-industries.json")
raw = json.loads(base.read_text(encoding="utf-8"))
Path("docs/data/channel-industries.json").write_text(
    json.dumps({"ok": True, "map": raw if isinstance(raw, dict) else {}}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
cfg = {
    "ok": True,
    "wechatRssConfigured": False,
    "wechatRssFeedCount": 0,
    "wechatDownloadApiRepo": "https://github.com/tmwgsicp/wechat-download-api",
    "wechatRssSaaS": "https://wechatrss.waytomaster.com",
}
Path("docs/data/config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

python3 <<'PY'
from pathlib import Path
p = Path("docs/index.html")
t = p.read_text(encoding="utf-8")
if "__WEEKLY_STATIC_DEPLOY__" not in t:
    t = t.replace("<head>", '<head>\n  <script>window.__WEEKLY_STATIC_DEPLOY__ = true;</script>', 1)
    p.write_text(t, encoding="utf-8")
PY

echo "已同步到 docs/，可提交后推送到 GitHub。"
