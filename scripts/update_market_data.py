#!/usr/bin/env python3
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "csi1000-history.json"

params = {
    "secid": "1.000852",
    "fields1": "f1,f2,f3",
    "fields2": "f51,f52,f53,f54,f55,f56,f57",
    "klt": "101",
    "fqt": "0",
    "end": "20500101",
    "lmt": "1200",
    "ut": "fa5fd1943c7b386f172d6893dbbd1d0c",
}
url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?" + urllib.parse.urlencode(params)

req = urllib.request.Request(
    url,
    headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://quote.eastmoney.com/",
        "Accept": "application/json,text/plain,*/*",
    },
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.load(resp)
except Exception as e:
    print(f"ERROR fetching market data: {e}", file=sys.stderr)
    sys.exit(1)

data = (raw or {}).get("data") or {}
if str(data.get("code")) != "000852":
    print(f"ERROR unexpected index code: {data.get('code')!r}", file=sys.stderr)
    sys.exit(2)

klines = data.get("klines") or []
items = []
for line in klines:
    f = line.split(",")
    if len(f) < 3:
        continue
    try:
        close = float(f[2])
    except ValueError:
        continue
    if close <= 0:
        continue
    items.append({"date": f[0], "close": close})

if len(items) < 200:
    print(f"ERROR insufficient history: {len(items)} rows", file=sys.stderr)
    sys.exit(3)

# Structural validation.
dates = [x["date"] for x in items]
if dates != sorted(dates) or len(dates) != len(set(dates)):
    print("ERROR dates are not strictly unique/increasing", file=sys.stderr)
    sys.exit(4)

if OUT.exists():
    try:
        previous = json.loads(OUT.read_text(encoding="utf-8"))
        if previous.get("indexCode") == "000852" and previous.get("items") == items:
            print(f"No market-data changes ({len(items)} rows)")
            sys.exit(0)
    except (OSError, json.JSONDecodeError):
        pass

payload = {
    "indexCode": "000852",
    "source": "eastmoney",
    "fetchedAt": datetime.now(timezone.utc).isoformat(),
    "items": items,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {len(items)} rows to {OUT}")
