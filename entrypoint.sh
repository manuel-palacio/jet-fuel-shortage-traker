#!/bin/sh
# entrypoint.sh — runs at container start on Fly.io
#
# 1. Fetches EIA jet fuel price data server-side and caches it as
#    /data/fuel-prices.json (served statically by nginx).
#    The EIA_API_KEY never reaches the browser.
#
# 2. Writes a minimal config.js (no API keys needed client-side anymore).
#
# Set secrets:
#   fly secrets set EIA_API_KEY=your_key_here
#
# To refresh data without a full redeploy, restart the machine:
#   fly machines restart --app fuelwatch-dashboard

DATA_DIR=/usr/share/nginx/html/data
mkdir -p "$DATA_DIR"

# ── EIA data fetch ────────────────────────────────────────────────────────────
if [ -n "$EIA_API_KEY" ]; then
  echo "Fetching EIA Gulf Coast jet fuel prices (EPJK/RGC)..."

  EIA_URL="https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_API_KEY}&frequency=weekly&data[0]=value&facets[product][]=EPJK&facets[duoarea][]=RGC&start=2023-01-01&sort[0][column]=period&sort[0][direction]=desc&length=200"

  # Use wget (always present in nginx:alpine) with -g to disable glob expansion
  wget -q -O /tmp/eia_raw.json "$EIA_URL" 2>&1

  if [ $? -eq 0 ] && [ -s /tmp/eia_raw.json ]; then
    # Transform EIA response into the app's fuel price schema using awk+sed
    # EIA shape: {"response":{"data":[{"period":"2026-03-27","value":"4.009",...}]}}
    # Output shape: [{"date":"2026-03-27","price":4.009,"source":"EIA EPJK/RGC (live)","series_id":"EPJK_RGC"}]
    python3 - <<'PYEOF'
import json, sys

with open('/tmp/eia_raw.json') as f:
    raw = json.load(f)

rows = raw.get('response', {}).get('data', [])
out = []
for r in rows:
    try:
        out.append({
            "date":      r["period"],
            "price":     float(r["value"]),
            "source":    "EIA EPJK/RGC (live)",
            "series_id": "EPJK_RGC"
        })
    except (KeyError, TypeError, ValueError):
        pass

# Sort ascending by date for the chart
out.sort(key=lambda x: x["date"])

with open('/usr/share/nginx/html/data/fuel-prices.json', 'w') as f:
    json.dump(out, f)

print(f"fuel-prices.json written: {len(out)} records, latest: {out[-1]['date'] if out else 'none'} ${out[-1]['price']:.3f}/gal" if out else "fuel-prices.json written: 0 records")
PYEOF

  else
    echo "EIA fetch failed or empty response — browser will fall back to seed data"
  fi
else
  echo "EIA_API_KEY not set — browser will use seed data"
fi

# ── config.js (no API keys needed client-side) ────────────────────────────────
cat > /usr/share/nginx/html/config.js <<EOF
// Auto-generated at container start — do not edit or commit.
// API keys are handled server-side in entrypoint.sh.
window.FUELWATCH_CONFIG = {};
EOF

echo "config.js written"

# ── Hand off to nginx ─────────────────────────────────────────────────────────
exec nginx -g "daemon off;"
