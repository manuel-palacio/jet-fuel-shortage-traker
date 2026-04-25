# FuelWatch — Aviation Kerosene Disruption Tracker

A single-page dashboard for monitoring jet fuel shortages across European airports, airline disruptions, and live kerosene pricing from EIA.

Live: **https://fuelwatch-dashboard.fly.dev**

---

## Project Structure

```
jet-fuel-shortage-tracker/
├── public/
│   ├── index.html          ← SPA shell (HTML + CSS)
│   ├── app.js              ← Application logic (routing, rendering, data)
│   ├── favicon.svg         ← Amber flame icon
│   └── data/
│       ├── airports.json   ← 15 European airport fuel stockpile data
│       ├── disruptions.json← Disruption events (seed data)
│       └── fuel-prices.json← EIA fuel price history (seed / live)
├── .github/
│   └── workflows/
│       └── refresh-data.yml← Daily cron: restarts Fly machine to refresh EIA data
├── Dockerfile              ← nginx:alpine image with curl + jq for server-side EIA fetch
├── entrypoint.sh           ← Runs at container start; fetches EIA, writes fuel-prices.json
├── fly.toml                ← Fly.io deployment config (app: fuelwatch-dashboard, region: iad)
└── docs/
    └── superpowers/specs/  ← Design specifications
```

---

## Features

### Views (hash-based routing)

| Route | View | Description |
|-------|------|-------------|
| `#overview` | Fleet Overview | KPIs, fuel price chart, cancellation timeline, disruption table |
| `#airports` | Airport Inventory | Card grid of 15 European airports with cover-day indicators |
| `#map` | Europe Risk Map | Leaflet.js map with color-coded risk bubbles per airport |
| `#disruptions` | Disruptions | Full disruption events table (all columns visible) |
| `#analytics` | Analytics | Fuel price trend, regional breakdown, seasonal demand chart |

### Key Features

- **Supply-focused KPIs** — Avg cover days, airports at risk, fuel price, import risk index, cancellations, critical events
- **Summer mode toggle** — +35% demand multiplier, tightened risk thresholds (auto-active Jun–Aug)
- **Live EIA data** — Server-side fetch with 6-hour background refresh
- **Interactive map** — Leaflet.js with CartoDB dark/light tiles, click-to-detail
- **Responsive** — Mobile-first with collapsible sidebar, 1–4 column card grids

### Airports Tracked

LHR, FRA, CDG, AMS, MAD, BCN, FCO, MUC, ZRH, VIE, IST, DUB, CPH, OSL, LIS

---

## Architecture

### Data Flow

