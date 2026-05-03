# EFC Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-domain jet fuel tracker into a dual-domain Energy & Food Crisis Tracker (EFC Tracker), with mode tabs, two new energy data series (WTI crude, Henry Hub gas), a new food mode (wheat prices + parsed food-events news), full code rebrand, and a Fly.io app migration.

**Architecture:** Refactor existing monolithic `app.js` into `shared.js` (utilities + mode plugin API) + `energy.js` (existing views as a registered mode) + `food.js` (new mode). Reorganize `public/data/` into `energy/` and `food/` subdirs. Add four new server-side fetch functions in `entrypoint.sh`. New header mode-tab bar swaps sidebar nav, filter bar, and main content per mode.

**Tech Stack:** Vanilla HTML/CSS/JavaScript (no framework, no build step). nginx:alpine in Docker on Fly.io. Chart.js, Leaflet, DOMPurify via CDN. Server-side data fetch via curl + jq + xmlstarlet in `entrypoint.sh`. Data sources: EIA API v2, FRED API, Google News RSS.

**Testing model:** This codebase has no JS test framework — adding one is out of scope. Each task ends with a concrete verification step: `curl`/`jq` smoke checks for data fetchers, browser observation with explicit "what to look for" criteria for UI. Don't introduce vitest/jest/etc. — keep the verification style consistent with the rest of the project.

