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

# ── Disruption news fetch function ────────────────────────────────────────────
fetch_disruption_news() {
  echo "Fetching aviation fuel disruption news from Google News RSS..."
  local tmp=$(mktemp)
  local query="jet+fuel+shortage+OR+kerosene+supply+disruption+OR+airline+fuel+crisis+OR+aviation+fuel+supply"

  if ! curl -sf -A "FuelWatch/1.0" \
    "https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en" \
    -o "$tmp"; then
    echo "News fetch failed — keeping existing disruptions.json"
    rm -f "$tmp"
    return 1
  fi

  # Parse RSS items with xmlstarlet → tab-separated lines → jq → JSON
  xmlstarlet sel -t -m "//item" \
    -v "title" -o "	" \
    -v "link" -o "	" \
    -v "pubDate" -o "	" \
    -v "source" -o "	" \
    -v "source/@url" -n \
    "$tmp" 2>/dev/null | head -20 | \
  jq -R -s '
    [split("\n")[] | select(length > 0) | split("\t") | select(length >= 4) |
    {
      id:                ("NEWS-" + (.[2] + .[0] | gsub("[^a-zA-Z0-9]"; "")[0:16])),
      airline:           (.[0] | capture("(?<a>United Airlines|American Airlines|Delta Air Lines|SAS|Lufthansa|Ryanair|easyJet|Air France|KLM|British Airways|Air New Zealand|Turkish Airlines|Iberia|Norwegian|Wizz Air|Vueling|Southwest Airlines|JetBlue|Spirit Airlines|Frontier Airlines)"; "i").a // ""),
      airline_code:      "",
      region:            "",
      routes:            [],
      airports:          [],
      cancellations:     0,
      impact_type:       "fuel_risk",
      severity:          "medium",
      summary:           (.[0] | sub(" - [^-]+$"; "")),
      operational_notes: "",
      timeline:          [],
      source_name:       (.[3] // "News"),
      source_url:        (.[1] // "#"),
      updated_at:        (.[2] // "" | sub("^[A-Z][a-z]+, "; "") | sub(" GMT$"; "+00:00") | sub(" \\+"; "T00:00:00+")),
      _source_type:      "google_news_rss"
    }] | if length > 0 then . else empty end
  ' > /tmp/news_disruptions.json 2>/dev/null

  local count=$(jq 'length' /tmp/news_disruptions.json 2>/dev/null || echo 0)

  if [ "$count" -gt 0 ] 2>/dev/null; then
    cp /tmp/news_disruptions.json "$DATA_DIR/disruptions.json"
    echo "disruptions.json written: ${count} news items (live)"
  else
    echo "No news items parsed — keeping existing disruptions.json"
  fi

  rm -f "$tmp" /tmp/news_disruptions.json
}

# ── Initial fetch ────────────────────────────────────────────────────────────
fetch_fuel_prices
fetch_disruption_news

# ── Background refresh every 6 hours ─────────────────────────────────────────
(while true; do sleep 21600; fetch_fuel_prices; fetch_disruption_news; done) &

# ── config.js (no API keys needed client-side) ────────────────────────────────
cat > /usr/share/nginx/html/config.js <<'EOF'
// Auto-generated at container start — do not edit or commit.
// API keys are handled server-side in entrypoint.sh.
window.FUELWATCH_CONFIG = {};
EOF

echo "config.js written"

# ── Hand off to nginx ─────────────────────────────────────────────────────────
exec nginx -g "daemon off;"
