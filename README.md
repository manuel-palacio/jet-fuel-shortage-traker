# EFC Tracker — Energy & Food Crisis Tracker

A single-page dashboard for monitoring two crisis domains in parallel: **Energy** (jet fuel, WTI crude, Henry Hub natural gas, plus aviation disruption news) and **Food** (global wheat prices and food crisis news).

Live: **https://efc-tracker.fly.dev**

---

## Project Structure

```
efc-tracker/
├── public/
│   ├── index.html            ← SPA shell
│   ├── styles.css            ← All styles (Material-Design tokens, mode tabs, ...)
│   ├── shared.js             ← EFC namespace: utilities, mode plugin API, routing
│   ├── energy.js             ← Energy mode plugin (5 views)
│   ├── food.js               ← Food mode plugin (2 views)
│   ├── app.js                ← 5-line bootstrap
│   ├── favicon.svg           ← Amber flame icon
│   └── data/
│       ├── energy/
│       │   ├── airports.json     ← 16 European airport stockpile data
│       │   ├── disruptions.json  ← Aviation disruption events (live RSS)
│       │   ├── fuel-prices.json  ← EIA jet fuel history (live)
│       │   ├── oil-prices.json   ← EIA WTI crude history (live)
│       │   └── gas-prices.json   ← EIA Henry Hub gas history (live)
│       └── food/
│           ├── wheat-prices.json ← FRED PWHEAMTUSDM monthly (live)
│           └── food-events.json  ← Food crisis events (live RSS)
├── .github/
│   └── workflows/
│       └── refresh-data.yml  ← Daily cron: restarts Fly machine to refresh data
├── docs/
│   └── superpowers/
│       ├── specs/            ← Design specifications
│       └── plans/            ← Implementation plans
├── Dockerfile                ← nginx:alpine + curl + jq + xmlstarlet
├── entrypoint.sh             ← Container entry: 6 server-side fetchers + nginx
├── fly.toml                  ← Fly.io deployment (app: efc-tracker, region: arn)
└── package.json              ← Dev tooling only (live-server)
```

---

## Modes

The app has two top-level modes, switched via the **mode tabs** above the header. Each mode owns its own sidebar, filter bar, and views.

### ⚡ Energy mode

| Route | View | Description |
|---|---|---|
| `#energy/overview` | Fleet Overview | Energy KPIs, jet-fuel chart, cancellation timeline, disruption table |
| `#energy/airports` | Airport Inventory | 16 European airports with cover-day indicators |
| `#energy/map` | Europe Risk Map | Leaflet map with color-coded risk bubbles |
| `#energy/disruptions` | Disruptions | Full disruption events table |
| `#energy/analytics` | Analytics | Jet fuel trend, regional breakdown, seasonality, **WTI crude**, **Henry Hub gas** |

Filters: airline, region, country, impact type, severity, search. Plus the **Summer Mode** toggle (+35% demand multiplier, tightened risk thresholds).

### 🌾 Food mode

| Route | View | Description |
|---|---|---|
| `#food/overview` | Food Overview | Wheat KPIs (latest price, MoM change, top affected country), wheat price chart, recent events list |
| `#food/events` | Food Events | Filterable table of food crisis news |

Filters: commodity, region, country, event type, severity, search.

Mode preference persists in `localStorage`. Bookmarked legacy URLs (`#overview`, `#analytics`, etc.) silently rewrite to their `#energy/<view>` equivalents.

---

## Architecture

### Code organization

Three top-level scripts loaded by `index.html`, in order:

```
shared.js  → window.EFC namespace (DOM helpers, fetchJSON, mode plugin API,
             hash routing, theme/sidebar/info-popover infrastructure)
energy.js  → calls EFC.registerMode({ id: 'energy', ... })
food.js    → calls EFC.registerMode({ id: 'food', ... })
app.js     → 5-line bootstrap that calls EFC.start() on DOMContentLoaded
```