**XSS safety:** All HTML insertion in this codebase goes through the existing `safeHTML(el, html)` chokepoint (currently at `app.js:9-23`), which wraps `DOMPurify.sanitize`. **Never use raw HTML assignment** — always call `safeHTML(...)` (or `EFC.safeHTML(...)` once it's moved to `shared.js`). The plan refers to "copy safeHTML from app.js" rather than re-pasting the body, to keep this single-source-of-truth.

**Spec:** `docs/superpowers/specs/2026-05-03-efc-tracker-design.md`

---

## Pre-flight (USER ACTIONS)

Before starting implementation, the user needs to:

- [ ] **Get a free FRED API key** from https://fred.stlouisfed.org/docs/api/api_key.html. Save it for later — used in Phase 7 deployment, and exported as `FRED_API_KEY=...` for local dev verification.
- [ ] **Confirm working dir** — implementation happens in the existing `/Users/manuel.palacio/Code/jet-fuel-shortage-tracker` repo, on a feature branch (suggested: `git checkout -b efc-tracker`). The folder rename to `efc-tracker` happens after all code work is merged.

---

## Phase 1 — Data file reorganization (no behavior change)

Move existing files into `public/data/energy/` and update paths everywhere they're referenced. Behavior must be identical after this phase.

### Task 1: Create new data subdirectories and move existing files

**Files:**
- Move: `public/data/airports.json` → `public/data/energy/airports.json`
- Move: `public/data/disruptions.json` → `public/data/energy/disruptions.json`
- Move: `public/data/fuel-prices.json` → `public/data/energy/fuel-prices.json`
- Create: `public/data/food/.gitkeep` (placeholder so the dir exists in git)

- [ ] **Step 1: Create directories and move files**

```bash
cd /Users/manuel.palacio/Code/jet-fuel-shortage-tracker
mkdir -p public/data/energy public/data/food
git mv public/data/airports.json public/data/energy/airports.json
git mv public/data/disruptions.json public/data/energy/disruptions.json
git mv public/data/fuel-prices.json public/data/energy/fuel-prices.json
touch public/data/food/.gitkeep
git add public/data/food/.gitkeep
```

- [ ] **Step 2: Verify file structure**

Run: `ls public/data/energy/ public/data/food/`
Expected:
```
public/data/energy/:
airports.json  disruptions.json  fuel-prices.json

public/data/food/:
```
(food/ shows .gitkeep if you `ls -a`)

### Task 2: Update fetch paths in app.js

**Files:**
- Modify: `public/app.js` — three fetch URLs

- [ ] **Step 1: Update fetch URLs**

In `public/app.js`, change three lines:

```js
// Around line 31 — fetchFuelPrices
const r = await fetch('/data/fuel-prices.json', { cache: 'no-store' });
// →
const r = await fetch('/data/energy/fuel-prices.json', { cache: 'no-store' });

// Around line 56 — fetchDisruptionEvents
const r = await fetch('/data/disruptions.json', { cache: 'no-store' });
// →
const r = await fetch('/data/energy/disruptions.json', { cache: 'no-store' });

// Around line 88 — fetchAirports
const r = await fetch('/data/airports.json', { cache: 'no-store' });
// →
const r = await fetch('/data/energy/airports.json', { cache: 'no-store' });
```

Use grep to confirm: `grep -n "/data/" public/app.js` should show only `/data/energy/` paths.

- [ ] **Step 2: Verify in browser**

```bash
cd public && python3 -m http.server 8080
```

Open http://localhost:8080. Verify:
- Page loads without errors (check DevTools Console — no 404s on `/data/...`)
- Overview view shows KPIs and the disruptions table populated from the moved seed data
- Stop server with Ctrl-C

### Task 3: Update fetch paths in entrypoint.sh

**Files:**
- Modify: `entrypoint.sh:14, 42, 178`

- [ ] **Step 1: Update DATA_DIR-relative paths**

In `entrypoint.sh`, change three locations:

Line ~14 — keep `DATA_DIR=/usr/share/nginx/html/data` and add subdir creation:

```sh
DATA_DIR=/usr/share/nginx/html/data
mkdir -p "$DATA_DIR/energy" "$DATA_DIR/food"
```

Line ~42 — `fetch_fuel_prices` jq output:

```sh
# Before:
"$tmp" > "$DATA_DIR/fuel-prices.json"
# After:
"$tmp" > "$DATA_DIR/energy/fuel-prices.json"
```

Update the next two lines that reference the same file (`jq 'length'` and `jq -r '.[-1].date...'`) to use `"$DATA_DIR/energy/fuel-prices.json"`.

Line ~178 — `fetch_disruption_news`:

```sh
# Before:
cp /tmp/news_disruptions.json "$DATA_DIR/disruptions.json"
# After:
cp /tmp/news_disruptions.json "$DATA_DIR/energy/disruptions.json"
```

Use grep to verify: `grep -n 'DATA_DIR/' entrypoint.sh` should show only paths with `energy/` or `food/` segments after `DATA_DIR/`.

- [ ] **Step 2: Verify with Docker build**

```bash
docker build -t efc-tracker-test .
docker run --rm -p 8080:80 -e EIA_API_KEY=$EIA_API_KEY efc-tracker-test &
# Wait ~5 seconds, then:
curl -s http://localhost:8080/data/energy/fuel-prices.json | jq 'length'
# Expected: a number > 0
docker stop $(docker ps -q --filter ancestor=efc-tracker-test)
```

If you don't have an EIA key handy, run without the `-e EIA_API_KEY=...` flag and verify the seed file is served (`curl` should return the moved JSON).

### Task 4: Commit Phase 1

- [ ] **Step 1: Commit**

```bash
git add public/data/ public/app.js entrypoint.sh
git commit -m "refactor: reorganize data files into energy/ subdirectory

Move airports.json, disruptions.json, fuel-prices.json under
public/data/energy/ in preparation for the food mode addition.
No behavior change — paths updated in app.js and entrypoint.sh.
Adds empty public/data/food/ for the upcoming food data files."
```

---

## Phase 2 — Extract `shared.js` and `energy.js` (refactor only)

Pure refactor: split `app.js` (1153 lines) into three files. Behavior must be identical after this phase. The mode plugin API is added but only one mode (energy) registers — the mode tab UI comes in Phase 3.

### Task 5: Create shared.js scaffold

**Files:**
- Create: `public/shared.js`

- [ ] **Step 1: Create shared.js with EFC namespace and mode plugin API**

Create `public/shared.js`. The module exposes a global `window.EFC` namespace with these surface areas:

```
window.EFC = {
  // DOM helpers
  $(sel, root?), $$(sel, root?),
  safeHTML(el, html),       // verbatim copy of safeHTML from app.js:9-23
  escapeHTML(s),            // verbatim copy of esc() from app.js:974-978

  // Data
  fetchJSON(path, fallback?),

  // Mode plugin API
  registerMode({ id, label, icon, defaultView, views, filters, init }),
  setMode(id),
  currentMode(),

  // Routing
  parseHash(),              // → { modeId, viewId }
  routeTo(modeId, viewId),

  // Bootstrap
  start()                   // wired by app.js on DOMContentLoaded
};
```

The full implementation:

```js
'use strict';

window.EFC = (function () {
  const _modes = {};
  let _currentModeId = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  // safeHTML and escapeHTML: copy verbatim from app.js (lines 9-23 and 974-978
  // respectively). Same bodies, just placed inside this IIFE so they become
  // EFC.safeHTML and EFC.escapeHTML. Do not modify the bodies.
  function safeHTML(el, html) { /* COPY FROM app.js:9-23 */ }
  function escapeHTML(s) { /* COPY FROM app.js:974-978 — function named esc() there */ }

  async function fetchJSON(path, fallback) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) return fallback === undefined ? [] : fallback;
      return await r.json();
    } catch (e) {
      console.warn('fetchJSON failed for ' + path, e);
      return fallback === undefined ? [] : fallback;
    }
  }

  /* ---- Mode plugin API ---- */

  function registerMode(plugin) {
    // plugin: { id, label, icon, defaultView, views: [{id,label,icon,render}],
    //           filters: { html, init }, init() }
    _modes[plugin.id] = plugin;
  }

  function currentMode() { return _modes[_currentModeId]; }

  function setMode(id) {
    const mode = _modes[id];
    if (!mode) return;
    const prevId = _currentModeId;
    _currentModeId = id;
    try { localStorage.setItem('efc.mode', id); } catch (e) {}

    _renderModeTabs();
    _renderSidebar();
    _renderFilters();

    if (!mode._initialized) {
      if (typeof mode.init === 'function') mode.init();
      mode._initialized = true;
    }

    if (prevId !== id) {
      routeTo(id, mode.defaultView);
    }
  }

  /* ---- Routing ---- */

  function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    const parts = h.split('/');
    return { modeId: parts[0] || '', viewId: parts[1] || '' };
  }

  function routeTo(modeId, viewId) {
    location.hash = '#' + modeId + '/' + viewId;
  }

  const LEGACY_VIEWS = ['overview', 'airports', 'map', 'disruptions', 'analytics'];

  function _onHashChange() {
    let { modeId, viewId } = parseHash();

    // Legacy bookmark compat: #overview → #energy/overview
    if (LEGACY_VIEWS.indexOf(modeId) !== -1 && !viewId) {
      viewId = modeId;
      modeId = 'energy';
      routeTo(modeId, viewId);
      return; // hashchange will re-fire
    }

    if (!_modes[modeId]) {
      modeId = _currentModeId || 'energy';
    }
    if (modeId !== _currentModeId) {
      setMode(modeId);
      return; // setMode → routeTo → hashchange re-fires
    }

    const mode = _modes[modeId];
    const view = mode.views.find(function (v) { return v.id === viewId; })
      || mode.views.find(function (v) { return v.id === mode.defaultView; });
    if (view && typeof view.render === 'function') view.render();
    _highlightActiveNav(view ? view.id : null);
    _setHeaderTitle(view ? view.label : '');
  }

  /* ---- Render targets ---- */

  function _renderModeTabs() {
    const host = $('#mode-tabs');
    if (!host) return;
    let html = '';
    Object.keys(_modes).forEach(function (id) {
      const m = _modes[id];
      const cls = (id === _currentModeId) ? 'mode-tab active' : 'mode-tab';
      html += '<button class="' + cls + '" data-mode="' + escapeHTML(id) + '" type="button">'
        + '<span class="material-symbols-outlined">' + escapeHTML(m.icon) + '</span>'
        + escapeHTML(m.label)
        + '</button>';
    });
    safeHTML(host, html);
    $$('button[data-mode]', host).forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
    });
  }

  function _renderSidebar() {
    const host = $('#nav-items');
    const mode = currentMode();
    if (!host || !mode) return;
    let html = '';
    mode.views.forEach(function (v) {
      html += '<a class="nav-item" href="#' + mode.id + '/' + v.id + '" data-view="' + escapeHTML(v.id) + '">'
        + '<span class="material-symbols-outlined">' + escapeHTML(v.icon) + '</span>'
        + escapeHTML(v.label)
        + '</a>';
    });
    safeHTML(host, html);
  }

  function _renderFilters() {
    const host = $('#filter-bar');
    const mode = currentMode();
    if (!host || !mode) return;
    if (mode.filters && typeof mode.filters.html === 'function') {
      safeHTML(host, mode.filters.html());
    } else {
      safeHTML(host, '');
    }
    if (mode.filters && typeof mode.filters.init === 'function') {
      mode.filters.init();
    }
  }

  function _highlightActiveNav(viewId) {
    $$('#nav-items .nav-item').forEach(function (a) {
      const active = a.dataset.view === viewId;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function _setHeaderTitle(label) {
    const el = $('#header-page-title');
    if (el) el.textContent = label;
  }

  /* ---- Theme + sidebar collapse + info popover ---- */
  // These are direct extracts of the existing functions in app.js — moved to
  // shared.js because they're cross-cutting infrastructure both modes depend on.
  // Copy the bodies of initTheme (app.js:904-922), initNav (app.js:1073-1095) —
  // rename to initSidebar — and initInfoPopover (app.js:1097-1117) verbatim
  // into the IIFE here. Update any localStorage keys from 'fuelwatch.*' to
  // 'efc.*' inside the bodies.

  function initTheme() { /* COPY FROM app.js:904-922; replace any fuelwatch.* localStorage keys with efc.* */ }
  function initSidebar() { /* COPY FROM app.js:1073-1095 (function initNav); rename to initSidebar; replace fuelwatch.* keys with efc.* */ }
  function initInfoPopover() { /* COPY FROM app.js:1097-1117 verbatim */ }

  /* ---- Bootstrap ---- */

  function start() {
    initTheme();
    initSidebar();
    initInfoPopover();
    window.addEventListener('hashchange', _onHashChange);
    let initial = null;
    try { initial = localStorage.getItem('efc.mode'); } catch (e) {}
    setMode(initial && _modes[initial] ? initial : Object.keys(_modes)[0]);
    if (location.hash) _onHashChange();
  }

  return {
    $: $, $$: $$, safeHTML: safeHTML, escapeHTML: escapeHTML,
    fetchJSON: fetchJSON,
    registerMode: registerMode, setMode: setMode, currentMode: currentMode,
    routeTo: routeTo, parseHash: parseHash,
    start: start
  };
})();
```

When you copy `safeHTML`, `escapeHTML` (called `esc` in app.js), `initTheme`, `initNav`, and `initInfoPopover` from app.js, the bodies are unchanged — only the wrapping context changes (now inside the EFC IIFE). The `fuelwatch.theme` / `fuelwatch.sidebar` localStorage keys become `efc.theme` / `efc.sidebarCollapsed`.

- [ ] **Step 2: Verify file syntax**

Run: `node -c public/shared.js`
Expected: no output (syntax OK). If your `node` doesn't accept `-c` for browser-style scripts, just open the file in the browser at the next task and check the DevTools console for parse errors.

### Task 6: Create energy.js by extracting from app.js

**Files:**
- Create: `public/energy.js`
- Modify: `public/app.js` (eventually reduced to a bootstrap stub)

**Strategy:** Move ALL energy-specific functions from `app.js` into `energy.js`, wrapped in an IIFE that registers an "energy" mode. The functions stay private to energy.js. `safeHTML` / `escapeHTML` / theme / nav / info-popover are NOT moved here — they're already in shared.js.

- [ ] **Step 1: Create energy.js with the energy mode wrapper**

Create `public/energy.js`. Use this skeleton, then paste each named function body from `app.js` into the IIFE at the corresponding marker:

```js
'use strict';

/* ================================================================
   ENERGY MODE — jet fuel + WTI crude + Henry Hub gas
   Registers as the "energy" mode plugin with shared.js.
   ================================================================ */

(function () {
  const safeHTML   = EFC.safeHTML;
  const escapeHTML = EFC.escapeHTML;
  const fetchJSON  = EFC.fetchJSON;
  const $          = EFC.$;
  const $$         = EFC.$$;

  /* ---- DATA ADAPTERS (from app.js) ---- */

  async function fetchFuelPrices() {
    const raw = await fetchJSON('/data/energy/fuel-prices.json', []);
    return normalizeFuelPriceData(raw);
  }
  // PASTE: normalizeFuelPriceData() body — app.js:43-53
  // PASTE: fetchDisruptionEvents() — app.js:55-64 — change fetch URL to '/data/energy/disruptions.json'
  // PASTE: normalizeDisruptionData() — app.js:66-85
  // PASTE: fetchAirports() — app.js:87-100 — change fetch URL to '/data/energy/airports.json'

  /* ---- STATE (from app.js) ---- */

  // PASTE: const AppState = { ... } — app.js:102-118 — RENAME to EnergyState
  // PASTE: function getFilteredDisruptions() — app.js:120-135
  // PASTE: const SEV_ORDER = ... — app.js:137
  // PASTE: function sortDisruptions(rows) — app.js:139-152
  // PASTE: const SUMMER_MULTIPLIER = 1.35; — app.js:154
  // PASTE: helpers from app.js:156-204 — getAirportCoverDays, getCoverDaysClass, getCoverDaysRiskLabel, computeKPIs
  //        Update any AppState references → EnergyState

  /* ---- KPI / RENDER / CHARTS / DRAWERS (from app.js) ---- */

  // PASTE: renderKPIs (app.js:216-259), renderTable (261-321), cc() (322-337),
  //        renderFuelChart (339-387), renderTimelineChart (389-426), renderDonutChart (428-455),
  //        renderAirportCards (457-515), renderMap (517-548) — RENAME to renderMapView,
  //        updateMapMarkers (550-576), openAirportDrawer (578-620),
  //        renderAnalyticsCharts (622-626), renderAnalyticsFuelChart (628-651),
  //        renderRegionalChart (653-677), renderSeasonalityChart (679-705),
  //        openDrawer (707-722), closeDrawer (724-733), renderDrawerContent (735-782),
  //        populateFilterOptions (784-797), applyAndRender (799-809),
  //        initFilters (811-832), initTableSort (834-847), updateSortHeaders (849-867),
  //        initSummerToggle (869-893), updateSummerBanner (895-902),
  //        showLoading (933-936), showError (938-942), showDashboard (944-972),
  //        trunc (979), fmtDate (980-986), impactLabel (988-989), hexAlpha (991-998),
  //        updateTimestamp (1000-1010)
  // All bodies are unchanged. Update any AppState references → EnergyState.
  // The function `esc()` (app.js:974-978) is now EFC.escapeHTML — delete the
  // local definition and update call sites to use the aliased `escapeHTML`.

  /* ---- VIEW RENDERERS (thin wrappers around the existing render fns) ---- */

  function renderOverview() {
    showSection('overview');
    applyAndRender();
  }
  function renderAirports() {
    showSection('airports');
    renderAirportCards();
  }
  function renderMap() {
    showSection('map');
    renderMapView();
  }
  function renderDisruptions() {
    showSection('disruptions');
    applyAndRender();
  }
  function renderAnalytics() {
    showSection('analytics');
    renderAnalyticsCharts();
  }

  function showSection(viewId) {
    $$('.view-section').forEach(function (s) {
      s.classList.toggle('hidden', s.dataset.view !== viewId);
    });
  }

  /* ---- FILTERS (HTML factory + init) ---- */

  function filtersHTML() {
    return ''
      + '<span class="filter-label" aria-hidden="true">Filter</span>'
      + '<div class="filter-divider" aria-hidden="true"></div>'
      + '<select class="filter-select" id="filter-airline" aria-label="Filter by airline"><option value="">All Airlines</option></select>'
      + '<select class="filter-select" id="filter-region" aria-label="Filter by region"><option value="">All Regions</option></select>'
      + '<select class="filter-select" id="filter-country" aria-label="Filter by country"><option value="">All Countries</option></select>'
      + '<select class="filter-select" id="filter-impact" aria-label="Filter by impact type">'
      +   '<option value="">All Impact Types</option>'
      +   '<option value="cancellations">Cancellations</option>'
      +   '<option value="fare_increase">Fare Increase</option>'
      +   '<option value="schedule_cuts">Schedule Cuts</option>'
      +   '<option value="fuel_risk">Fuel Risk</option>'
      + '</select>'
      + '<select class="filter-select" id="filter-severity" aria-label="Filter by severity">'
      +   '<option value="">All Severities</option>'
      +   '<option value="critical">Critical</option>'
      +   '<option value="high">High</option>'
      +   '<option value="medium">Medium</option>'
      +   '<option value="low">Low</option>'
      + '</select>'
      + '<input type="search" class="filter-search" id="filter-search" placeholder="Search routes, airports…" autocomplete="off" />'
      + '<button class="filter-clear" id="filter-clear" type="button">Clear</button>'
      + '<div class="filter-divider" aria-hidden="true"></div>'
      + '<button class="summer-toggle" id="summer-toggle" type="button" aria-pressed="false">'
      +   '<span aria-hidden="true">☀️</span> Summer Mode'
      + '</button>';
  }

  function initFiltersDOM() {
    populateFilterOptions();
    initFilters();
    initSummerToggle();
  }

  /* ---- INIT (called once when energy mode is first activated) ---- */

  async function init() {
    showLoading();
    try {
      const [disruptions, fuelPrices, airports] = await Promise.all([
        fetchDisruptionEvents(),
        fetchFuelPrices(),
        fetchAirports()
      ]);
      EnergyState.disruptions = disruptions;
      EnergyState.fuelPrices = fuelPrices;
      EnergyState.airports = airports;
      showDashboard();
      updateTimestamp();
      initTableSort();
      applyAndRender();
    } catch (e) {
      console.error(e);
      showError(e.message || String(e));
    }
  }

  /* ---- REGISTER ---- */

  EFC.registerMode({
    id: 'energy',
    label: 'Energy',
    icon: 'bolt',
    defaultView: 'overview',
    views: [
      { id: 'overview',    label: 'Overview',    icon: 'dashboard',     render: renderOverview },
      { id: 'airports',    label: 'Airports',    icon: 'local_airport', render: renderAirports },
      { id: 'map',         label: 'Map',         icon: 'map',           render: renderMap },
      { id: 'disruptions', label: 'Disruptions', icon: 'warning',       render: renderDisruptions },
      { id: 'analytics',   label: 'Analytics',   icon: 'trending_up',   render: renderAnalytics }
    ],
    filters: { html: filtersHTML, init: initFiltersDOM },
    init: init
  });
})();
```

**IMPORTANT:** Do NOT just copy this skeleton. You must paste the actual function bodies from `app.js` at every `// PASTE: ...` marker. Read `public/app.js` carefully and copy each named function verbatim into the IIFE in energy.js, then delete the marker comment. Function bodies are unchanged — only the wrapping changes.

Specific notes during the paste:
- `AppState` (app.js:102) → rename to `EnergyState` everywhere it's referenced
- `safeHTML` and `escapeHTML` are aliased at the top of the IIFE — function bodies that call them work without modification
- The original `renderMap` function in app.js (line 517) collides with our wrapper name — rename the original to `renderMapView` (and update the wrapper to call it)
- `esc()` (app.js:974) is replaced by the `escapeHTML` alias — find/replace `esc(` → `escapeHTML(` inside the pasted bodies

- [ ] **Step 2: Reduce app.js to bootstrap**

Replace the entire contents of `public/app.js` with:

```js
'use strict';

/* Bootstrap — registers happen in energy.js / food.js, then start. */
document.addEventListener('DOMContentLoaded', function () {
  EFC.start();
});
```

That's the entire file. ~5 lines.

- [ ] **Step 3: Update index.html script tags**

In `public/index.html`, find line 412:
```html
<script src="/app.js"></script>
```

Replace with (in this order):
```html
<script src="/shared.js"></script>
<script src="/energy.js"></script>
<script src="/app.js"></script>
```

- [ ] **Step 4: Add the new mode-tab and nav-items render targets**

In `public/index.html`:

**a)** Replace the static sidebar nav block (lines 40-61) with a render target. Find:
```html
<nav class="nav-items" role="navigation">
  <a class="nav-item active" href="#overview" data-nav="overview" aria-current="page">
    ...
  </a>
  ...
</nav>
```
Replace with:
```html
<nav class="nav-items" id="nav-items" role="navigation"></nav>
```

