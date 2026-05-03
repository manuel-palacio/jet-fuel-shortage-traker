# EFC Tracker — Energy & Food Crisis Tracker

**Date:** 2026-05-03
**Status:** Approved (pending user review of this doc)
**Predecessor:** FuelWatch / Aviation Disruption Tracker

---

## 1. Goal

Convert the single-purpose jet fuel shortage tracker into a two-domain crisis monitoring dashboard:

- **Energy mode** — existing aviation views + WTI crude oil and Henry Hub natural gas price tracking
- **Food mode** — wheat price tracking + filterable food-events news feed

Rename the project to **EFC Tracker** (Energy & Food Crisis Tracker) end-to-end: code identity, branding, repo, and Fly.io app.

---

## 2. Top-level UX

### Mode tabs

A new **mode tab bar** sits at the top of the header, above the existing filter bar. Two large toggle buttons:

```
┌──────────────────────────────────────────────┐
│  [⚡ Energy]   [🌾 Food]                     │  ← mode tabs
├──────────────────────────────────────────────┤
│  Filter | airline | region | country | …     │  ← filter bar (mode-aware)
└──────────────────────────────────────────────┘
```

Clicking a tab swaps:
- The sidebar's nav items (each mode declares its own view list)
- The main content area (each mode renders its own views)
- The filter bar's filter controls (each mode declares its own filters)
- The page title in the header

The default mode on first load is **Energy**. Mode selection persists in `localStorage` (`efc.mode`).

### Sidebar

A persistent sidebar with two zones:

- **Top:** Brand label "EFC Tracker"
- **Middle:** Mode-specific nav items (rendered dynamically from the active mode plugin)
- **Bottom:** Collapse button (existing behavior preserved)

Mode tabs are **not** inside the sidebar — they live in the header to make mode-switching feel global, not nested.

---

## 3. Energy mode

### Views (5)

| Route | View | Notes |
|---|---|---|
| `#energy/overview` | Fleet Overview | Existing — KPIs, fuel chart, cancellations timeline, disruptions table |
| `#energy/airports` | Airport Inventory | Existing — unchanged |
| `#energy/map` | Europe Risk Map | Existing — unchanged |
| `#energy/disruptions` | Disruptions | Existing — full disruption events table |
| `#energy/analytics` | Analytics | **Extended** — adds WTI crude oil chart card and Henry Hub natural gas chart card alongside the existing jet fuel trend |

### Filter bar

Existing filter set, unchanged: airline, region, country, impact type, severity, search, Summer Mode toggle.

### New data: oil & gas

Two additional EIA series fetched server-side at startup and on the existing 6h background loop:

- **WTI crude oil spot** — EIA v2 petroleum spot price endpoint, product `EPCWTI`, Cushing OK pricing area (daily, $/barrel)
- **Henry Hub natural gas spot** — EIA v2 natural gas summary endpoint, Henry Hub LA pricing area (daily, $/MMBtu)

Both endpoints are under the same EIA API key already configured (`EIA_API_KEY`). No new secret needed. Exact facet codes (`facets[product][]=...&facets[duoarea][]=...`) will be finalized during implementation by mirroring the existing `fetch_fuel_prices` pattern.

### Energy disruptions schema

Unchanged. Still uses the airline-coded schema (`airline`, `airline_code`, `region`, `country`, `severity`, `impact_type`, etc.).

---

## 4. Food mode

### Views (2)

| Route | View | Description |
|---|---|---|
| `#food/overview` | Food Overview | KPIs (latest wheat price, MoM change, event count, top affected country), wheat price chart, recent events list (top 5) |
| `#food/events` | Food Events | Filterable table mirroring the Energy disruptions table layout, with food-specific columns |

### Filter bar

A different filter set, swapped in when food mode is active:

- Commodity (wheat / corn / rice / fertilizer / other)
- Region (Europe / Asia-Pacific / Africa / Middle East / Latin America / North America)
- Country (free text search)
- Event type (export_ban / harvest_failure / price_surge / supply_disruption / policy)
- Severity (critical / high / medium / low)
- Search (free text over headlines)

No "Summer Mode" toggle in food mode (jet-fuel-specific concept).

### New data: wheat prices

- **Source:** FRED API, series `PWHEAMTUSDM` — Global Price of Wheat (US$/Metric Ton, monthly, World Bank)
- **Endpoint:** `https://api.stlouisfed.org/fred/series/observations?series_id=PWHEAMTUSDM&api_key={FRED_API_KEY}&file_type=json`
- **Cadence:** Monthly. Lags ~6 weeks behind real time. The chart will show step-shaped data, not a daily wiggling line — this is honest about the data reality and will be called out in the chart subtitle.
- **Secret:** new Fly secret `FRED_API_KEY` (free key from `https://fred.stlouisfed.org/docs/api/api_key.html`)

### New data: food events

Google News RSS, parallel to the existing aviation news pipeline:

