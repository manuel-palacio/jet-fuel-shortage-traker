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
  local ua="Mozilla/5.0 (compatible; FuelWatch/1.0; +https://fuelwatch-dashboard.fly.dev)"

  if ! curl -sLf -A "$ua" \
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
    # Airline lookup table: name → [code, region]
    def airline_lookup:
      { "United Airlines":     ["UA","North America"],
        "American Airlines":   ["AA","North America"],
        "Delta Air Lines":     ["DL","North America"],
        "Southwest Airlines":  ["WN","North America"],
        "JetBlue":             ["B6","North America"],
        "Spirit Airlines":     ["NK","North America"],
        "Frontier Airlines":   ["F9","North America"],
        "SAS":                 ["SK","Europe"],
        "Lufthansa":           ["LH","Europe"],
        "Ryanair":             ["FR","Europe"],
        "easyJet":             ["U2","Europe"],
        "Air France":          ["AF","Europe"],
        "KLM":                 ["KL","Europe"],
        "British Airways":     ["BA","Europe"],
        "Turkish Airlines":    ["TK","Europe"],
        "Iberia":              ["IB","Europe"],
        "Norwegian":           ["DY","Europe"],
        "Wizz Air":            ["W6","Europe"],
        "Vueling":             ["VY","Europe"],
        "Air New Zealand":     ["NZ","Asia-Pacific"] };

    # Severity heuristic from headline keywords
    def guess_severity:
      if test("crisis|emergency|ground|strand|critical|halt"; "i") then "critical"
      elif test("cancel|suspend|disrupt|shortage|cut"; "i") then "high"
      elif test("delay|warn|risk|concern|threat"; "i") then "medium"
      else "low" end;

    # Impact type heuristic from headline keywords
    def guess_impact:
      if test("cancel"; "i") then "cancellations"
      elif test("fare|price|surcharg|cost"; "i") then "fare_increase"
      elif test("cut|suspend|reduc|halt"; "i") then "schedule_cuts"
      else "fuel_risk" end;

    # Region heuristic from headline keywords
    def guess_region:
      if test("Europe|EU|UK|Britain|France|Germany|Spain|Italy|Nordic|Scandinav"; "i") then "Europe"
      elif test("Asia|China|Japan|India|Pacific|Australia"; "i") then "Asia-Pacific"
      elif test("Africa|Nigeria|South Africa"; "i") then "Africa"
      elif test("Middle East|Gulf|Saudi|UAE|Qatar"; "i") then "Middle East"
      elif test("Latin|Brazil|Mexico|Caribbean"; "i") then "Latin America"
      else "North America" end;

    [split("\n")[] | select(length > 0) | split("\t") | select(length >= 4) |
    . as $fields |
    ($fields[0] | capture("(?<a>United Airlines|American Airlines|Delta Air Lines|SAS|Lufthansa|Ryanair|easyJet|Air France|KLM|British Airways|Air New Zealand|Turkish Airlines|Iberia|Norwegian|Wizz Air|Vueling|Southwest Airlines|JetBlue|Spirit Airlines|Frontier Airlines)"; "i").a // "") as $airline |
    (if $airline != "" then (airline_lookup[$airline] // ["",""])[0] else "" end) as $code |
    (if $airline != "" then (airline_lookup[$airline] // ["",""])[1] else ($fields[0] | guess_region) end) as $region |
    {
      id:                ("NEWS-" + ($fields[0] | gsub("[^a-zA-Z0-9]"; "")[0:16])),
      airline:           $airline,
      airline_code:      $code,
      region:            $region,
      routes:            [],
      airports:          [],
      cancellations:     0,
      impact_type:       ($fields[0] | guess_impact),
      severity:          ($fields[0] | guess_severity),
      summary:           ($fields[0] | sub(" - [^-]+$"; "")),
      operational_notes: "",
      timeline:          [],
      source_name:       ($fields[3] // "News"),
      source_url:        ($fields[1] // "#"),
      updated_at:        ($fields[2] // ""),
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
