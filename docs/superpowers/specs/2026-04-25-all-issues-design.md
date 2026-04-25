# Jet Fuel Shortage Tracker — Full Feature Design

**Date:** 2026-04-25
**Scope:** Issues #3, #4, #1, #2, #5, #6, #7
**Approach:** Enhanced single-file SPA (Approach A)

## Implementation Order

#3 → #4 → #1 → #2 → #5 → #6 → #7

Each issue builds on the prior. Nav and data extraction are foundational; airport data feeds the map; live prices feed KPIs; summer toggle feeds adjusted KPIs.

---

## Issue #3 — Wire Up Sidebar Navigation

**Problem:** Nav items exist but clicking them does nothing.

**Solution:** Hash-based routing with `data-view` section toggling.

**Routes:**

| Hash | View | Nav Label |
|------|------|-----------|
| `#overview` (default) | KPI + charts + disruptions table | Overview |
| `#disruptions` | Full disruptions table | Disruptions |
| `#airports` | Airport inventory cards | Airports |
| `#map` | Leaflet Europe map | Map |
| `#analytics` | Extended charts + seasonality | Analytics |

**Implementation:**
- Wrap existing content in `<section data-view="overview">`
- Add empty `data-view` sections for new views
- `hashchange` listener: hide all `[data-view]`, show matching one
- Update `data-nav` attributes to match hash targets
- Active nav item: add `.active` class, remove from siblings
- Mobile: close sidebar drawer after route selection
- Header subtitle updates to match current view name
- `renderView()` called on DOMContentLoaded with initial hash

**Nav items update:**
- Overview → `#overview`
- Disruptions → `#disruptions`
- Airports → `#airports` (new, replaces "Impact List")
- Map → `#map` (new, replaces "Analytics")
- Analytics → `#analytics` (add as 5th item)

---

## Issue #4 — Extract Seed Data to JSON Files

**Problem:** ~300 lines of inline JSON in `<script>` block.

**File structure:**
```
public/data/
  disruptions.json    ← from SEED_DISRUPTIONS
  fuel-prices.json    ← from SEED_FUEL_PRICES
  airports.json       ← new (15 European airports)
```

**JS changes:**
- Remove `SEED_DISRUPTIONS` and `SEED_FUEL_PRICES` constants
- Add `loadData()` that fetches all three JSON files in parallel
- Each fetch has try/catch with console.warn on failure
- `initApp()` calls `loadData()` then populates `AppState`
- Existing adapter functions (`normalizeFuelPriceData`, etc.) still used

**airports.json schema:**
```json
[{
  "code": "LHR",
  "name": "London Heathrow",
  "city": "London",
  "country": "United Kingdom",
  "lat": 51.4700,
  "lon": -0.4543,
  "storage_capacity_ml": 45.0,
  "daily_burn_ml": 3.2,
  "cover_days": 14.1,
  "import_dependency": "LOW",
  "notes": "Major refinery pipeline access via Esso West London"
}]
```

---

## Issue #1 — Airport Inventory View

**View:** `<section data-view="airports">`

**Layout:** Responsive card grid
- Mobile: 1 column
- Tablet (≥640px): 2 columns
- Desktop (≥1024px): 3 columns
- Wide (≥1400px): 4 columns

**Card content:**
- Header: airport code badge + full name
- Cover days: large number, color-coded background
  - Green (`--c-low`): ≥14 days
  - Amber (`--c-high`): 7–14 days
  - Red (`--c-critical`): <7 days
- Daily burn: value in ML/day (JetBrains Mono)
- Capacity utilization: horizontal bar (fill = burn/capacity ratio)
- Import dependency: badge (HIGH/MED/LOW)
- Notes: small text footer

**Styling:** Follows existing card patterns (`--surface-container-high` bg, `--radius-lg`, `--shadow-sm` hover elevation).

---

## Issue #2 — Europe Map View

**View:** `<section data-view="map">`

**Dependencies:** Leaflet.js 1.9 + CSS via CDN (jsDelivr)

**Map config:**
- Center: [50, 10] (central Europe), zoom 4
- Tiles: CartoDB Dark Matter (matches Nocturnal Navigator)
- Attribution: standard OSM/CartoDB