- **Query:** `wheat OR grain OR fertilizer OR "food crisis" OR "export ban" OR harvest OR famine`
- **Parser:** new `fetch_food_events()` function in `entrypoint.sh`. Heuristics:
  - **Commodity** detection: regex over `wheat|corn|rice|maize|soy|fertilizer|urea|potash`
  - **Country** detection: regex over major producers/consumers (Ukraine, Russia, India, China, US, Argentina, Brazil, Egypt, etc.)
  - **Region** detection: same regex pattern as existing aviation parser
  - **Event type** detection: `export ban|harvest|drought|flood|price surge|policy|sanction`
  - **Severity** detection: same heuristic style as existing aviation parser (keyword tiers)
- **Output:** `public/data/food/food-events.json`, schema below.

### Food events schema

```json
{
  "id": "FOOD-WheatExportBan...",
  "commodity": "wheat",
  "region": "Asia-Pacific",
  "country": "India",
  "event_type": "export_ban",
  "severity": "high",
  "summary": "India bans wheat exports amid heatwave",
  "source_name": "Reuters",
  "source_url": "https://...",
  "updated_at": "2026-05-01T14:23:00Z"
}
```

No deep "operational notes" / "timeline" fields — kept lean. Detail drawer just shows the headline, source link, and a "Read at source" CTA.

---

## 5. Code structure

Three top-level scripts loaded by `index.html`, in order:

```html
<script src="/shared.js"></script>
<script src="/energy.js"></script>
<script src="/food.js"></script>
<script src="/app.js"></script>  <!-- bootstraps -->
```

### `shared.js` — common utilities and mode plugin API

Exposes a global `EFC` namespace:

```js
window.EFC = {
  // Mode plugin API
  registerMode({ id, label, icon, defaultView, views, filters, init, render }),
  setMode(id),
  currentMode(),

  // DOM helpers
  $, $$, safeHTML, escapeHTML,

  // Chart helpers
  chartDefaults, makeLineChart, makeDonutChart,

  // Routing
  routeTo(modeId, viewId),
  parseHash(),  // → { modeId, viewId }

  // Data fetching helpers
  fetchJSON(path, fallback),

  // Theme + sidebar collapse
  initTheme(), initSidebar(), initInfoPopover(),
};
```

`shared.js` does NOT know about energy or food specifically. It's pure infrastructure.

### `energy.js` — energy mode plugin

Calls `EFC.registerMode({ id: 'energy', ... })`. Owns:
- All five existing views (overview, airports, map, disruptions, analytics)
- Energy-specific filter state and reducers
- Energy-specific KPI computation (cover days, import risk, etc.)
- Loads `data/energy/*.json` files

### `food.js` — food mode plugin

Calls `EFC.registerMode({ id: 'food', ... })`. Owns:
- Two views (overview, events)
- Food-specific filter state and reducers
- Wheat KPI computation (latest price, MoM change)
- Loads `data/food/*.json` files

### `app.js` — bootstrap

Reduced to ~30 lines:
- Wait for DOM ready
- Call `EFC.initTheme()`, `EFC.initSidebar()`, `EFC.initInfoPopover()`
- Call `EFC.setMode(localStorage.getItem('efc.mode') || 'energy')`
- Wire mode-tab click handlers
- Wire hash-change router

### Routing

Hash format changes from `#overview` to `#energy/overview` (or `#food/events`). Routing is handled centrally in `shared.js`.

**Legacy hash compatibility:** Bookmarked URLs from the old app (`#overview`, `#airports`, `#map`, `#disruptions`, `#analytics`) are silently rewritten to their `#energy/<view>` equivalents on load. Any other malformed hash falls through to the active mode's default view.

---

## 6. Data layer

### File reorganization

```
public/data/
├── energy/
│   ├── airports.json          (moved from public/data/)
│   ├── disruptions.json       (moved from public/data/)
│   ├── fuel-prices.json       (moved from public/data/)
│   ├── oil-prices.json        (NEW — WTI)
│   └── gas-prices.json        (NEW — Henry Hub)
└── food/
    ├── wheat-prices.json      (NEW — FRED)
    └── food-events.json       (NEW — Google News)
```

All fetch paths in `energy.js` updated from `/data/foo.json` → `/data/energy/foo.json`. Same for food.

### `entrypoint.sh` additions

Four new shell functions, each following the existing `fetch_fuel_prices` pattern:

- `fetch_oil_prices()` — EIA WTI → `data/energy/oil-prices.json`
- `fetch_gas_prices()` — EIA Henry Hub → `data/energy/gas-prices.json`
- `fetch_wheat_prices()` — FRED `PWHEAMTUSDM` → `data/food/wheat-prices.json`
- `fetch_food_events()` — Google News RSS + parser → `data/food/food-events.json`

The existing `fetch_fuel_prices` is updated to write to `data/energy/fuel-prices.json` and the existing `fetch_disruption_news` to `data/energy/disruptions.json`.

