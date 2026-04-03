# FuelWatch — Aviation Kerosene Disruption Tracker

A single-page dashboard for monitoring airlines impacted by jet fuel / kerosene shortages. Tracks cancellations, affected routes, severity, and historical fuel pricing.

---

## Project Structure

```
jet-fuel-shortage-traker/
├── public/
│   └── index.html        ← Complete self-contained app (HTML + CSS + JS)
├── Dockerfile            ← nginx:alpine static site image
├── fly.toml              ← Fly.io deployment config
└── README.md
```

The entire application lives in `public/index.html`. All CSS and JavaScript are embedded inline — no build step required.

---

## Run Locally

Open `public/index.html` directly in any modern browser:

```bash
# macOS
open public/index.html

# Linux
xdg-open public/index.html

# Or serve with any local HTTP server:
npx serve public
# then open http://localhost:3000
```

No npm install, no bundler, no server required.

---

## Deploy to Fly.io

### Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed
- A Fly.io account: `fly auth login`

### Steps

```bash
# 1. Edit fly.toml — change the app name:
#    app = "your-app-name"

# 2. First-time setup (do once):
fly launch --no-deploy

# 3. Deploy:
fly deploy

# 4. Open in browser:
fly open
```

> **Note:** `fly.toml` sets `internal_port = 80` to match nginx. Do not change this.

The app runs as a single nginx container on `shared-cpu-1x` (256 MB). Cost is effectively $0 with `auto_stop_machines = true` when idle.

---

## Mock Data & Real Data Adapters

### Where mock data lives

All seeded data is in `public/index.html` in **Section 1**:

| Constant | Description |
|---|---|
| `SEED_AIRLINES` | Four carrier definitions |
| `SEED_DISRUPTIONS` | Eight realistic disruption events |
| `SEED_FUEL_PRICES` | 65 weekly price points (Jan 2024 – Apr 2025) |

### How to replace with live data

The adapter functions in **Section 2** (`fetchFuelPrices`, `fetchDisruptionEvents`) are the only integration points you need to touch.

**Option A — Static JSON files (simplest)**

1. Create `public/data/fuel-prices.json` and `public/data/disruptions.json`
2. Use a scheduled job (cron, GitHub Actions, Fly.io machines) to regenerate them from the real source
3. In `fetchFuelPrices()`, replace the body with:
   ```js
   const r = await fetch('/data/fuel-prices.json');
   return normalizeFuelPriceData(await r.json());
   ```
4. Same pattern for `fetchDisruptionEvents()`.

**Option B — Live EIA API (fuel prices)**

EIA WJFUELUSGULF series (free API key required):
```
https://api.eia.gov/v2/petroleum/pri/wfr/data/?api_key=YOUR_KEY
  &frequency=weekly&data[0]=value&facets[product][]=EPD2F
  &sort[0][column]=period&sort[0][direction]=desc&length=65
```
Sign up: https://www.eia.gov/opendata/

> **CORS note:** EIA and FRED APIs do not set permissive CORS headers.
> Direct browser fetch will be blocked in production.
> Recommended: proxy through a lightweight backend or schedule a sync job
> that writes to `public/data/fuel-prices.json`.

**Option C — FRED API (WJFUELUSGULF)**

```
https://api.stlouisfed.org/fred/series/observations
  ?series_id=WJFUELUSGULF&api_key=YOUR_KEY&file_type=json
```
Sign up: https://fred.stlouisfed.org/docs/api/api_key.html

Same CORS limitation applies — use a backend proxy or static JSON sync.

### Normalization

Both `normalizeFuelPriceData(raw)` and `normalizeDisruptionData(raw)` accept
any shape of raw input and return the clean schema used throughout the app.
Adapt them as needed when connecting real sources.

---

## Fuel Price Sources

| Source | Series | Notes |
|---|---|---|
| [EIA Petroleum](https://www.eia.gov/petroleum/gasdiesel/) | WJFUELUSGULF | US Gulf Coast Kerosene, weekly, $/gallon |
| [FRED](https://fred.stlouisfed.org/series/WJFUELUSGULF) | WJFUELUSGULF | Same series via St. Louis Fed |
| [IATA Fuel Monitor](https://www.iata.org/en/publications/economics/fuel-monitor/) | N/A | Industry reference, no public API |

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | Vanilla HTML / CSS / JavaScript |
| Charts | [Chart.js 4.4](https://www.chartjs.org/) via jsDelivr CDN |
| Sanitization | [DOMPurify 3.1](https://github.com/cure53/DOMPurify) via jsDelivr CDN |
| Fonts | Google Fonts (Syne, Outfit, JetBrains Mono) |
| Hosting | Fly.io via nginx:alpine Docker image |

No build step, no framework, no localStorage, no sessionStorage.
