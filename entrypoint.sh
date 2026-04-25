#!/bin/sh
# entrypoint.sh — runs at container start on Fly.io
#
# Fetches EIA jet fuel price data server-side and caches it as
# /data/fuel-prices.json, served statically by nginx.
# The EIA_API_KEY never reaches the browser.
#
# Data refreshes on every container restart. To refresh without redeploying:
#   fly machines restart --app fuelwatch-dashboard
#
# Secrets:
#   fly secrets set EIA_API_KEY=your_key_here

DATA_DIR=/usr/share/nginx/html/data
mkdir -p "$DATA_DIR"

# ── Fuel price fetch function ─────────────────────────────────────────────────
fetch_fuel_prices() {
  if [ -z "$EIA_API_KEY" ]; then
    echo "EIA_API_KEY not set — using seed data"
    return 1
  fi

  echo "Fetching EIA Gulf Coast jet fuel prices (EPJK/RGC)..."
  local tmp=$(mktemp)

  # -g disables curl's glob expansion so square brackets in the URL are literal
  HTTP_STATUS=$(curl -gs -o "$tmp" -w "%{http_code}" \
    "https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_API_KEY}&frequency=weekly&data[0]=value&facets[product][]=EPJK&facets[duoarea][]=RGC&start=2023-01-01&sort[0][column]=period&sort[0][direction]=desc&length=200")

  if [ "$HTTP_STATUS" = "200" ]; then
    # Transform EIA response into the app's schema using jq
    jq '[.response.data[]
         | select(.value != null)
         | {
             date:      .period,
             price:     (.value | tonumber),
             source:    "EIA EPJK/RGC (live)",
             series_id: "EPJK_RGC"
           }]
       | sort_by(.date)' \
      "$tmp" > "$DATA_DIR/fuel-prices.json"

    RECORD_COUNT=$(jq 'length' "$DATA_DIR/fuel-prices.json")
    LATEST=$(jq -r '.[-1].date + " $" + (.[-1].price | tostring) + "/gal"' "$DATA_DIR/fuel-prices.json")
    echo "fuel-prices.json written: ${RECORD_COUNT} records, latest: ${LATEST}"
  else
    echo "EIA fetch failed (HTTP ${HTTP_STATUS}) — keeping existing data"
  fi
  rm -f "$tmp"
}

# ── Initial fetch ────────────────────────────────────────────────────────────
fetch_fuel_prices

# ── Background refresh every 6 hours ─────────────────────────────────────────
(while true; do sleep 21600; fetch_fuel_prices; done) &

# ── config.js (no API keys needed client-side) ────────────────────────────────
cat > /usr/share/nginx/html/config.js <<'EOF'
// Auto-generated at container start — do not edit or commit.
// API keys are handled server-side in entrypoint.sh.
window.FUELWATCH_CONFIG = {};
EOF

echo "config.js written"

# ── Hand off to nginx ─────────────────────────────────────────────────────────
exec nginx -g "daemon off;"