`shared.js` is domain-agnostic. Each mode is a self-contained plugin: it declares views, filters, and optional `onThemeChange` / `onSidebarChange` hooks. Adding a third mode is a fourth `<script>` tag and another `EFC.registerMode(...)` call.

### Data flow

```
Container start
  └── entrypoint.sh
        ├── fetch_fuel_prices()    → energy/fuel-prices.json   (EIA EPJK)
        ├── fetch_oil_prices()     → energy/oil-prices.json    (EIA EPCWTI)
        ├── fetch_gas_prices()     → energy/gas-prices.json    (EIA Henry Hub)
        ├── fetch_disruption_news()→ energy/disruptions.json   (Google News RSS)
        ├── fetch_wheat_prices()   → food/wheat-prices.json    (FRED PWHEAMTUSDM)
        ├── fetch_food_events()    → food/food-events.json     (Google News RSS)
        ├── Background loop: re-fetch all six every 6 hours
        └── Hand off to nginx

Browser loads app
  └── EFC.start() (after DOMContentLoaded)
        ├── Read URL hash → pick initial mode
        ├── Activate mode → mode.init() loads its own JSON files
        └── Render the view from URL hash

Daily refresh (GitHub Actions cron 06:00 UTC)
  └── flyctl machines restart → triggers entrypoint.sh
```

### Key design decisions

| Decision | Rationale |
|---|---|
| Server-side fetchers | EIA / FRED / Google News have no CORS headers — direct browser fetch blocked |
| Static JSON files | Simplest cache primitive; nginx serves with 1h Cache-Control |
| API keys in Fly secrets | Keys never reach the browser; `entrypoint.sh` interpolates them server-side |
| Mode plugin API | Adding a third mode = one `EFC.registerMode(...)` call, no shell changes |
| Hash routing (`#mode/view`) | SPA navigation without build tooling or framework |
| Leaflet.js (CDN) | Zero-config interactive maps, dark theme tiles via CartoDB |
| DOMPurify for all innerHTML | `EFC.safeHTML()` is the single chokepoint for XSS prevention |
| 6-hour background refresh | Keeps data current without container restarts |
| No build step | Deploy is `docker build` + `fly deploy`. No npm in production. |

---

## Data Sources & Limitations