**Airport markers:**
- `L.circleMarker` at each airport's [lat, lon]
- Color: green/amber/red matching cover-days thresholds
- Radius: scaled by daily_burn_ml (min 6, max 18)
- Stroke: 2px white at 40% opacity

**Interactions:**
- Hover tooltip: `"LHR — 14.1 days cover (LOW RISK)"`
- Click: opens existing detail drawer pattern with airport details
- Responsive: map fills container, `invalidateSize()` on view show

**Fallback:** If tile load fails, show centered message over grey background.

---

## Issue #5 — Live EIA Fuel Price Fetch

**entrypoint.sh changes:**
```bash
fetch_fuel_prices() {
  local tmp=$(mktemp)
  if curl -sf "https://api.eia.gov/v2/petroleum/pri/wfr/data/..." -o "$tmp"; then
    jq '[.response.data[] | {date: .period, price: (.value|tonumber), source: "EIA (live)", series_id: "WJFUELUSGULF"}]' "$tmp" \
      > /app/public/data/fuel-prices.json
  fi
  rm -f "$tmp"
}

# Initial fetch
fetch_fuel_prices

# Background refresh every 6 hours
(while true; do sleep 21600; fetch_fuel_prices; done) &
```

**UI changes:**
- Data source badge in KPI section: "LIVE" (green) or "SEED" (amber)
- Based on `source` field containing "live"
- Last-updated timestamp from most recent data point

**README:** Document `EIA_API_KEY` as required Fly.io secret.

---

## Issue #6 — Summer Travel Demand Toggle

**Toggle location:** Filter bar, right side

**Toggle markup:** Button with sun icon, toggles `AppState.summerMode`

**When active:**
- Demand multiplier: 1.35x on `daily_burn_ml`
- Adjusted cover days: `storage_capacity_ml / (daily_burn_ml * 1.35)`
- Tightened risk thresholds: green ≥21d, amber 10–21d, red <10d
- Airport cards, map bubbles, and KPIs all update reactively

**Auto-activation:** If current month is June, July, or August, toggle defaults ON (user can still turn it off).

**Warning banner:**
- Amber background (`--c-high-dim`)
- Text: "Summer peak season: flight volumes up ~35%. Cover-day estimates reflect elevated demand."
- Dismiss button (state held in `AppState.bannerDismissed`, not localStorage)
- Shows when summer mode is active AND not dismissed

**Seasonality chart (Analytics view):**
- Bar chart showing monthly consumption index by airport
- Jun–Aug bars highlighted with amber fill
- Uses Chart.js bar type

---

## Issue #7 — Upgrade KPI Section

**New KPI grid (6 cards):**

| Position | KPI | Source | Delta |
|----------|-----|--------|-------|
| 1 | Avg. Cover Days | mean of airports[].cover_days | vs. non-summer baseline |
| 2 | Airports at Risk | count where cover_days < 7 (or <10 in summer) | out of 15 |
| 3 | Jet Fuel Price | latest fuel-prices entry | week-on-week % |
| 4 | Import Risk Index | composite score | level badge |
| 5 | Total Cancellations | sum of disruptions[].cancellations | existing |
| 6 | Critical Events | count where severity=critical | existing |

**Import Risk Index:**
- Hardcoded initial values in airports.json (export_restriction, supply_diversion, stock_deviation fields)
- Composite: sum of three 0–3 scores
- 0–4 LOW, 5–7 MEDIUM, 8–9 HIGH, 10+ CRITICAL
- Tooltip on hover explaining composition

**Interactivity:**
- "Airports at Risk" card clickable → navigates to `#airports`
- "Jet Fuel Price" card shows $/gal with week-on-week delta arrow
- All KPIs react to summer toggle state

---

## Cross-Cutting Concerns

**Sanitization:** All new innerHTML uses existing `safeHTML()` / `esc()` helpers.

**Theming:** All new components use CSS custom properties. Light theme works via existing `[data-theme="light"]` overrides — new variables added where needed.

**Accessibility:** ARIA labels on all interactive elements. Map markers get `aria-label`. Toggle buttons get `aria-pressed`.

**Performance:** Leaflet loaded lazily (only when #map view first shown). Chart.js instances destroyed before recreation.

**Mobile:** All views tested at 320px–768px. Map uses `min-height: 400px`. Cards collapse to single column.