```
Container start
  └── entrypoint.sh
        ├── fetch_fuel_prices() — curl EIA API → jq → fuel-prices.json
        ├── Background loop: re-fetch every 6 hours
        └── Hand off to nginx

Browser loads app
  └── app.js init()
        ├── fetch('/data/disruptions.json')
        ├── fetch('/data/fuel-prices.json')
        ├── fetch('/data/airports.json')
        └── Render views based on URL hash

Daily refresh (GitHub Actions cron 06:00 UTC)
  └── flyctl machines restart → triggers entrypoint.sh
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Server-side EIA fetch | EIA API has no CORS headers — direct browser fetch blocked |
| Static JSON files | Simplest caching primitive; nginx serves with 1h Cache-Control |
| No localStorage | Server-side cache replaces client-side storage |
| EIA key in Fly.io secret | Key never reaches the browser |
| Separate app.js | Clarity — CSS in HTML, logic in JS, data in JSON |
| Hash routing | SPA navigation without build tooling or framework |
| Leaflet.js (CDN) | Zero-config interactive maps, dark theme tiles via CartoDB |
| DOMPurify for all innerHTML | `safeHTML()` centralizes XSS prevention |
| 6-hour background refresh | Keeps fuel prices current without container restarts |

---

## EIA Data Source

| Field | Value |
|---|---|
| Endpoint | `/v2/petroleum/pri/spt/data/` |
| Product | `EPJK` (Kerosene-Type Jet Fuel) |
| Area | `RGC` (US Gulf Coast) |
| Frequency | Weekly |
| Units | $/gallon |

Free API key: https://www.eia.gov/opendata/

> **Note:** Product code is `EPJK`, not `EPD2F` (heating oil). Endpoint is `/pri/spt/` (spot prices).

---

## Data Sources & Limitations

Not all data in this dashboard comes from live APIs. The table below clarifies what is real, what is modelled, and what is static seed data.

| Data | Source | Live? | Notes |
|------|--------|-------|-------|
| **Jet fuel prices** | [EIA API v2](https://www.eia.gov/opendata/) | **Yes** — refreshed every 6h | US Gulf Coast Kerosene-Type Jet Fuel spot price (EPJK/RGC). Weekly frequency, $/gallon. Fetched server-side by `entrypoint.sh`. |
| **Disruption events** | [Google News RSS](https://news.google.com/) | **Yes** — refreshed every 6h | `entrypoint.sh` fetches Google News RSS for fuel disruption keywords, parses with xmlstarlet + jq, extracts airline/country/severity from headlines. Falls back to empty array locally. |
| **Airport list** | Hand-curated | **No** — static JSON | 16 major European airports selected manually. Coordinates are real (from public aviation databases). |
| **Storage capacity (ML)** | Modelled estimate | **No** — fabricated | Plausible values based on airport size and hub status. Real fuel storage capacities are commercially sensitive and not publicly available. |
| **Daily burn (ML/day)** | Modelled estimate | **No** — fabricated | Rough estimates based on airport traffic volume. Not sourced from actual fuel uplift data. |
| **Cover days** | Derived | Computed | `storage_capacity_ml / daily_burn_ml`. Only as accurate as the two modelled inputs. |
| **Import dependency** | Modelled estimate | **No** — directionally correct | Based on publicly known refinery and pipeline geography (e.g., Switzerland has no refineries → HIGH). The HIGH/MED/LOW ratings are defensible but not sourced from a specific dataset. |
| **Import Risk Index** | Computed composite | Computed | Combines import dependency scores, cover-day stress, and fuel price level. Formula in `app.js computeKPIs()`. |
| **Summer demand multiplier** | IATA estimate | **No** — fixed constant | +35% based on IATA peak-season load factor data. Applied uniformly to all airports when Summer Mode is active. |
| **Seasonality chart** | Modelled index | **No** — illustrative | Monthly demand index (80–135) showing Jun–Aug peak. Not sourced from per-airport consumption data. |

### What would make this production-grade

To move beyond illustrative estimates, you would need:

- **Airport fuel inventory** — Data partnerships with airport fuel consortia (e.g., AFQRJOS at Heathrow, Schiphol fuel consortium) or energy intelligence providers (Platts, Argus, Wood Mackenzie)
- **Live disruption events** — Integration with airline ops feeds, EUROCONTROL, or FlightAware
- **Per-airport consumption** — Actual fuel uplift volumes from airport authorities or IATA statistics
- **Regional refinery output** — IEA or national energy agency data on refinery throughput and jet fuel yield

---

## Run Locally

There are three ways to run the dashboard locally, each with different levels of data availability:

### Option 1: Static file server (no API data)

Serves the app with seed/empty data — no Docker, no API keys needed.

```bash
# Using Python:
cd public && python3 -m http.server 8080
# open http://localhost:8080

# Using npx:
npx serve public
# open http://localhost:3000

# Using IntelliJ/WebStorm:
# Right-click public/index.html → Open in → Browser
# Or use the built-in HTTP server (port shown in toolbar)
```

Fuel prices and disruption news will be empty (seed data). Airport data loads from `public/data/airports.json`.

### Option 2: Docker with live EIA data

Runs the full server-side pipeline — fetches live fuel prices and news at container start.

```bash
docker build -t fuelwatch .
docker run -p 8080:80 -e EIA_API_KEY=your_key_here fuelwatch
# open http://localhost:8080
```

Get a free EIA API key at https://www.eia.gov/opendata/

---

## Deploy to Fly.io

### Required Secrets

| Secret | Description |
|---|---|
| `EIA_API_KEY` | Free EIA API key for live fuel price data |

```bash
# Set EIA key (one-time):
fly secrets set EIA_API_KEY=your_key_here --app fuelwatch-dashboard

# Deploy:
fly deploy

# Open:
fly open
```

### Verify

```bash
fly logs --app fuelwatch-dashboard
# Should show: fuel-prices.json written: N records, latest: YYYY-MM-DD $X.XXX/gal
```

---

## Daily Data Refresh

EIA data is fetched at container start and every 6 hours via background loop. The GitHub Actions workflow `.github/workflows/refresh-data.yml` additionally restarts the Fly machine daily at **06:00 UTC**.

### Setup (one-time)

1. Create a Fly.io deploy token:
   ```bash
   fly tokens create deploy -x 999999h --app fuelwatch-dashboard
   ```
2. Add as GitHub secret: **Settings → Secrets → Actions** → `FLY_API_TOKEN`

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | Vanilla HTML / CSS / JavaScript (no framework) |
| Charts | [Chart.js 4.4](https://www.chartjs.org/) via jsDelivr CDN |
| Maps | [Leaflet.js 1.9](https://leafletjs.com/) via unpkg CDN |
| Sanitization | [DOMPurify 3.1](https://github.com/cure53/DOMPurify) via jsDelivr CDN |
| Fonts | Google Fonts — Space Grotesk (display), Inter (UI), JetBrains Mono (data) |
| Icons | Material Symbols Outlined |
| Hosting | [Fly.io](https://fly.io) via nginx:alpine Docker image |
| Data | [EIA API v2](https://www.eia.gov/opendata/) — EPJK/RGC spot price |
| Refresh | GitHub Actions cron + entrypoint.sh background loop |

No build step. No framework. No npm.