The 6h background loop calls all six fetchers.

### Seed data

Each new JSON file ships with a small seed (5–10 plausible records) so local dev (Option 1 in README — no Docker, no API keys) renders something sensible instead of empty states.

---

## 7. Identity rename

### Local + repo

- Folder: `jet-fuel-shortage-tracker` → `efc-tracker` (user runs `mv` — out of scope for code changes)
- GitHub repo rename: user does this in the GitHub UI
- All in-code references to "FuelWatch", "fuelwatch", "Aviation Disruption Tracker", "Jet Fuel Shortage Tracker" → updated to "EFC Tracker" / "efc-tracker" / "Energy & Food Crisis Tracker"
- `window.FUELWATCH_CONFIG` → `window.EFC_CONFIG`
- README rewritten end-to-end

### Fly.io migration

Fly app names are immutable identifiers — renaming means create-new + cut-over + destroy-old. Ordered migration plan:

1. **Build & test locally** — all code changes verified with Docker locally
2. **Create new Fly app:** `fly apps create efc-tracker`
3. **Set secrets on new app:**
   - `fly secrets set EIA_API_KEY=$existing_value --app efc-tracker`
   - `fly secrets set FRED_API_KEY=$new_value --app efc-tracker`
4. **Update `fly.toml`:** `app = "efc-tracker"`, region `arn` (current)
5. **Deploy to new app:** `fly deploy --app efc-tracker`
6. **Verify:** `fly logs --app efc-tracker` shows successful EIA + FRED + RSS fetches; visit `efc-tracker.fly.dev` and exercise both modes
7. **Issue new deploy token:** `fly tokens create deploy -x 999999h --app efc-tracker`
8. **Update GitHub Actions:** `.github/workflows/refresh-data.yml` — change `--app fuelwatch-dashboard` to `--app efc-tracker`. Update `FLY_API_TOKEN` repo secret with the new token
9. **Verify cron:** trigger the workflow manually from the Actions tab, confirm restart succeeds
10. **Destroy old app:** `fly apps destroy fuelwatch-dashboard` (only after 9 is green)

Each step is a checkpoint — no destructive action (step 10) happens until the new app is verified live.

---

## 8. Files changed summary

| File | Change |
|---|---|
| `public/index.html` | Mode tab bar added; sidebar nav becomes a render target; food view sections added; new `<script>` tags for shared/energy/food; title/meta/info-popover/footer rebranded |
| `public/styles.css` | Mode tab styles; minor food-mode accent color (e.g. green for the food tab) |
| `public/shared.js` | NEW — utilities, mode plugin API, routing |
| `public/energy.js` | NEW — extracted from current `app.js`; adds WTI/HH chart cards in Analytics |
| `public/food.js` | NEW — food overview, food events table, food filters |
| `public/app.js` | Reduced to ~30-line bootstrap |
| `public/favicon.svg` | Keep (amber flame works for both energy heat and harvest) |
| `public/data/energy/*` | Moved from `public/data/*` |
| `public/data/food/wheat-prices.json` | NEW seed |
| `public/data/food/food-events.json` | NEW seed |
| `entrypoint.sh` | Four new fetch functions; updated paths for moved files; updated config.js to write `EFC_CONFIG` |
| `fly.toml` | App name → `efc-tracker` |
| `.github/workflows/refresh-data.yml` | App name → `efc-tracker` |
| `Dockerfile` | No change (nginx/curl/jq/xmlstarlet still cover everything) |
| `README.md` | Full rewrite for new identity and dual-domain feature set |

---

## 9. Out of scope for v1

Explicitly deferred to keep this iteration shippable:

- Adding more food commodities beyond wheat (corn, rice, fertilizer prices)
- Cross-domain correlations on a unified Overview ("food crisis vs energy spike" charts)
- Country/region maps for the food side (no airport-equivalent geographic anchor)
- Replacing Google News RSS with a paid news API
- Per-mode KPI deep-dive views beyond what already exists / what's specified for food
- Fly app redirect from old URL to new (cutover is hard — old URL goes dark after step 10)
- Browser-tab-level "you have a new energy alert" notifications

---

## 10. Success criteria

- `efc-tracker.fly.dev` loads with mode tabs visible, defaulting to Energy mode
- Energy mode shows all 5 existing views with no regressions
- Energy mode's Analytics view shows three chart cards: jet fuel, WTI, Henry Hub — all pulling live data from EIA
- Food mode shows two views (Overview, Events) with wheat chart from FRED and parsed food news events from Google News
- Filter bar swaps content correctly when modes change; filters apply only within their own mode
- Mode preference persists across page reloads
- All six data fetchers run successfully on container startup; logs show record counts
- 6h background loop refreshes all six data files
- Old `fuelwatch-dashboard` Fly app is destroyed and the new app is the canonical home
- GitHub Actions cron successfully restarts the new app daily at 06:00 UTC
- README accurately reflects the new project, including all data sources and limitations
