# FuelWatch — Aviation Kerosene Disruption Tracker

A single-page dashboard for monitoring airlines impacted by jet fuel / kerosene shortages. Tracks
cancellations, affected routes, severity, and live historical fuel pricing from EIA.

Live: **https://fuelwatch-dashboard.fly.dev**

---

## Project Structure

```
jet-fuel-shortage-traker/
├── public/
│   ├── index.html        ← Complete self-contained SPA (HTML + CSS + JS, ~1,540 lines)
│   └── favicon.svg       ← Amber flame icon matching dashboard accent color
├── .github/
│   └── workflows/
│       └── refresh-data.yml  ← Daily cron: restarts Fly machine to refresh EIA data
├── Dockerfile            ← nginx:alpine image with curl + jq for server-side EIA fetch
├── entrypoint.sh         ← Runs at container start; fetches EIA, writes fuel-prices.json
├── fly.toml              ← Fly.io deployment config (app: fuelwatch-dashboard, region: iad)
└── README.md
```

The entire application lives in `public/index.html`. All CSS and JavaScript are embedded inline —
no build step, no npm, no bundler required.

---

## Architecture

### Data Flow

```
Container start
  └── entrypoint.sh
        ├── curl https://api.eia.gov/v2/petroleum/pri/spt/... (uses EIA_API_KEY secret)
        ├── jq transforms raw response → [{date, price, source, series_id}]
        └── writes /usr/share/nginx/html/data/fuel-prices.json

Browser loads app
  └── fetchFuelPrices()
        ├── GET /data/fuel-prices.json  (served by nginx, Cache-Control: max-age=3600)
        └── falls back to SEED_FUEL_PRICES if file missing or HTTP error

Daily refresh (GitHub Actions cron 06:00 UTC)
  └── flyctl machines restart --app fuelwatch-dashboard
        └── triggers entrypoint.sh again → fresh EIA fetch
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Server-side EIA fetch (not browser) | EIA API has no CORS headers — direct browser fetch is blocked in production |
| Static JSON file, not database | Simplest caching primitive; nginx serves with 1h Cache-Control |
| No localStorage / sessionStorage | Explicit requirement; server-side cache replaces client-side storage |
| EIA key in Fly.io secret | Key never reaches the browser — `config.js` contains only `window.FUELWATCH_CONFIG = {}` |
| nginx:alpine + curl + jq | Python3 not included in nginx:alpine; jq is smaller and purpose-built for JSON |
| `curl -g` (not wget) | `wget` treats `[0]` in EIA URL as a glob range and fails; `-g` disables curl globbing |
| Chart.js `.destroy()` before re-render | Prevents canvas context leak when theme is toggled or filters change |
| DOMPurify for all innerHTML | Pre-commit hook enforces XSS safety; `safeHTML()` centralizes all sanitization |

---

## EIA Data Source

The app fetches **US Gulf Coast Kerosene-Type Jet Fuel Spot Prices** from EIA API v2.

| Field | Value |
|---|---|
| Endpoint | `/v2/petroleum/pri/spt/data/` |
| Product | `EPJK` (Kerosene-Type Jet Fuel) |
| Area | `RGC` (US Gulf Coast) |
| Frequency | Weekly |
| Units | $/gallon |
| Current price (Mar 2026) | ~$4.009/gal |

Free API key: https://www.eia.gov/opendata/

> **Note:** The product code is `EPJK`, not `EPD2F` (which is heating oil). The endpoint is
> `/pri/spt/` (spot prices), not `/pri/wfr/` (retail/weekly retail).

---

## Run Locally

Open `public/index.html` directly — the app works without a server (uses seed data as fallback):

```bash
# macOS
open public/index.html

# Linux
xdg-open public/index.html

# Or serve via HTTP (loads live /data/fuel-prices.json if present):
npx serve public
# then open http://localhost:3000
```

To test the full server-side EIA fetch locally with Docker:

```bash
docker build -t fuelwatch .
docker run -p 8080:80 -e EIA_API_KEY=your_key_here fuelwatch
# open http://localhost:8080
```

---

## Deploy to Fly.io

### Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated
- `fly auth login`

### Steps

```bash
# 1. Set the EIA API key as a Fly.io secret (done once):
fly secrets set EIA_API_KEY=your_key_here --app fuelwatch-dashboard