**b)** Add a mode-tabs row inside `.main-wrapper`, just before the `<header>` (insert before line 72):
```html
<div class="mode-tabs" id="mode-tabs" role="tablist" aria-label="Select tracker mode"></div>
```

**c)** Replace the static filter bar contents (lines 107-146) with a render target. Find the entire `<div class="filter-bar" ...>` block and replace with:
```html
<div class="filter-bar" id="filter-bar" role="search" aria-label="Filters"></div>
```

**d)** Add an `id` to the header page title for the router to update. Find line 76:
```html
<div class="header-page-title">Fleet Overview</div>
```
Replace with:
```html
<div class="header-page-title" id="header-page-title">…</div>
```

- [ ] **Step 5: Verify in browser**

```bash
cd public && python3 -m http.server 8080
```

Open http://localhost:8080. Verify:
- Sidebar shows 5 nav items (Overview, Airports, Map, Disruptions, Analytics) — rendered dynamically now
- Mode tabs row appears above the header showing one tab: ⚡ Energy
- Filter bar shows the same filters as before (now rendered by energy.js)
- Clicking nav items switches views
- Bookmark `http://localhost:8080/#analytics` → URL silently rewrites to `#energy/analytics`, Analytics view renders
- Hard refresh on `http://localhost:8080/#energy/airports` → opens Airports view directly
- DevTools console: no errors
- Stop the server with Ctrl-C

### Task 7: Commit Phase 2

- [ ] **Step 1: Commit**

```bash
git add public/shared.js public/energy.js public/app.js public/index.html
git commit -m "refactor: split app.js into shared.js + energy.js + bootstrap

shared.js owns DOM helpers, fetch, mode plugin API, routing, theme,
sidebar, info popover. energy.js registers the existing 5 views as
the 'energy' mode. app.js reduced to a 5-line bootstrap.
Hash routing changes from #view to #mode/view; legacy #view URLs
silently redirect to #energy/view for bookmark compatibility."
```

---

## Phase 3 — Mode tab styling

CSS for the mode tabs and food-mode accent. No food behavior yet — Phase 5 brings the food plugin.

### Task 8: Add mode-tab CSS

**Files:**
- Modify: `public/styles.css` (append at end)

- [ ] **Step 1: Confirm CSS variable names in use**

Run: `grep -n "^  --" public/styles.css | head -40`

Note the exact variable names for: amber accent, surface backgrounds, borders, text colors, spacing scale, radius, font stacks. The CSS below uses generic-looking names — substitute the actual names found above before pasting.

- [ ] **Step 2: Append mode-tab styles**

Append to `public/styles.css` (substituting CSS variable names per Step 1):

```css
/* ======================================================
   MODE TABS — top-level Energy / Food selector
   ====================================================== */

.mode-tabs {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-1);
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-1);
  cursor: pointer;
  transition: background 120ms, color 120ms, border-color 120ms;
}

.mode-tab:hover {
  color: var(--text-1);
  border-color: var(--accent-amber);
}

.mode-tab.active {
  color: var(--text-1);
  background: var(--surface-1);
  border-color: var(--accent-amber);
  box-shadow: 0 0 0 1px var(--accent-amber) inset;
}

.mode-tab[data-mode="food"].active {
  border-color: #5fb96a;
  box-shadow: 0 0 0 1px #5fb96a inset;
}

.mode-tab .material-symbols-outlined {
  font-size: 18px;
}

@media (max-width: 720px) {
  .mode-tabs { padding: var(--space-2) var(--space-4); }
  .mode-tab { padding: var(--space-2) var(--space-3); font-size: 13px; }
}
```

- [ ] **Step 3: Verify visually**

```bash
cd public && python3 -m http.server 8080
```

Open http://localhost:8080. Verify:
- A tab strip appears between the page top and the site header
- The "⚡ Energy" tab has an amber border and looks active
- No layout breakage on the rest of the page
- Stop server with Ctrl-C

### Task 9: Commit Phase 3

- [ ] **Step 1: Commit**

```bash
git add public/styles.css
git commit -m "style: add mode-tabs row above the site header"
```

---

## Phase 4 — Add WTI + Henry Hub data fetchers and Analytics charts

Server-side fetch for two new EIA series, then surface them as chart cards in the Analytics view.

### Task 10: Add fetch_oil_prices to entrypoint.sh

**Files:**
- Modify: `entrypoint.sh`

- [ ] **Step 1: Manually verify the EIA endpoint shape**

Run locally (with your EIA key in env) to discover the right facets:

```bash
# WTI Cushing daily spot — try product=EPCWTI, area=RWTC
curl -gs "https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_API_KEY}&frequency=daily&data[0]=value&facets[product][]=EPCWTI&facets[duoarea][]=RWTC&start=2024-01-01&sort[0][column]=period&sort[0][direction]=desc&length=5" | jq '.response.data[0]'
```

Expected: a JSON object with `period`, `value`, `units` fields and `units == "$/BBL"`. If this returns empty, try `facets[duoarea][]=NUS` instead. Whichever works, lock in the facet codes for the next step.

- [ ] **Step 2: Add fetch_oil_prices function**

In `entrypoint.sh`, immediately after the existing `fetch_fuel_prices()` function (around line 51), add:

```sh
# ── Crude oil price fetch (EIA WTI Cushing daily spot) ──────────────────────
fetch_oil_prices() {
  if [ -z "$EIA_API_KEY" ]; then
    echo "EIA_API_KEY not set — skipping oil prices"
    return 1
  fi

  echo "Fetching EIA WTI crude oil prices (EPCWTI/RWTC)..."
  local tmp=$(mktemp)

  HTTP_STATUS=$(curl -gs -o "$tmp" -w "%{http_code}" \
    "https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${EIA_API_KEY}&frequency=daily&data[0]=value&facets[product][]=EPCWTI&facets[duoarea][]=RWTC&start=2023-01-01&sort[0][column]=period&sort[0][direction]=desc&length=400")

  if [ "$HTTP_STATUS" = "200" ]; then
    jq '[.response.data[]
         | select(.value != null)
         | { date: .period, price: (.value | tonumber),
             source: "EIA EPCWTI/RWTC (live)", series_id: "EPCWTI_RWTC" }]
       | sort_by(.date)' \
      "$tmp" > "$DATA_DIR/energy/oil-prices.json"

    RECORD_COUNT=$(jq 'length' "$DATA_DIR/energy/oil-prices.json")
    LATEST=$(jq -r '.[-1].date + " $" + (.[-1].price | tostring) + "/bbl"' "$DATA_DIR/energy/oil-prices.json")
    echo "oil-prices.json written: ${RECORD_COUNT} records, latest: ${LATEST}"
  else
    echo "EIA WTI fetch failed (HTTP ${HTTP_STATUS}) — keeping existing data"
  fi
  rm -f "$tmp"
}
```

If Step 1 showed that `RWTC` returned nothing and `NUS` worked, substitute `NUS` in the URL and the source/series_id strings.