| Data | Source | Live? | Notes |
|---|---|---|---|
| **Jet fuel prices** | [EIA API v2](https://www.eia.gov/opendata/) — `EPJK/RGC` | Yes — 6h | US Gulf Coast Kerosene-Type Jet Fuel spot, weekly, $/gallon |
| **WTI crude prices** | EIA API v2 — `EPCWTI/RWTC` | Yes — 6h | West Texas Intermediate, Cushing OK, daily, $/barrel |
| **Henry Hub gas prices** | EIA API v2 — `RNGWHHD` | Yes — 6h | Henry Hub LA, daily, $/MMBtu |
| **Wheat prices** | [FRED API](https://fred.stlouisfed.org/) — `PWHEAMTUSDM` | Yes — 6h (monthly cadence, ~6-week lag) | Global Price of Wheat, $/metric ton (World Bank) |
| **Aviation disruption events** | [Google News RSS](https://news.google.com/) | Yes — 6h | Headlines parsed via xmlstarlet + jq; airline/severity inferred from text |
| **Food events** | Google News RSS | Yes — 6h | Headlines parsed with food-domain heuristics (commodity / country / event type / severity) |
| **Airport list** | Hand-curated | No | 16 major European airports; coordinates from public databases |
| **Storage capacity (ML)** | Modelled estimate | No | Fabricated based on airport size; real values are commercially confidential |
| **Daily burn (ML/day)** | Modelled estimate | No | Rough estimates from traffic volume; not real fuel uplift data |
| **Cover days** | Derived | Computed | `storage_capacity_ml / daily_burn_ml` — only as accurate as the inputs |
| **Import dependency** | Modelled estimate | No | HIGH/MED/LOW based on public refinery + pipeline geography |
| **Import Risk Index** | Computed composite | Computed | Combines import dependency, cover-day stress, fuel price level |
| **Summer demand multiplier** | IATA estimate | No | +35% based on IATA peak-season load factor data |
| **Seasonality chart** | Modelled index | No | Illustrative monthly demand index 80–135 |

### Honest limitations

- **News parsing is heuristic.** Both aviation and food event tables use regex-based commodity/country/severity inference. Edge cases get miscategorized; the data is best treated as a triage feed, not an authoritative event log.
- **Wheat data lags.** FRED's PWHEAMTUSDM is monthly with a ~6-week publishing lag. The chart will look like step changes, not a daily wiggling line. This is honest about the source.
- **No food map equivalent.** The Energy mode has a country/airport map. Food doesn't — wheat data isn't anchored to a single geographic point.

What would make it production-grade: airport fuel inventory partnerships (AFQRJOS, Schiphol consortium), Platts/Argus pricing, EUROCONTROL / FlightAware feeds, IEA refinery output data, USDA / FAO direct grain feeds.

---

## Run Locally

Three options, increasing data fidelity:

### Option 1: Static file server (no API data, fastest)

```bash
cd public && python3 -m http.server 8080
# open http://localhost:8080
```

Uses the seed JSON files committed to the repo. No Docker, no API keys.

### Option 2: npm run dev (auto-reload)

```bash
npm install   # one-time, installs live-server
npm run dev
# open http://localhost:5500
```

Same as Option 1 with browser auto-reload on file change. Convenient for active UI work.

### Option 3: Docker with live data

```bash
docker build -t efc-tracker .
docker run -p 8080:80 \
  -e EIA_API_KEY=your_eia_key \
  -e FRED_API_KEY=your_fred_key \
  efc-tracker
# open http://localhost:8080
```

Runs the full server-side pipeline. Free API keys:
- EIA: https://www.eia.gov/opendata/
- FRED: https://fred.stlouisfed.org/docs/api/api_key.html

---

## Deploy to Fly.io

### Required Secrets

| Secret | Description |
|---|---|
| `EIA_API_KEY` | Free EIA API key — powers jet fuel + WTI + Henry Hub fetchers |
| `FRED_API_KEY` | Free FRED API key — powers wheat price fetcher |

```bash
# One-time setup
fly apps create efc-tracker
fly secrets set EIA_API_KEY=your_key  --app efc-tracker
fly secrets set FRED_API_KEY=your_key --app efc-tracker

# Deploy
fly deploy

# Open
fly open
```

### Verify

```bash
fly logs --app efc-tracker
# Should show six "<file>.json written: N records" lines within ~30 seconds
```

---

## Daily Data Refresh

Data is fetched at container start and every 6 hours via a background loop in `entrypoint.sh`. The GitHub Actions workflow `.github/workflows/refresh-data.yml` additionally restarts the Fly machine daily at **06:00 UTC** to force a fresh fetch.

### Setup (one-time)

1. Create a Fly.io deploy token:
   ```bash
   fly tokens create deploy -x 999999h --app efc-tracker
   ```
2. Add it as a GitHub repo secret: **Settings → Secrets → Actions → `FLY_API_TOKEN`**

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | Vanilla HTML / CSS / JavaScript (no framework, no build) |
| Charts | [Chart.js 4.4](https://www.chartjs.org/) via jsDelivr |
| Maps | [Leaflet.js 1.9](https://leafletjs.com/) via unpkg |
| Sanitization | [DOMPurify 3.1](https://github.com/cure53/DOMPurify) via jsDelivr |
| Fonts | Google Fonts — Space Grotesk (display), Inter (UI), JetBrains Mono (data) |
| Icons | Material Symbols Outlined |
| Hosting | [Fly.io](https://fly.io) via nginx:alpine Docker image |
| Server-side fetch | curl + jq + xmlstarlet in `entrypoint.sh` |
| Data sources | EIA v2 API · FRED API · Google News RSS |
| Refresh | GitHub Actions cron + entrypoint.sh background loop |
| Dev tooling | live-server (only — `npm run dev`); not used in production |

No framework. No bundler. No transpilation.