# 2. Deploy:
fly deploy

# 3. Open in browser:
fly open
```

The app runs as a single nginx container on `shared-cpu-1x` (256 MB RAM). Cost is effectively $0
with `auto_stop_machines = "stop"` when idle.

### Verify data is loading

```bash
# Check logs to confirm EIA fetch succeeded:
fly logs --app fuelwatch-dashboard

# SSH in and inspect the cached file:
fly ssh console --app fuelwatch-dashboard
cat /usr/share/nginx/html/data/fuel-prices.json | head -20
```

A successful deploy logs:
```
Fetching EIA Gulf Coast jet fuel prices (EPJK/RGC)...
fuel-prices.json written: 169 records, latest: 2026-03-27 $4.009/gal
config.js written
```

---

## Daily Data Refresh

EIA data is fetched once at container start. To refresh without a full redeploy, the GitHub Actions
workflow `.github/workflows/refresh-data.yml` restarts the Fly machine daily at **06:00 UTC**.

### Setup (one-time)

1. **Create a Fly.io deploy token:**
   ```bash
   fly tokens create deploy -x 999999h --app fuelwatch-dashboard
   ```
   Copy the output token.

2. **Add it as a GitHub secret:**
   Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FLY_API_TOKEN`
   - Value: paste the token from step 1

3. **Push the workflow file** (requires a GitHub token with `workflow` scope):
   - In GitHub → **Settings → Developer settings → Personal access tokens → Edit** your token
   - Check the `workflow` checkbox → Save
   - Then push: `git push origin main`

The cron can also be triggered manually from the GitHub Actions tab via **workflow_dispatch**.

---

## Seed Data

When `/data/fuel-prices.json` is not available (local dev, missing EIA key), the app falls back to
embedded seed data defined at the top of `public/index.html`:

| Constant | Description |
|---|---|
| `SEED_AIRLINES` | Four carrier definitions (United, SAS, American, Air New Zealand) |
| `SEED_DISRUPTIONS` | Eight realistic disruption events |
| `SEED_FUEL_PRICES` | 65 weekly price points (Jan 2024 – Apr 2025, $2.41–$2.95/gal) |

---

## Replacing Seed Data with Live Disruption Data

The adapter functions in `public/index.html` are the only integration points needed for adding
live disruption data:

- `fetchDisruptionEvents()` — returns an array of disruption objects
- `normalizeDisruptionData(raw)` — converts any raw shape to the app's schema

**Expected disruption schema:**
```json
{
  "id": "unique-string",
  "airline": "Airline Name",
  "date": "2026-03-15",
  "routes_affected": 42,
  "cancellations": 18,
  "severity": "high",
  "impact_type": "cancellation",
  "fuel_price_at_event": 4.01,
  "region": "North America",
  "notes": "Free text description"
}
```

Severity values: `"low"`, `"moderate"`, `"high"`, `"critical"`
Impact type values: `"cancellation"`, `"delay"`, `"route_suspension"`, `"capacity_reduction"`

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | Vanilla HTML / CSS / JavaScript (no framework) |
| Charts | [Chart.js 4.4](https://www.chartjs.org/) via jsDelivr CDN |
| Sanitization | [DOMPurify 3.1](https://github.com/cure53/DOMPurify) via jsDelivr CDN |
| Fonts | Google Fonts — Syne (display), Outfit (UI), JetBrains Mono (numeric data) |
| Hosting | [Fly.io](https://fly.io) via nginx:alpine Docker image |
| Data | [EIA API v2](https://www.eia.gov/opendata/) — EPJK/RGC spot price, free key |
| Refresh | GitHub Actions cron → `flyctl machines restart` |

No build step. No framework. No localStorage. No sessionStorage.

---

## Fuel Price Sources

| Source | Series | Notes |
|---|---|---|
| [EIA Petroleum](https://www.eia.gov/opendata/) | EPJK/RGC | US Gulf Coast Kerosene-Type Jet Fuel, weekly spot, $/gallon |
| [FRED](https://fred.stlouisfed.org/series/WJFUELUSGULF) | WJFUELUSGULF | Same series via St. Louis Fed (same CORS limitation) |
| [IATA Fuel Monitor](https://www.iata.org/en/publications/economics/fuel-monitor/) | N/A | Industry reference, no public API |