- [ ] **Step 3: Wire into startup and background loop**

Find the initial fetch block (currently near the bottom of entrypoint.sh, around line 188):
```sh
fetch_fuel_prices
fetch_disruption_news
```
Add `fetch_oil_prices`:
```sh
fetch_fuel_prices
fetch_oil_prices
fetch_disruption_news
```

Find the background loop (around line 192):
```sh
(while true; do sleep 21600; fetch_fuel_prices; fetch_disruption_news; done) &
```
Replace with:
```sh
(while true; do sleep 21600; fetch_fuel_prices; fetch_oil_prices; fetch_disruption_news; done) &
```

- [ ] **Step 4: Verify with Docker**

```bash
docker build -t efc-tracker-test . && \
docker run --rm -p 8080:80 -e EIA_API_KEY=$EIA_API_KEY efc-tracker-test &
sleep 8
curl -s http://localhost:8080/data/energy/oil-prices.json | jq 'length, .[-1]'
docker stop $(docker ps -q --filter ancestor=efc-tracker-test)
```

Expected: a number (record count) and a JSON object with `date`, `price`, `source`, `series_id`. Price should look like a number around 60-90 ($/bbl).

### Task 11: Add fetch_gas_prices to entrypoint.sh

**Files:**
- Modify: `entrypoint.sh`

- [ ] **Step 1: Discover the natural gas endpoint**

```bash
curl -gs "https://api.eia.gov/v2/natural-gas/pri/sum/data/?api_key=${EIA_API_KEY}&frequency=daily&data[0]=value&facets[duoarea][]=RGC&facets[process][]=PG1&start=2024-01-01&sort[0][column]=period&sort[0][direction]=desc&length=5" | jq '.response.data[0]'
```

Expected: object with `period`, `value`, `units == "$/MMBTU"`. If `process=PG1` returns nothing, try without the `process` facet — there may be only one natural gas series at that area. Lock in whichever facet combo returns Henry Hub data.

- [ ] **Step 2: Add fetch_gas_prices function**

Immediately after `fetch_oil_prices` in `entrypoint.sh`, add:

```sh
# ── Natural gas price fetch (EIA Henry Hub daily spot) ──────────────────────
fetch_gas_prices() {
  if [ -z "$EIA_API_KEY" ]; then
    echo "EIA_API_KEY not set — skipping gas prices"
    return 1
  fi

  echo "Fetching EIA Henry Hub natural gas prices..."
  local tmp=$(mktemp)

  HTTP_STATUS=$(curl -gs -o "$tmp" -w "%{http_code}" \
    "https://api.eia.gov/v2/natural-gas/pri/sum/data/?api_key=${EIA_API_KEY}&frequency=daily&data[0]=value&facets[duoarea][]=RGC&facets[process][]=PG1&start=2023-01-01&sort[0][column]=period&sort[0][direction]=desc&length=400")

  if [ "$HTTP_STATUS" = "200" ]; then
    jq '[.response.data[]
         | select(.value != null)
         | { date: .period, price: (.value | tonumber),
             source: "EIA Henry Hub (live)", series_id: "RNGWHHD" }]
       | sort_by(.date)' \
      "$tmp" > "$DATA_DIR/energy/gas-prices.json"

    RECORD_COUNT=$(jq 'length' "$DATA_DIR/energy/gas-prices.json")
    LATEST=$(jq -r '.[-1].date + " $" + (.[-1].price | tostring) + "/MMBtu"' "$DATA_DIR/energy/gas-prices.json")
    echo "gas-prices.json written: ${RECORD_COUNT} records, latest: ${LATEST}"
  else
    echo "EIA Henry Hub fetch failed (HTTP ${HTTP_STATUS}) — keeping existing data"
  fi
  rm -f "$tmp"
}
```

Substitute facets if Step 1 showed different working values.

- [ ] **Step 3: Wire into startup and background loop**

Startup:
```sh
fetch_fuel_prices
fetch_oil_prices
fetch_gas_prices
fetch_disruption_news
```

Background:
```sh
(while true; do sleep 21600; fetch_fuel_prices; fetch_oil_prices; fetch_gas_prices; fetch_disruption_news; done) &
```

- [ ] **Step 4: Verify with Docker**

```bash
docker build -t efc-tracker-test . && \
docker run --rm -p 8080:80 -e EIA_API_KEY=$EIA_API_KEY efc-tracker-test &
sleep 8
curl -s http://localhost:8080/data/energy/gas-prices.json | jq 'length, .[-1]'
docker stop $(docker ps -q --filter ancestor=efc-tracker-test)
```

Expected: a record count and a JSON object with reasonable Henry Hub price (typically $1-$10/MMBtu).

### Task 12: Add seed JSON for oil and gas

**Files:**
- Create: `public/data/energy/oil-prices.json`
- Create: `public/data/energy/gas-prices.json`

These render the chart cards locally without Docker / EIA key.

- [ ] **Step 1: Write seed files**

`public/data/energy/oil-prices.json`:
```json
[
  { "date": "2026-01-03", "price": 72.41, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-01-10", "price": 73.85, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-01-17", "price": 71.20, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-01-24", "price": 74.55, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-01-31", "price": 76.10, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-02-07", "price": 75.92, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-02-14", "price": 77.30, "source": "Seed", "series_id": "EPCWTI_RWTC" },
  { "date": "2026-02-21", "price": 78.45, "source": "Seed", "series_id": "EPCWTI_RWTC" }
]
```

`public/data/energy/gas-prices.json`:
```json
[
  { "date": "2026-01-03", "price": 3.21, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-01-10", "price": 3.45, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-01-17", "price": 4.12, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-01-24", "price": 3.88, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-01-31", "price": 3.55, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-02-07", "price": 3.40, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-02-14", "price": 3.62, "source": "Seed", "series_id": "RNGWHHD" },
  { "date": "2026-02-21", "price": 3.71, "source": "Seed", "series_id": "RNGWHHD" }
]
```

- [ ] **Step 2: Verify**

Run: `jq 'length' public/data/energy/oil-prices.json public/data/energy/gas-prices.json`
Expected: `8` printed twice.

### Task 13: Add WTI and Henry Hub chart cards to Analytics view

**Files:**
- Modify: `public/index.html` (Analytics view section)
- Modify: `public/energy.js` (load and render new charts)

- [ ] **Step 1: Add HTML for two new chart cards**

In `public/index.html`, find the Analytics view section (around line 327, `<section data-view="analytics" class="view-section hidden">`), inside its `.charts-section` div. After the existing Jet Fuel Price Trend chart card and before/after the existing `.chart-row`, add:

```html
<div class="chart-row">
  <div class="chart-card">
    <div class="chart-header">
      <div>
        <div class="chart-title">WTI Crude Oil</div>
        <div class="chart-subtitle">West Texas Intermediate, Cushing OK · $/barrel · EIA daily spot</div>
      </div>
    </div>
    <div class="chart-canvas-wrap" style="height:200px;">
      <canvas id="oil-chart" aria-label="WTI crude oil price chart" role="img"></canvas>
    </div>
  </div>
  <div class="chart-card">
    <div class="chart-header">
      <div>
        <div class="chart-title">Henry Hub Natural Gas</div>
        <div class="chart-subtitle">Henry Hub LA · $/MMBtu · EIA daily spot</div>
      </div>
    </div>
    <div class="chart-canvas-wrap" style="height:200px;">
      <canvas id="gas-chart" aria-label="Henry Hub natural gas price chart" role="img"></canvas>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Load and render in energy.js**

In `public/energy.js`:

**a)** In the `init()` function, extend the `Promise.all` to load oil and gas:

```js
const [disruptions, fuelPrices, airports, oilPrices, gasPrices] = await Promise.all([
  fetchDisruptionEvents(),
  fetchFuelPrices(),
  fetchAirports(),
  fetchJSON('/data/energy/oil-prices.json', []),
  fetchJSON('/data/energy/gas-prices.json', [])
]);
EnergyState.disruptions = disruptions;
EnergyState.fuelPrices  = fuelPrices;
EnergyState.airports    = airports;
EnergyState.oilPrices   = oilPrices;
EnergyState.gasPrices   = gasPrices;
```

**b)** Add two new chart render functions near the existing `renderAnalyticsFuelChart`:

```js
function renderOilChart() {
  const canvas = document.getElementById('oil-chart');
  if (!canvas || !EnergyState.oilPrices || !EnergyState.oilPrices.length) return;
  if (canvas._chart) canvas._chart.destroy();
  const data = EnergyState.oilPrices;
  canvas._chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map(function (d) { return d.date; }),
      datasets: [{
        label: 'WTI ($/bbl)',
        data: data.map(function (d) { return d.price; }),
        borderColor: cc('--accent-orange') || '#e97a3a',
        backgroundColor: hexAlpha(cc('--accent-orange') || '#e97a3a', 0.1),
        tension: 0.25, pointRadius: 0, fill: true
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}

function renderGasChart() {
  const canvas = document.getElementById('gas-chart');
  if (!canvas || !EnergyState.gasPrices || !EnergyState.gasPrices.length) return;
  if (canvas._chart) canvas._chart.destroy();
  const data = EnergyState.gasPrices;
  canvas._chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map(function (d) { return d.date; }),
      datasets: [{
        label: 'Henry Hub ($/MMBtu)',
        data: data.map(function (d) { return d.price; }),
        borderColor: cc('--accent-blue') || '#3a86e9',
        backgroundColor: hexAlpha(cc('--accent-blue') || '#3a86e9', 0.1),
        tension: 0.25, pointRadius: 0, fill: true
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}
```

**c)** In the existing `renderAnalyticsCharts()` function, append calls:

```js
function renderAnalyticsCharts() {
  renderAnalyticsFuelChart();
  renderRegionalChart();
  renderSeasonalityChart();
  renderOilChart();   // NEW
  renderGasChart();   // NEW
}
```

- [ ] **Step 3: Verify in browser**

```bash
cd public && python3 -m http.server 8080
```

Open http://localhost:8080/#energy/analytics. Verify:
- Three chart cards visible: Jet Fuel, WTI Crude Oil, Henry Hub Natural Gas (the latter two using seed data)
- WTI chart shows an upward trend in the seed range (~$72-$78)
- Henry Hub chart shows a wiggling line $3-$4
- DevTools console: no errors
- Stop the server

### Task 14: Commit Phase 4

- [ ] **Step 1: Commit**

```bash
git add entrypoint.sh public/data/energy/oil-prices.json public/data/energy/gas-prices.json public/index.html public/energy.js
git commit -m "feat(energy): add WTI crude and Henry Hub natural gas charts

Server-side fetch from EIA v2 API in entrypoint.sh, written to
public/data/energy/{oil,gas}-prices.json. Surfaced as two new chart
cards in the Analytics view. Seed data ships for local dev."
```

---

## Phase 5 — Add food mode (wheat prices + food events)

Now build the food side. Adds `food.js`, two new data files, two new fetchers in entrypoint.sh.

### Task 15: Add food events seed data

**Files:**
- Create: `public/data/food/food-events.json`

- [ ] **Step 1: Write seed file**

`public/data/food/food-events.json`:
```json
[
  {
    "id": "FOOD-IndiaWheatExportBan",
    "commodity": "wheat",
    "region": "Asia-Pacific",
    "country": "India",
    "event_type": "export_ban",
    "severity": "high",
    "summary": "India bans wheat exports amid record heatwave damage to harvest",
    "source_name": "Reuters",
    "source_url": "https://www.reuters.com/",
    "updated_at": "2026-04-12T14:23:00Z"
  },
  {
    "id": "FOOD-UkraineCorridor",
    "commodity": "wheat",
    "region": "Europe",
    "country": "Ukraine",
    "event_type": "supply_disruption",
    "severity": "critical",
    "summary": "Black Sea grain corridor disruptions tighten global wheat supply",
    "source_name": "Bloomberg",
    "source_url": "https://www.bloomberg.com/",
    "updated_at": "2026-04-08T09:10:00Z"
  },
  {
    "id": "FOOD-ArgentinaDrought",
    "commodity": "wheat",
    "region": "Latin America",
    "country": "Argentina",
    "event_type": "harvest_failure",
    "severity": "high",
    "summary": "Argentina's wheat harvest forecast slashed 30% on persistent drought",
    "source_name": "Financial Times",
    "source_url": "https://www.ft.com/",
    "updated_at": "2026-03-30T17:45:00Z"
  },
  {
    "id": "FOOD-EgyptStockpile",
    "commodity": "wheat",
    "region": "Africa",
    "country": "Egypt",
    "event_type": "policy",
    "severity": "medium",
    "summary": "Egypt expands strategic wheat stockpile target to nine months of supply",
    "source_name": "Al Jazeera",
    "source_url": "https://www.aljazeera.com/",
    "updated_at": "2026-03-22T11:00:00Z"
  },
  {
    "id": "FOOD-EUFertilizer",
    "commodity": "fertilizer",
    "region": "Europe",
    "country": "EU-wide",
    "event_type": "price_surge",
    "severity": "medium",
    "summary": "European urea prices climb on Russian export curbs and high gas prices",
    "source_name": "Reuters",
    "source_url": "https://www.reuters.com/",
    "updated_at": "2026-03-15T08:30:00Z"
  }
]
```

- [ ] **Step 2: Verify**

Run: `jq 'length, .[0].commodity' public/data/food/food-events.json`
Expected: `5` then `"wheat"`.

### Task 16: Add wheat price seed data

**Files:**
- Create: `public/data/food/wheat-prices.json`

- [ ] **Step 1: Write seed file**

`public/data/food/wheat-prices.json` (monthly cadence, $/metric ton, plausible recent values):
```json
[
  { "date": "2025-08-01", "price": 245.30, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2025-09-01", "price": 252.80, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2025-10-01", "price": 261.40, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2025-11-01", "price": 258.10, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2025-12-01", "price": 265.95, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2026-01-01", "price": 271.20, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2026-02-01", "price": 278.55, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" },
  { "date": "2026-03-01", "price": 285.10, "source": "Seed (FRED PWHEAMTUSDM)", "series_id": "PWHEAMTUSDM" }
]
```

- [ ] **Step 2: Verify**

Run: `jq 'length, .[-1]' public/data/food/wheat-prices.json`
Expected: `8` then the last record JSON.

### Task 17: Add fetch_wheat_prices to entrypoint.sh

**Files:**
- Modify: `entrypoint.sh`

- [ ] **Step 1: Confirm FRED endpoint**

```bash
# Run with your FRED key in env:
curl -s "https://api.stlouisfed.org/fred/series/observations?series_id=PWHEAMTUSDM&api_key=${FRED_API_KEY}&file_type=json&observation_start=2024-01-01" | jq '.observations[0]'
```
Expected: `{ "realtime_start":..., "realtime_end":..., "date":"2024-01-01", "value":"..." }`. If the value is a string `"."` (FRED's missing-data sentinel), filter those out in jq below.

- [ ] **Step 2: Add fetch_wheat_prices function**

After `fetch_gas_prices` in `entrypoint.sh`:

```sh
# ── Wheat price fetch (FRED PWHEAMTUSDM, monthly $/MT) ──────────────────────
fetch_wheat_prices() {
  if [ -z "$FRED_API_KEY" ]; then
    echo "FRED_API_KEY not set — skipping wheat prices"
    return 1
  fi

  echo "Fetching FRED wheat prices (PWHEAMTUSDM)..."
  local tmp=$(mktemp)

  HTTP_STATUS=$(curl -gs -o "$tmp" -w "%{http_code}" \
    "https://api.stlouisfed.org/fred/series/observations?series_id=PWHEAMTUSDM&api_key=${FRED_API_KEY}&file_type=json&observation_start=2023-01-01")

  if [ "$HTTP_STATUS" = "200" ]; then
    jq '[.observations[]
         | select(.value != "." and .value != null)
         | { date: .date, price: (.value | tonumber),
             source: "FRED PWHEAMTUSDM (live)", series_id: "PWHEAMTUSDM" }]
       | sort_by(.date)' \
      "$tmp" > "$DATA_DIR/food/wheat-prices.json"

    RECORD_COUNT=$(jq 'length' "$DATA_DIR/food/wheat-prices.json")
    LATEST=$(jq -r '.[-1].date + " $" + (.[-1].price | tostring) + "/MT"' "$DATA_DIR/food/wheat-prices.json")
    echo "wheat-prices.json written: ${RECORD_COUNT} records, latest: ${LATEST}"
  else
    echo "FRED fetch failed (HTTP ${HTTP_STATUS}) — keeping existing data"
  fi
  rm -f "$tmp"
}
```

- [ ] **Step 3: Wire into startup and background loop**

Update startup:
```sh
fetch_fuel_prices
fetch_oil_prices
fetch_gas_prices
fetch_disruption_news
fetch_wheat_prices
```

Update background loop:
```sh
(while true; do sleep 21600; fetch_fuel_prices; fetch_oil_prices; fetch_gas_prices; fetch_disruption_news; fetch_wheat_prices; done) &
```

- [ ] **Step 4: Verify with Docker**

```bash
docker build -t efc-tracker-test . && \
docker run --rm -p 8080:80 -e EIA_API_KEY=$EIA_API_KEY -e FRED_API_KEY=$FRED_API_KEY efc-tracker-test &
sleep 8
curl -s http://localhost:8080/data/food/wheat-prices.json | jq 'length, .[-1]'
docker stop $(docker ps -q --filter ancestor=efc-tracker-test)
```

Expected: a record count and the most recent monthly observation. Wheat usually $200-$400/MT.

### Task 18: Add fetch_food_events to entrypoint.sh

**Files:**
- Modify: `entrypoint.sh`

- [ ] **Step 1: Add function**

After `fetch_wheat_prices`:

```sh
# ── Food events news fetch (Google News RSS + parser) ───────────────────────
fetch_food_events() {
  echo "Fetching food crisis news from Google News RSS..."
  local tmp=$(mktemp)
  local query="wheat+OR+grain+OR+fertilizer+OR+%22food+crisis%22+OR+%22export+ban%22+OR+harvest+OR+famine"
  local ua="Mozilla/5.0 (compatible; EFCTracker/1.0; +https://efc-tracker.fly.dev)"

  if ! curl -sLf -A "$ua" \
    "https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en" \
    -o "$tmp"; then
    echo "Food news fetch failed — keeping existing food-events.json"
    rm -f "$tmp"
    return 1
  fi

  xmlstarlet sel -t -m "//item" \
    -v "title" -o "	" \
    -v "link" -o "	" \
    -v "pubDate" -o "	" \
    -v "source" -n \
    "$tmp" 2>/dev/null | head -25 | \
  jq -R -s '
    def guess_commodity:
      if test("wheat"; "i") then "wheat"
      elif test("\\bcorn\\b|maize"; "i") then "corn"
      elif test("rice"; "i") then "rice"
      elif test("soy|soya|soybean"; "i") then "soy"
      elif test("fertilizer|urea|potash|phosphate"; "i") then "fertilizer"
      else "other" end;

    def guess_country:
      if test("Ukraine|Ukrainian"; "i") then "Ukraine"
      elif test("Russia|Russian"; "i") then "Russia"
      elif test("\\bIndia\\b|Indian"; "i") then "India"
      elif test("\\bChina\\b|Chinese"; "i") then "China"
      elif test("Argentina|Argentine"; "i") then "Argentina"
      elif test("Brazil|Brazilian"; "i") then "Brazil"
      elif test("Egypt|Egyptian"; "i") then "Egypt"
      elif test("Pakistan"; "i") then "Pakistan"
      elif test("Indonesia"; "i") then "Indonesia"
      elif test("Australia|Australian"; "i") then "Australia"
      elif test("Canada|Canadian"; "i") then "Canada"
      elif test("\\bUS\\b|U\\.S\\.|United States|American"; "i") then "US"
      elif test("\\bEU\\b|Europe|European"; "i") then "EU-wide"
      elif test("Africa|African"; "i") then "Africa"
      else "" end;

    def guess_region:
      if test("Europe|EU|UK|France|Germany|Spain|Italy|Ukraine|Russia"; "i") then "Europe"
      elif test("Asia|China|Japan|India|Pakistan|Indonesia|Pacific|Australia"; "i") then "Asia-Pacific"
      elif test("Africa|Nigeria|South Africa|Egypt|Kenya|Ethiopia"; "i") then "Africa"
      elif test("Middle East|Gulf|Saudi|UAE|Qatar|Iran"; "i") then "Middle East"
      elif test("Latin|Brazil|Mexico|Caribbean|Argentina|Chile"; "i") then "Latin America"
      else "North America" end;

    def guess_event_type:
      if test("export ban|export curb|export halt"; "i") then "export_ban"
      elif test("drought|flood|frost|heatwave|harvest fail"; "i") then "harvest_failure"
      elif test("price surge|price jump|price spike|surge"; "i") then "price_surge"
      elif test("supply|shortage|disrupt|crisis"; "i") then "supply_disruption"
      elif test("policy|subsidy|tariff|sanction|tax"; "i") then "policy"
      else "supply_disruption" end;

    def guess_severity:
      if test("famine|crisis|emergency|critical|catastroph"; "i") then "critical"
      elif test("ban|disrupt|shortage|surge|cut|halt"; "i") then "high"
      elif test("warn|risk|concern|threat|tighten"; "i") then "medium"
      else "low" end;

    [split("\n")[] | select(length > 0) | split("\t") | select(length >= 4) |
    . as $f |
    {
      id:           ("FOOD-" + ($f[0] | gsub("[^a-zA-Z0-9]"; "")[0:20])),
      commodity:    ($f[0] | guess_commodity),
      region:       ($f[0] | guess_region),
      country:      ($f[0] | guess_country),
      event_type:   ($f[0] | guess_event_type),
      severity:     ($f[0] | guess_severity),
      summary:      ($f[0] | sub(" - [^-]+$"; "")),
      source_name:  ($f[3] // "News"),
      source_url:   ($f[1] // "#"),
      updated_at:   ($f[2] // "")
    }] | if length > 0 then . else empty end
  ' > /tmp/food_events.json 2>/dev/null

  local count=$(jq 'length' /tmp/food_events.json 2>/dev/null || echo 0)

  if [ "$count" -gt 0 ] 2>/dev/null; then
    cp /tmp/food_events.json "$DATA_DIR/food/food-events.json"
    echo "food-events.json written: ${count} news items (live)"
  else
    echo "No food news items parsed — keeping existing food-events.json"
  fi

  rm -f "$tmp" /tmp/food_events.json
}
```

- [ ] **Step 2: Wire into startup and background loop**

Startup (final order — six fetchers):
```sh
fetch_fuel_prices
fetch_oil_prices
fetch_gas_prices
fetch_disruption_news
fetch_wheat_prices
fetch_food_events
```

Background:
```sh
(while true; do sleep 21600; fetch_fuel_prices; fetch_oil_prices; fetch_gas_prices; fetch_disruption_news; fetch_wheat_prices; fetch_food_events; done) &
```

- [ ] **Step 3: Verify with Docker**

```bash
docker build -t efc-tracker-test . && \
docker run --rm -p 8080:80 -e EIA_API_KEY=$EIA_API_KEY -e FRED_API_KEY=$FRED_API_KEY efc-tracker-test &
sleep 10
curl -s http://localhost:8080/data/food/food-events.json | jq 'length, .[0]'
docker stop $(docker ps -q --filter ancestor=efc-tracker-test)
```

Expected: a record count > 0 and a JSON event with `commodity`, `country`, `event_type`, etc. populated.

### Task 19: Create food.js — register food mode plugin

**Files:**
- Create: `public/food.js`

The food plugin owns: data loading, KPI computation, two view renderers, food-specific filters. All HTML insertion must use `EFC.safeHTML`. All Chart.js charts destroy any prior instance before creating a new one.

- [ ] **Step 1: Write food.js**

`public/food.js`:
```js
'use strict';

(function () {
  const safeHTML   = EFC.safeHTML;
  const escapeHTML = EFC.escapeHTML;
  const fetchJSON  = EFC.fetchJSON;
  const $          = EFC.$;
  const $$         = EFC.$$;

  const FoodState = {
    wheatPrices: [],
    events: [],
    filters: { commodity: '', region: '', country: '', event_type: '', severity: '', search: '' }
  };

  /* ---- Data ---- */

  async function loadData() {
    const [wheat, events] = await Promise.all([
      fetchJSON('/data/food/wheat-prices.json', []),
      fetchJSON('/data/food/food-events.json', [])
    ]);
    FoodState.wheatPrices = wheat;
    FoodState.events = events;
  }

  function getFilteredEvents() {
    const f = FoodState.filters;
    const q = (f.search || '').trim().toLowerCase();
    return FoodState.events.filter(function (e) {
      if (f.commodity && e.commodity !== f.commodity) return false;
      if (f.region && e.region !== f.region) return false;
      if (f.country && (e.country || '').toLowerCase().indexOf(f.country.toLowerCase()) === -1) return false;
      if (f.event_type && e.event_type !== f.event_type) return false;
      if (f.severity && e.severity !== f.severity) return false;
      if (q && (e.summary || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }

  /* ---- KPIs ---- */

  function computeKPIs() {
    const wp = FoodState.wheatPrices;
    const latest = wp.length ? wp[wp.length - 1] : null;
    const prev   = wp.length > 1 ? wp[wp.length - 2] : null;
    const mom = (latest && prev && prev.price)
      ? ((latest.price - prev.price) / prev.price) * 100
      : null;
    const events = getFilteredEvents();
    const critical = events.filter(function (e) { return e.severity === 'critical'; }).length;
    const counts = {};
    events.forEach(function (e) { if (e.country) counts[e.country] = (counts[e.country] || 0) + 1; });
    const topCountry = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || '—';
    return {
      latestPrice:  latest ? latest.price : null,
      latestDate:   latest ? latest.date  : '',
      mom:          mom,
      eventCount:   events.length,
      criticalCount: critical,
      topCountry:   topCountry
    };
  }

  /* ---- Renderers ---- */

  function kpiCard(label, value, sub) {
    return '<div class="kpi-card">'
      + '<div class="kpi-label">' + escapeHTML(label) + '</div>'
      + '<div class="kpi-value">' + escapeHTML(value) + '</div>'
      + '<div class="kpi-sub">' + escapeHTML(sub) + '</div>'
      + '</div>';
  }

  function renderKPIs() {
    const host = $('#food-kpi-grid');
    if (!host) return;
    const k = computeKPIs();
    const momLabel   = (k.mom == null) ? '—' : (k.mom >= 0 ? '+' : '') + k.mom.toFixed(1) + '%';
    const priceLabel = (k.latestPrice == null) ? '—' : '$' + k.latestPrice.toFixed(2) + '/MT';
    const html = ''
      + kpiCard('Wheat Price',   priceLabel, k.latestDate)
      + kpiCard('MoM Change',    momLabel,   'vs prior month')
      + kpiCard('Active Events', String(k.eventCount), 'matching filters')
      + kpiCard('Critical',      String(k.criticalCount), 'critical-severity events')
      + kpiCard('Top Country',   k.topCountry, 'most events');
    safeHTML(host, html);
  }

  function renderWheatChart() {
    const canvas = document.getElementById('wheat-chart');
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    const data = FoodState.wheatPrices;
    if (!data.length) return;
    canvas._chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.map(function (d) { return d.date; }),
        datasets: [{
          label: 'Wheat ($/MT)',
          data: data.map(function (d) { return d.price; }),
          borderColor: '#5fb96a',
          backgroundColor: 'rgba(95, 185, 106, 0.12)',
          tension: 0, stepped: true, pointRadius: 2, fill: true
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }

  function renderEventsTable(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const rows = getFilteredEvents();
    if (!rows.length) {
      safeHTML(tbody, '<tr><td colspan="7" class="empty-cell">No food events match the current filters.</td></tr>');
      return;
    }
    const html = rows.map(function (e) {
      return '<tr>'
        + '<td>' + escapeHTML(e.commodity || '—') + '</td>'
        + '<td>' + escapeHTML(e.country || '—') + '</td>'
        + '<td>' + escapeHTML(e.region || '—') + '</td>'
        + '<td>' + escapeHTML((e.event_type || '').replace(/_/g, ' ')) + '</td>'
        + '<td><span class="sev sev-' + escapeHTML(e.severity || 'low') + '">' + escapeHTML(e.severity || '') + '</span></td>'
        + '<td class="cell-summary">' + escapeHTML(e.summary || '') + '</td>'
        + '<td><a href="' + escapeHTML(e.source_url || '#') + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(e.source_name || 'source') + '</a></td>'
        + '</tr>';
    }).join('');
    safeHTML(tbody, html);
  }

  function renderRecentEventsList() {
    const host = $('#food-recent-events');
    if (!host) return;
    const top = getFilteredEvents().slice(0, 5);
    if (!top.length) {
      safeHTML(host, '<p class="empty">No recent food events.</p>');
      return;
    }
    const html = '<ul class="event-list">' + top.map(function (e) {
      return '<li>'
        + '<span class="sev sev-' + escapeHTML(e.severity) + '">' + escapeHTML(e.severity) + '</span> '
        + '<a href="' + escapeHTML(e.source_url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(e.summary) + '</a> '
        + '<span class="event-meta">' + escapeHTML(e.country || '') + ' · ' + escapeHTML(e.source_name || '') + '</span>'
        + '</li>';
    }).join('') + '</ul>';
    safeHTML(host, html);
  }

  /* ---- Views ---- */

  function showSection(viewId) {
    $$('.view-section').forEach(function (s) {
      s.classList.toggle('hidden', s.dataset.view !== ('food-' + viewId));
    });
  }

  function renderOverview() {
    showSection('overview');
    renderKPIs();
    renderWheatChart();
    renderRecentEventsList();
  }

  function renderEvents() {
    showSection('events');
    renderEventsTable('food-events-tbody');
    const countEl = $('#food-events-count');
    if (countEl) countEl.textContent = getFilteredEvents().length + ' events';
  }

  /* ---- Filters ---- */

  function filtersHTML() {
    return ''
      + '<span class="filter-label" aria-hidden="true">Filter</span>'
      + '<div class="filter-divider" aria-hidden="true"></div>'
      + '<select class="filter-select" id="food-filter-commodity" aria-label="Filter by commodity">'
      +   '<option value="">All Commodities</option>'
      +   '<option value="wheat">Wheat</option>'
      +   '<option value="corn">Corn</option>'
      +   '<option value="rice">Rice</option>'
      +   '<option value="soy">Soy</option>'
      +   '<option value="fertilizer">Fertilizer</option>'
      +   '<option value="other">Other</option>'
      + '</select>'
      + '<select class="filter-select" id="food-filter-region" aria-label="Filter by region">'
      +   '<option value="">All Regions</option>'
      +   '<option value="Europe">Europe</option>'
      +   '<option value="Asia-Pacific">Asia-Pacific</option>'
      +   '<option value="Africa">Africa</option>'
      +   '<option value="Middle East">Middle East</option>'
      +   '<option value="Latin America">Latin America</option>'
      +   '<option value="North America">North America</option>'
      + '</select>'
      + '<input type="text" class="filter-select" id="food-filter-country" placeholder="Country..." aria-label="Filter by country" />'
      + '<select class="filter-select" id="food-filter-event-type" aria-label="Filter by event type">'
      +   '<option value="">All Event Types</option>'
      +   '<option value="export_ban">Export Ban</option>'
      +   '<option value="harvest_failure">Harvest Failure</option>'
      +   '<option value="price_surge">Price Surge</option>'
      +   '<option value="supply_disruption">Supply Disruption</option>'
      +   '<option value="policy">Policy</option>'
      + '</select>'
      + '<select class="filter-select" id="food-filter-severity" aria-label="Filter by severity">'
      +   '<option value="">All Severities</option>'
      +   '<option value="critical">Critical</option>'
      +   '<option value="high">High</option>'
      +   '<option value="medium">Medium</option>'
      +   '<option value="low">Low</option>'
      + '</select>'
      + '<input type="search" class="filter-search" id="food-filter-search" placeholder="Search headlines…" aria-label="Search food events" />'
      + '<button class="filter-clear" id="food-filter-clear" type="button">Clear</button>';
  }

  function initFiltersDOM() {
    const map = [
      ['#food-filter-commodity',   'commodity'],
      ['#food-filter-region',      'region'],
      ['#food-filter-country',     'country'],
      ['#food-filter-event-type',  'event_type'],
      ['#food-filter-severity',    'severity'],
      ['#food-filter-search',      'search']
    ];
    map.forEach(function (pair) {
      const el = document.querySelector(pair[0]);
      if (!el) return;
      el.value = FoodState.filters[pair[1]] || '';
      el.addEventListener('input', function () {
        FoodState.filters[pair[1]] = el.value;
        rerender();
      });
    });
    const clear = document.querySelector('#food-filter-clear');
    if (clear) clear.addEventListener('click', function () {
      Object.keys(FoodState.filters).forEach(function (k) { FoodState.filters[k] = ''; });
      initFiltersDOM();
      rerender();
    });
  }

  function rerender() {
    const view = (location.hash || '').split('/')[1] || 'overview';
    if (view === 'events') renderEvents();
    else renderOverview();
  }

  /* ---- Init ---- */

  let _loaded = false;
  async function init() {
    if (_loaded) return;
    await loadData();
    _loaded = true;
  }

  EFC.registerMode({
    id: 'food',
    label: 'Food',
    icon: 'agriculture',
    defaultView: 'overview',
    views: [
      { id: 'overview', label: 'Overview', icon: 'dashboard', render: renderOverview },
      { id: 'events',   label: 'Events',   icon: 'campaign',  render: renderEvents }
    ],
    filters: { html: filtersHTML, init: initFiltersDOM },
    init: init
  });
})();
```

- [ ] **Step 2: Verify file syntax**

Run: `node -c public/food.js` (or open in browser at next task and check the DevTools console).

### Task 20: Add food view sections to index.html

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add script tag for food.js**

In `public/index.html`, add the food.js script tag between energy.js and app.js:
```html
<script src="/shared.js"></script>
<script src="/energy.js"></script>
<script src="/food.js"></script>
<script src="/app.js"></script>
```

- [ ] **Step 2: Add food view sections inside `#dashboard`**

In `public/index.html`, inside the `<div id="dashboard" class="hidden">` block, after the existing energy view sections (after the closing `</section>` of `data-view="analytics"`), add:

```html
<!-- ====================== FOOD: OVERVIEW ====================== -->
<section data-view="food-overview" class="view-section hidden">
  <div class="page-header">
    <div>
      <h2 class="page-title">Food Overview</h2>
      <p class="page-subtitle">Wheat Prices &amp; Food Crisis News</p>
    </div>
  </div>
  <section aria-label="Food KPIs">
    <div class="kpi-grid" id="food-kpi-grid"></div>
  </section>
  <section class="charts-section">
    <div class="chart-card">
      <div class="chart-header">
        <div>
          <div class="chart-title">Global Wheat Price</div>
          <div class="chart-subtitle">FRED PWHEAMTUSDM · monthly · $/metric ton (data lags ~6 weeks)</div>
        </div>
      </div>
      <div class="chart-canvas-wrap" style="height:240px;">
        <canvas id="wheat-chart" aria-label="Wheat price chart" role="img"></canvas>
      </div>
    </div>
  </section>
  <section class="table-section">
    <div class="table-toolbar">
      <span class="table-title">Recent Food Events</span>
    </div>
    <div id="food-recent-events"></div>
  </section>
</section>

<!-- ====================== FOOD: EVENTS ====================== -->
<section data-view="food-events" class="view-section hidden">
  <div class="page-header">
    <div>
      <h2 class="page-title">Food Events</h2>
      <p class="page-subtitle">Live news via Google News RSS · Refreshed every 6h</p>
    </div>
  </div>
  <section class="table-section">
    <div class="table-toolbar">
      <div class="table-toolbar-left">
        <span class="table-title">Food Events</span>
        <span class="table-count" id="food-events-count">0 events</span>
      </div>
    </div>
    <div class="table-wrap">
      <table id="food-events-table">
        <thead>
          <tr>
            <th scope="col">Commodity</th>
            <th scope="col">Country</th>
            <th scope="col">Region</th>
            <th scope="col">Event Type</th>
            <th scope="col">Severity</th>
            <th scope="col">Summary</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody id="food-events-tbody"></tbody>
      </table>
    </div>
  </section>
</section>
```

**Important:** the food view sections use `data-view="food-overview"` and `data-view="food-events"` (prefixed with `food-`) so the `showSection()` switcher in `food.js` finds them — that switcher prepends `food-` to the viewId.

- [ ] **Step 3: Verify in browser**

```bash
cd public && python3 -m http.server 8080
```

Open http://localhost:8080. Verify:
- Mode tabs row shows TWO tabs: ⚡ Energy and 🌾 Food (the food icon is `agriculture` from Material Symbols — appears as a tractor or wheat shape)
- Click 🌾 Food tab → sidebar nav switches to "Overview" and "Events"; URL becomes `#food/overview`; the page header changes to "Food Overview"; KPI cards render with wheat price ($285.10/MT from seed), MoM change (+2.4%), event count (5), critical count (1), top country (varies)
- Wheat chart renders below KPIs as a stepped line
- Recent food events list shows 5 items
- Filter bar shows commodity / region / country / event_type / severity / search inputs
- Click "Events" in sidebar → URL becomes `#food/events`, full table renders
- Try a filter (commodity = wheat) → table reduces to wheat-only rows (4 of 5)
- Click ⚡ Energy → returns to energy mode at `#energy/overview`, all energy views still work
- Reload the page on `#food/events` → comes back to food/events directly
- DevTools: no errors
- Stop server

### Task 21: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
git add entrypoint.sh public/data/food/ public/food.js public/index.html
git commit -m "feat(food): add food mode with wheat prices and food events

food.js registers a 'food' mode plugin with two views (Overview,
Events). Wheat prices fetched from FRED PWHEAMTUSDM (monthly).
Food events fetched from Google News RSS with a parallel parser
that detects commodity, country, event type, and severity.
Adds food view sections to index.html and the food filter set."
```

---

## Phase 6 — Identity rename: code & branding

Now that all features work, do the rebrand pass: in-app strings, config namespace, fly.toml app name, GitHub Actions app name. No URL change yet (Fly migration is Phase 8).

### Task 22: Rename FUELWATCH_CONFIG to EFC_CONFIG

**Files:**
- Modify: `public/index.html` (line 26-27)
- Modify: `entrypoint.sh` (config.js writer block)

- [ ] **Step 1: Update HTML**

In `public/index.html`, find lines 26-27:
```html
<script>window.FUELWATCH_CONFIG = window.FUELWATCH_CONFIG || {};</script>
<script src="/config.js" onerror="console.info('config.js not found — using seed data')"></script>
```
Replace with:
```html
<script>window.EFC_CONFIG = window.EFC_CONFIG || {};</script>
<script src="/config.js" onerror="console.info('config.js not found — using seed data')"></script>
```

- [ ] **Step 2: Update entrypoint.sh**

Find the config.js heredoc near the bottom (around lines 195-199):
```sh
cat > /usr/share/nginx/html/config.js <<'EOF'
// Auto-generated at container start — do not edit or commit.
// API keys are handled server-side in entrypoint.sh.
window.FUELWATCH_CONFIG = {};
EOF
```
Replace `FUELWATCH_CONFIG` with `EFC_CONFIG`.

- [ ] **Step 3: Verify**

Run: `grep -rn "FUELWATCH_CONFIG" public/ entrypoint.sh`
Expected: no matches.

### Task 23: Rebrand all in-app text strings

**Files:**
- Modify: `public/index.html` (multiple locations)

- [ ] **Step 1: Update title and meta**

In `public/index.html`:

Line 6:
```html
<meta name="description" content="Real-time aviation fuel shortage tracker — airline disruptions, kerosene prices, and route impacts." />
```
Replace with:
```html
<meta name="description" content="EFC Tracker — Energy & Food Crisis Tracker. Real-time intelligence on jet fuel, oil, gas, wheat prices, and supply disruptions." />
```

Line 7:
```html
<title>Aviation Disruption Tracker</title>
```
Replace with:
```html
<title>EFC Tracker — Energy & Food Crisis</title>
```

- [ ] **Step 2: Update brand label**

Line 39:
```html
<div class="nav-brand">Aviation Disruption Tracker</div>
```
Replace with:
```html
<div class="nav-brand">EFC Tracker</div>
```

- [ ] **Step 3: Update info popover**

Find the info popover content (around lines 87-99). Replace with:
```html
<div class="info-popover-title">EFC Tracker</div>
<p>Energy & Food Crisis Tracker. Real-time intelligence on commodity prices and supply disruptions across two domains.</p>
<p><strong>Energy mode:</strong> jet fuel (EIA EPJK), WTI crude (EIA EPCWTI), Henry Hub natural gas, plus airline disruption news.</p>
<p><strong>Food mode:</strong> global wheat prices (FRED PWHEAMTUSDM, monthly) and food crisis news (Google News RSS).</p>
<div class="info-popover-footer">All data refreshed every 6h server-side. See README for sources and limitations.</div>
```

- [ ] **Step 4: Update footer**

Find the footer (around lines 376-386):
```html
<footer class="site-footer" role="contentinfo">
  <p class="footer-text">
    © 2025 Aviation Disruption Tracker · Global Ops v1.0 · Fuel prices reference EIA WJFUELUSGULF
  </p>
  <div class="footer-sources">
    ...
  </div>
</footer>
```

Replace with:
```html
<footer class="site-footer" role="contentinfo">
  <p class="footer-text">
    © 2026 EFC Tracker · Energy & Food Crisis · Open data from EIA, FRED, World Bank
  </p>
  <div class="footer-sources">
    <a href="https://www.eia.gov/opendata/" target="_blank" rel="noopener noreferrer" class="footer-source-link">EIA Open Data</a>
    <a href="https://fred.stlouisfed.org/" target="_blank" rel="noopener noreferrer" class="footer-source-link">FRED</a>
    <a href="https://www.worldbank.org/en/research/commodity-markets" target="_blank" rel="noopener noreferrer" class="footer-source-link">World Bank Commodities</a>
  </div>
</footer>
```

- [ ] **Step 5: Verify**

Run: `grep -in "fuelwatch\|aviation disruption tracker\|jet fuel shortage tracker" public/index.html`
Expected: no matches.

Run: `grep -c "EFC Tracker" public/index.html`
Expected: a number ≥ 4.

### Task 24: Rename Fly app in fly.toml and GitHub Actions

**Files:**
- Modify: `fly.toml`
- Modify: `.github/workflows/refresh-data.yml`

- [ ] **Step 1: Update fly.toml**

Open `fly.toml`. Find the `app = "fuelwatch-dashboard"` line and change to `app = "efc-tracker"`. Leave region and other config alone.

Also check for any `primary_region` or app-name references in env / build args; rename if they reference fuelwatch.

- [ ] **Step 2: Update workflow file**

In `.github/workflows/refresh-data.yml`:

- Replace `name: Refresh fuel price data` with `name: Refresh EFC Tracker data`.
- In the `flyctl machines list ... --app fuelwatch-dashboard` command (last line of the run step), replace BOTH occurrences of `fuelwatch-dashboard` with `efc-tracker`:

```yaml
run: flyctl machines list --app efc-tracker --json | jq -r '.[].id' | xargs -I{} flyctl machines restart {} --app efc-tracker
```

- [ ] **Step 3: Verify**

Run: `grep -rn "fuelwatch" .github/ fly.toml`
Expected: no matches.

### Task 25: Commit Phase 6

- [ ] **Step 1: Commit**

```bash
git add public/index.html entrypoint.sh fly.toml .github/workflows/refresh-data.yml
git commit -m "rebrand: rename project to EFC Tracker (Energy & Food Crisis)

Renames in-app strings, info popover, footer, page title/meta.
window.FUELWATCH_CONFIG -> window.EFC_CONFIG.
fly.toml app: fuelwatch-dashboard -> efc-tracker.
GitHub Actions workflow points at the new Fly app.
URL/Fly migration happens in the next phase."
```

---

## Phase 7 — README rewrite

### Task 26: Rewrite README for EFC Tracker

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README**

Replace the entire `README.md` with a fresh version covering:
- New project name and tagline
- Two-mode architecture overview (Energy: jet fuel + WTI + HH gas + aviation news; Food: wheat + food events)
- Updated project structure showing `data/energy/` and `data/food/` plus `shared.js` / `energy.js` / `food.js`
- All 6 data sources in the Data Sources table (EIA EPJK, EIA EPCWTI, EIA Henry Hub, FRED PWHEAMTUSDM, Google News RSS aviation, Google News RSS food)
- Updated Run Locally section (only Options 1 and 2 — Option 3 was already removed per recent commit b3ef426)
- Updated Required Secrets: `EIA_API_KEY` and `FRED_API_KEY`
- Updated Deploy commands using `--app efc-tracker`
- Tech Stack table (no changes)
- Honest limitations section (FRED data lags ~6 weeks; Google News parsing is heuristic-based)

The exact prose can mirror the structure of the existing README — it's a rewrite of substance, not form. Keep the markdown clean and the tables aligned. Don't include screenshots or asciiart that doesn't exist.

After writing, run: `grep -in "fuelwatch\|aviation disruption tracker\|jet fuel shortage tracker" README.md`
Expected: no matches.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for EFC Tracker

Covers both Energy and Food modes, all 6 data sources, new
project structure (shared/energy/food split), updated deploy
commands with the new Fly app name."
```

---

## Phase 8 — Fly migration & cutover (USER ACTIONS)

These steps must be run by the user — they touch live infrastructure and require Fly auth on the user's machine. Each step is a checkpoint.

### Task 27: Create new Fly app and set secrets

- [ ] **Step 1: USER ACTION — create new Fly app**

```bash
fly apps create efc-tracker
```

Expected: confirmation that the app was created. If the name is taken, choose `efc-tracker-eu` or similar and update `fly.toml`'s `app = ` line accordingly before deploying.

- [ ] **Step 2: USER ACTION — set secrets on new app**

```bash
fly secrets set EIA_API_KEY=your_existing_eia_key --app efc-tracker
fly secrets set FRED_API_KEY=your_new_fred_key --app efc-tracker
```

Verify: `fly secrets list --app efc-tracker` shows both.

### Task 28: First deploy to new app

- [ ] **Step 1: USER ACTION — deploy**

```bash
fly deploy --app efc-tracker
```

Expected: build succeeds, machine starts, deploy completes. If `fly.toml`'s `app = "efc-tracker"` was set in Task 24, the `--app` flag is redundant but harmless.

- [ ] **Step 2: USER ACTION — verify logs**

```bash
fly logs --app efc-tracker
```

Look for these lines (within ~30 seconds of startup):
- `fuel-prices.json written: NN records, latest: YYYY-MM-DD $X.XX/gal`
- `oil-prices.json written: NN records, latest: YYYY-MM-DD $X.XX/bbl`
- `gas-prices.json written: NN records, latest: YYYY-MM-DD $X.XX/MMBtu`
- `wheat-prices.json written: NN records, latest: YYYY-MM-DD $X.XX/MT`
- `disruptions.json written: N news items (live)`
- `food-events.json written: N news items (live)`
- `config.js written`

Then visit `https://efc-tracker.fly.dev`. Verify:
- Page loads, mode tabs show Energy + Food
- Energy/Analytics shows three live charts (jet fuel, WTI, Henry Hub)
- Food/Overview shows wheat KPI with current price and MoM
- Food/Events shows live parsed food news
- Hard refresh on `https://efc-tracker.fly.dev/#analytics` → silently routes to `#energy/analytics`

### Task 29: Update GitHub Actions for new app

- [ ] **Step 1: USER ACTION — issue a new deploy token**

```bash
fly tokens create deploy -x 999999h --app efc-tracker
```

Copy the printed token.

- [ ] **Step 2: USER ACTION — update GitHub repo secret**

In the GitHub repo settings → Secrets → Actions, update `FLY_API_TOKEN` with the new token. (The workflow file already references the new app name from Task 24.)

- [ ] **Step 3: USER ACTION — trigger workflow manually**

In the GitHub Actions tab, find "Refresh EFC Tracker data" and click "Run workflow" → "Run workflow".

Expected: workflow run succeeds. Then `fly logs --app efc-tracker` shows fresh fetch lines (machine restart triggered the entrypoint re-run).

### Task 30: Destroy old Fly app

- [ ] **Step 1: USER ACTION — final sanity check**

Confirm the new app is healthy:
- `fly status --app efc-tracker` shows running
- `https://efc-tracker.fly.dev` loads correctly
- GitHub Actions cron worked in Task 29

- [ ] **Step 2: USER ACTION — destroy old app**

```bash
fly apps destroy fuelwatch-dashboard
```

Expected: confirmation prompt; type the app name to confirm. After this, `fuelwatch-dashboard.fly.dev` returns Fly's "no such app" page. This is irreversible.

### Task 31: Tag and optionally rename folder/repo

- [ ] **Step 1: Tag the cutover**

```bash
git tag -a v2.0.0 -m "EFC Tracker — dual-domain (energy + food) launch"
git push --tags
```

- [ ] **Step 2: USER ACTION — rename folder and GitHub repo (optional, non-code)**

Locally:
```bash
cd ..
mv jet-fuel-shortage-tracker efc-tracker
cd efc-tracker
```

On github.com: Settings → Rename repo → `efc-tracker`. Update local remote:
```bash
git remote set-url origin https://github.com/YOUR_USER/efc-tracker.git
```

---

## Phase 9 — Final verification

### Task 32: End-to-end smoke test

- [ ] **Step 1: Full smoke test on production**

Open `https://efc-tracker.fly.dev`. Walk through:

| Action | Expected |
|---|---|
| Page loads default mode | Energy mode active, Overview view, KPIs populated |
| Click 🌾 Food tab | Sidebar swaps to Overview/Events; Food Overview renders; URL = `#food/overview` |
| Wheat KPIs visible | Latest price > $0/MT; MoM change shows ±%; event count from live parser |
| Click Food → Events | Filterable table renders with parsed Google News items |
| Filter commodity = wheat | Table reduces to wheat-only rows |
| Click ⚡ Energy tab | Returns to energy mode at `#energy/overview` |
| Energy Analytics view | Three live charts: jet fuel ($/gal), WTI ($/bbl), Henry Hub ($/MMBtu) |
| Hard refresh on `#energy/airports` | Loads directly into Airports view |
| Hard refresh on `#analytics` (legacy) | Silently rewrites to `#energy/analytics` |
| Theme toggle | Switches dark ↔ light, persists across reload |
| Sidebar collapse | Toggles to icons-only, persists across reload |
| Mode preference | Reload after switching to Food → opens in Food mode |

If anything fails, debug it in a feature branch — don't fix in main.

### Task 33: Document deferred items

- [ ] **Step 1: Confirm OUT-OF-SCOPE items still feel right**

Re-read §9 of the design spec. If after seeing the live app you want to change scope (e.g., add corn pricing next), that's a fresh brainstorm — don't slip scope into this branch.

---

## Spec coverage checklist

Confirming each section of `2026-05-03-efc-tracker-design.md` is covered:

- [x] §1 Goal — entire plan
- [x] §2 Top-level UX (mode tabs, mode-aware sidebar) — Tasks 5, 6, 8
- [x] §3 Energy mode (5 views unchanged + WTI/HH on Analytics) — Tasks 6, 13
- [x] §4 Food mode (2 views, wheat from FRED, parsed food news, food filters) — Tasks 15-20
- [x] §5 Code structure (shared.js / energy.js / food.js + EFC namespace) — Tasks 5, 6, 19
- [x] §6 Data layer (file reorg, 6 fetchers, seed data) — Tasks 1-4, 10-12, 15-18
- [x] §7 Identity rename + Fly migration (10 ordered steps) — Tasks 22-30
- [x] §8 Files-changed table — covered across all phases
- [x] §10 Success criteria — Task 32
