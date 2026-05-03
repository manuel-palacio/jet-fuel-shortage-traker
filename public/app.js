'use strict';

/* ================================================================
   SAFE HTML — all innerHTML goes through DOMPurify sanitization.
   DOMPurify is loaded in the HTML head via CDN. This wrapper is the
   ONLY function that sets innerHTML in the app — a single chokepoint
   for XSS prevention.
   ================================================================ */
function safeHTML(el, html) {
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  if (tag === 'tbody' || tag === 'thead') {
    const sanitized = DOMPurify.sanitize(
      `<table><${tag}>${html}</${tag}></table>`,
      { ADD_ATTR: ['target', 'rel'] }
    );
    const tmp = document.createElement('div');
    tmp.innerHTML = sanitized; // safe: DOMPurify output
    const inner = tmp.querySelector(tag);
    el.innerHTML = ''; // safe: clearing
    if (inner) while (inner.firstChild) el.appendChild(inner.firstChild);
  } else {
    el.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] }); // safe: DOMPurify output
  }
}

/* ================================================================
   DATA ADAPTERS — fetch from /data/*.json, no inline seed data
   ================================================================ */

async function fetchFuelPrices() {
  try {
    const resp = await fetch('/data/energy/fuel-prices.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = await resp.json();
    if (Array.isArray(raw) && raw.length) return normalizeFuelPriceData(raw);
    throw new Error('Empty data file');
  } catch (err) {
    console.warn('fuel-prices.json not available:', err.message);
    return [];
  }
}

function normalizeFuelPriceData(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter(r => r && r.date && r.price != null)
    .map(r => ({
      date:      String(r.date),
      price:     parseFloat(r.price),
      source:    String(r.source || 'Unknown'),
      series_id: String(r.series_id || ''),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchDisruptionEvents() {
  try {
    const resp = await fetch('/data/energy/disruptions.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return normalizeDisruptionData(await resp.json());
  } catch (err) {
    console.warn('disruptions.json not available:', err.message);
    return [];
  }
}

function normalizeDisruptionData(raw) {
  return (Array.isArray(raw) ? raw : []).map(r => ({
    id:                String(r.id || Math.random().toString(36).slice(2)),
    airline:           String(r.airline || ''),
    airline_code:      String(r.airline_code || ''),
    region:            String(r.region || ''),
    country:           String(r.country || ''),
    routes:            Array.isArray(r.routes)   ? r.routes.map(String)   : [],
    airports:          Array.isArray(r.airports) ? r.airports.map(String) : [],
    cancellations:     parseInt(r.cancellations, 10) || 0,
    impact_type:       String(r.impact_type  || 'fuel_risk'),
    severity:          String(r.severity     || 'low'),
    summary:           String(r.summary      || ''),
    operational_notes: String(r.operational_notes || ''),
    timeline:          Array.isArray(r.timeline) ? r.timeline : [],
    source_name:       String(r.source_name  || ''),
    source_url:        String(r.source_url   || '#'),
    updated_at:        String(r.updated_at   || new Date().toISOString()),
  }));
}

async function fetchAirports() {
  try {
    const resp = await fetch('/data/energy/airports.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    console.warn('airports.json not available:', err.message);
    return [];
  }
}

/* ================================================================
   APPLICATION STATE
   ================================================================ */

const AppState = {
  disruptions: [],
  fuelPrices:  [],
  airports:    [],
  filters: { airline: '', region: '', country: '', impactType: '', severity: '', search: '' },
  sort:    { col: 'updated_at', dir: 'desc' },
  selectedEventId: null,
  _lastFocusedRow: null,
  theme: 'dark',
  currentView: 'overview',
  summerMode: false,
  bannerDismissed: false,
};

/* ================================================================
   FILTERING & SORTING
   ================================================================ */

function getFilteredDisruptions() {
  const { airline, region, country, impactType, severity, search } = AppState.filters;
  const q = search.toLowerCase().trim();
  return AppState.disruptions.filter(d => {
    if (airline    && d.airline     !== airline)    return false;
    if (region     && d.region      !== region)     return false;
    if (country    && d.country     !== country)    return false;
    if (impactType && d.impact_type !== impactType) return false;
    if (severity   && d.severity    !== severity)   return false;
    if (q) {
      const hay = [...d.routes, ...d.airports, d.airline, d.region, d.summary].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function sortDisruptions(rows) {
  const { col, dir } = AppState.sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av = a[col] ?? '', bv = b[col] ?? '';
    if (col === 'severity') { av = SEV_ORDER[av] ?? 99; bv = SEV_ORDER[bv] ?? 99; }
    else if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); }
    return (av < bv ? -1 : av > bv ? 1 : 0) * mult;
  });
}

/* ================================================================
   SUMMER MODE HELPERS
   ================================================================ */

const SUMMER_MULTIPLIER = 1.35;

function getAirportCoverDays(airport) {
  if (AppState.summerMode) {
    return airport.storage_capacity_ml / (airport.daily_burn_ml * SUMMER_MULTIPLIER);
  }
  return airport.cover_days;
}

function getCoverDaysClass(days) {
  if (AppState.summerMode) {
    if (days >= 21) return 'green';
    if (days >= 10) return 'amber';
    return 'red';
  }
  if (days >= 14) return 'green';
  if (days >= 7)  return 'amber';
  return 'red';
}

function getCoverDaysRiskLabel(days) {
  const cls = getCoverDaysClass(days);
  return cls === 'green' ? 'LOW RISK' : cls === 'amber' ? 'MEDIUM RISK' : 'HIGH RISK';
}

/* ================================================================
   KPI COMPUTATION (Issue #7 — supply-focused metrics)
   ================================================================ */

function computeKPIs(disruptions, fuelPrices, airports) {
  const coverDays = airports.map(a => getAirportCoverDays(a));
  const avgCoverDays = coverDays.length ? coverDays.reduce((s, d) => s + d, 0) / coverDays.length : null;

  const riskThreshold = AppState.summerMode ? 10 : 7;
  const airportsAtRisk = coverDays.filter(d => d < riskThreshold).length;

  const sorted = [...fuelPrices].sort((a, b) => b.date.localeCompare(a.date));
  const latestPrice = sorted[0]?.price ?? null;
  const prevPrice   = sorted[7]?.price ?? null;
  const priceDelta  = latestPrice && prevPrice ? latestPrice - prevPrice : null;
  const deltaPct    = priceDelta && prevPrice ? (priceDelta / prevPrice) * 100 : null;

  // Import risk index (composite)
  const depScores = { HIGH: 3, MED: 2, LOW: 1 };
  const avgDep = airports.length
    ? airports.reduce((s, a) => s + (depScores[a.import_dependency] || 1), 0) / airports.length
    : 0;
  const supplyStress = avgCoverDays ? Math.max(0, 3 - (avgCoverDays - 8) * 0.5) : 0;
  const priceStress  = latestPrice ? Math.min(3, Math.max(0, (latestPrice - 2.5) * 3)) : 0;
  const importRiskScore = Math.round(avgDep + supplyStress + priceStress);
  const importRiskLevel = importRiskScore <= 4 ? 'LOW' : importRiskScore <= 7 ? 'MEDIUM' : importRiskScore <= 9 ? 'HIGH' : 'CRITICAL';

  const totalCanceled  = disruptions.reduce((s, d) => s + d.cancellations, 0);
  const criticalEvents = disruptions.filter(d => d.severity === 'critical').length;

  return { avgCoverDays, airportsAtRisk, totalAirports: airports.length, latestPrice, priceDelta, deltaPct, importRiskScore, importRiskLevel, totalCanceled, criticalEvents };
}

/* ================================================================
   RENDER: KPI CARDS (Issue #7)
   ================================================================ */

function renderKPIs(disruptions, fuelPrices, airports) {
  const kpi = computeKPIs(disruptions, fuelPrices, airports);
  const fmtN  = n => n == null ? '\u2014' : n.toLocaleString();
  const fmtP  = p => p == null ? '\u2014' : '$' + p.toFixed(3);
  const fmtD  = d => d == null ? '' : (d >= 0 ? '+' : '') + d.toFixed(3);
  const fmtPct = p => p == null ? '' : (p >= 0 ? '\u25B2' : '\u25BC') + Math.abs(p).toFixed(1) + '%';
  const dcls   = kpi.priceDelta == null ? 'neutral' : kpi.priceDelta > 0 ? 'up' : 'down';

  const deltaHTML = kpi.priceDelta != null
    ? `<span class="kpi-delta ${dcls}">${fmtPct(kpi.deltaPct)} ${fmtD(kpi.priceDelta)}</span>`
    : '';

  const riskColors = { LOW: '--c-low', MEDIUM: '--c-medium', HIGH: '--c-high', CRITICAL: '--error' };

  const cards = [
    { label: 'Avg. Cover Days', value: kpi.avgCoverDays != null ? kpi.avgCoverDays.toFixed(1) : '\u2014', extra: AppState.summerMode ? '<span class="kpi-delta neutral">summer-adjusted</span>' : '', sub: 'Modelled estimates \u00B7 ' + kpi.totalAirports + ' airports', accent: '--primary' },
    { label: 'Airports at Risk', value: kpi.airportsAtRisk + ' / ' + kpi.totalAirports, extra: '', sub: AppState.summerMode ? 'Below 10 days cover (summer)' : 'Below 7 days cover', accent: kpi.airportsAtRisk > 0 ? '--error' : '--c-low', clickable: true, target: '#airports' },
    { label: 'Jet Fuel Price', value: fmtP(kpi.latestPrice), valueClass: 'accent', extra: deltaHTML, sub: 'US Gulf Coast Kerosene \u00B7 7-week \u0394', accent: '--primary' },
    { label: 'Import Risk Index', value: kpi.importRiskLevel, extra: `<div class="risk-tooltip-wrap"><span class="kpi-delta neutral" style="cursor:help">score: ${kpi.importRiskScore}</span><div class="risk-tooltip">Composite of import dependency,<br>supply coverage, and fuel price stress</div></div>`, sub: 'Composite supply risk', accent: riskColors[kpi.importRiskLevel] || '--primary' },
    { label: 'Total Cancellations', value: fmtN(kpi.totalCanceled), extra: '', sub: 'Total known flight cancellations', accent: '--error' },
    { label: 'Critical Events', value: fmtN(kpi.criticalEvents), extra: '', sub: 'Severity: critical', accent: kpi.criticalEvents > 0 ? '--error' : '--c-low' },
  ];

  const html = cards.map(c => `
    <div class="kpi-card ${c.clickable ? 'clickable' : ''}" style="--kpi-accent:var(${c.accent})" ${c.target ? `data-kpi-target="${c.target}"` : ''}>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value ${c.valueClass || ''}">${c.value}</div>
      ${c.extra}
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');

  const grid = document.getElementById('kpi-grid');
  safeHTML(grid, html);

  grid.querySelectorAll('.kpi-card[data-kpi-target]').forEach(card => {
    card.addEventListener('click', () => {
      location.hash = card.dataset.kpiTarget;
    });
  });
}

/* ================================================================
   RENDER: TABLE
   ================================================================ */

function renderTable(rows, tbodyId, countId) {
  tbodyId = tbodyId || 'table-body';
  countId = countId || 'table-count';
  const tbody = document.getElementById(tbodyId);
  const count = document.getElementById(countId);
  if (!tbody) return;
  if (count) count.textContent = `${rows.length} event${rows.length !== 1 ? 's' : ''}`;

  if (rows.length === 0) {
    safeHTML(tbody, `<tr class="empty-row"><td colspan="8">
      <span class="empty-icon" aria-hidden="true">\uD83D\uDD0D</span>
      <span class="empty-text">No disruptions match the current filters.<br>Try adjusting or clearing the filters above.</span>
    </td></tr>`);
    return;
  }

  const isOverview = tbodyId === 'table-body';
  const html = rows.map(d => {
    const vis  = d.routes.slice(0, 2);
    const more = d.routes.length - vis.length;
    const chips = vis.map(r => `<span class="route-chip">${esc(r)}</span>`).join('')
                + (more > 0 ? `<span class="route-chip-more">+${more}</span>` : '');
    const ncls  = d.cancellations >= 40 ? 'high-num' : d.cancellations >= 15 ? 'med-num' : '';
    return `<tr tabindex="0" role="button" aria-label="View details: ${esc(d.airline)} event ${esc(d.id)}" data-id="${esc(d.id)}">
      <td class="td-primary"><div class="airline-cell">${d.airline_code ? `<span class="airline-code">${esc(d.airline_code)}</span>` : ''}${esc(d.airline || d.summary || 'News item')}</div></td>
      <td class="${isOverview ? 'col-region' : ''}">${esc(d.region)}</td>
      <td class="${isOverview ? 'col-routes' : ''}"><div class="routes-chips">${chips}</div></td>
      <td class="num-cell ${ncls}">${d.cancellations}</td>
      <td class="${isOverview ? 'col-impact' : ''}"><span class="impact-badge impact-${esc(d.impact_type)}">${impactLabel(d.impact_type)}</span></td>
      <td><span class="badge ${esc(d.severity)}"><span class="badge-dot" aria-hidden="true"></span>${esc(d.severity)}</span></td>
      <td class="ts-cell ${isOverview ? 'col-updated' : ''}">${fmtDate(d.updated_at)}</td>
      <td class="${isOverview ? 'col-source' : ''}"><a href="${esc(d.source_url)}" target="_blank" rel="noopener noreferrer" class="source-link" onclick="event.stopPropagation()" aria-label="Source: ${esc(d.source_name)} (opens new tab)">${esc(trunc(d.source_name, 22))}</a></td>
    </tr>`;
  }).join('');

  safeHTML(tbody, html);

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      AppState._lastFocusedRow = row;
      openDrawer(row.dataset.id);
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        AppState._lastFocusedRow = row;
        openDrawer(row.dataset.id);
      }
    });
  });

  if (isOverview) updateSortHeaders();
}

/* ================================================================
   RENDER: CHARTS
   ================================================================ */

let fuelChartInst = null, timelineChartInst = null, donutChartInst = null;
let analyticsFuelInst = null, regionalChartInst = null, seasonalityChartInst = null;

function cc() {
  const s = getComputedStyle(document.documentElement);
  const g = k => s.getPropertyValue(k).trim();
  return {
    accent:   g('--accent')    || '#adc7ff',
    critical: g('--c-critical')|| '#ffb4ab',
    high:     g('--c-high')    || '#ffba3f',
    medium:   g('--c-medium')  || '#e8c44a',
    low:      g('--c-low')     || '#4ade80',
    info:     g('--c-info')    || '#b7c8e1',
    purple:   g('--c-purple')  || '#c4b5fd',
    grid:     g('--chart-grid')|| 'rgba(66,71,82,.35)',
    txt:      g('--chart-txt') || '#8c919d',
    elevated: g('--bg-elevated')|| '#222a3d',
  };
}

function renderFuelChart() {
  const prices = AppState.fuelPrices;
  if (!prices.length) return;
  const colors = cc();
  const ctx = document.getElementById('fuel-chart')?.getContext('2d');
  if (!ctx) return;
  if (fuelChartInst) fuelChartInst.destroy();

  const latest = prices[prices.length - 1];
  const badge = document.getElementById('fuel-badge');
  if (badge && latest) badge.textContent = '$' + latest.price.toFixed(3) + '/gal';

  const srcLabel = document.getElementById('data-source-label');
  if (srcLabel && latest) {
    srcLabel.textContent = latest.source.toLowerCase().includes('live') ? 'Live Data' : 'Seed Data';
  }

  const labels = prices.map(p => {
    const d = new Date(p.date + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  });
  const dedupLabels = labels.map((l, i) => i === 0 || labels[i - 1] !== l ? l : '');

  fuelChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dedupLabels,
      datasets: [{
        label: 'Jet Fuel $/gal', data: prices.map(p => p.price),
        borderColor: colors.accent, backgroundColor: hexAlpha(colors.accent, 0.08),
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: colors.accent, fill: true, tension: 0.35,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: colors.elevated, titleColor: colors.txt, bodyColor: colors.accent, borderColor: colors.grid, borderWidth: 1, padding: 10,
          callbacks: { label: ctx => ' $' + ctx.parsed.y.toFixed(3) + '/gal', title: items => prices[items[0].dataIndex]?.date || '' } },
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 }, maxTicksLimit: 12, maxRotation: 0 }, border: { display: false } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 }, callback: v => '$' + v.toFixed(2) }, border: { display: false } },
      },
    },
  });
}

function renderTimelineChart(rows) {
  const colors = cc();
  const ctx = document.getElementById('timeline-chart')?.getContext('2d');
  if (!ctx) return;
  if (timelineChartInst) timelineChartInst.destroy();

  const eventDate = d => (d.timeline && d.timeline[0] && d.timeline[0].date) || d.updated_at.slice(0, 10);
  const allDates = [...new Set(rows.map(eventDate))].sort();
  const airlineNames = [...new Set(rows.map(d => d.airline))].sort();
  const palette = [colors.info, colors.purple, colors.critical, colors.accent, colors.high, colors.medium];
  const shortLabel = a => a.replace(' Airlines', '').replace('Air New Zealand', 'Air NZ');

  const datasets = airlineNames.map((airline, i) => {
    const events = rows.filter(d => d.airline === airline);
    const byDate = {};
    for (const e of events) { const d = eventDate(e); byDate[d] = (byDate[d] || 0) + e.cancellations; }
    const data = allDates.map(d => byDate[d] !== undefined ? byDate[d] : null);
    const color = palette[i % palette.length];
    return { label: shortLabel(airline), data, borderColor: color, backgroundColor: hexAlpha(color, 0.12), pointBackgroundColor: color, pointBorderColor: color, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, spanGaps: false, tension: 0, fill: false };
  });

  timelineChartInst = new Chart(ctx, {
    type: 'line', data: { labels: allDates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: colors.txt, font: { family: "'Inter'", size: 11 }, boxWidth: 10, padding: 12, usePointStyle: true } },
        tooltip: { backgroundColor: colors.elevated, titleColor: colors.txt, bodyColor: colors.txt, borderColor: colors.grid, borderWidth: 1, padding: 10,
          callbacks: { label: c => c.parsed.y !== null ? ` ${c.dataset.label}: ${c.parsed.y} canceled` : null }, filter: item => item.parsed.y !== null },
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 }, maxRotation: 0 }, border: { display: false } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 }, stepSize: 10 }, border: { display: false }, beginAtZero: true },
      },
    },
  });
}

function renderDonutChart(rows) {
  const colors = cc();
  const ctx = document.getElementById('donut-chart')?.getContext('2d');
  if (!ctx) return;
  if (donutChartInst) donutChartInst.destroy();

  const types = { cancellations: 0, fare_increase: 0, schedule_cuts: 0, fuel_risk: 0 };
  for (const d of rows) if (types[d.impact_type] !== undefined) types[d.impact_type]++;

  donutChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Cancellations', 'Fare Increase', 'Schedule Cuts', 'Fuel Risk'],
      datasets: [{ data: Object.values(types), backgroundColor: [colors.critical, colors.high, colors.medium, colors.purple].map(c => hexAlpha(c, .85)), borderColor: [colors.critical, colors.high, colors.medium, colors.purple], borderWidth: 1.5, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: colors.txt, font: { family: "'Inter'", size: 11 }, boxWidth: 10, padding: 12 } },
        tooltip: { backgroundColor: colors.elevated, titleColor: colors.txt, bodyColor: colors.accent, borderColor: colors.grid, borderWidth: 1, padding: 10, callbacks: { label: c => ' ' + c.parsed + ' event' + (c.parsed !== 1 ? 's' : '') } },
      },
    },
  });
}

/* ================================================================
   RENDER: AIRPORT CARDS (Issue #1)
   ================================================================ */

function renderAirportCards() {
  const grid = document.getElementById('airport-grid');
  if (!grid) return;

  const html = AppState.airports.map(a => {
    const days = getAirportCoverDays(a);
    const cls = getCoverDaysClass(days);
    const drawPct = Math.min(100, Math.round((a.daily_burn_ml / a.storage_capacity_ml) * 100));
    const barColor = drawPct > 80 ? 'var(--c-critical)' : drawPct > 50 ? 'var(--c-high)' : 'var(--c-low)';
    const depCls = a.import_dependency === 'HIGH' ? 'critical' : a.import_dependency === 'MED' ? 'high' : 'low';

    return `
    <div class="airport-card" data-airport="${esc(a.code)}">
      <div class="airport-card-header">
        <span class="airport-code-badge">${esc(a.code)}</span>
        <div>
          <div class="airport-name">${esc(a.name)}</div>
          <div class="airport-city">${esc(a.city)}, ${esc(a.country)}</div>
        </div>
      </div>
      <div class="cover-days-display cover-days-${cls}">
        <span class="cover-days-number">${days.toFixed(1)}</span>
        <div>
          <div class="cover-days-label">${getCoverDaysRiskLabel(days)}</div>
          <div style="font-size:10px;color:var(--text-muted)">days of cover</div>
        </div>
      </div>
      <div class="airport-stats">
        <div class="airport-stat">
          <span class="airport-stat-label">Daily Burn</span>
          <span class="airport-stat-value">${a.daily_burn_ml.toFixed(1)} ML/day</span>
        </div>
        <div class="airport-stat">
          <span class="airport-stat-label">Storage Capacity</span>
          <span class="airport-stat-value">${a.storage_capacity_ml.toFixed(1)} ML</span>
        </div>
        <div class="airport-stat">
          <span class="airport-stat-label">Daily Draw Rate</span>
          <span class="airport-stat-value">${drawPct}% of capacity/day</span>
        </div>
        <div class="capacity-bar"><div class="capacity-bar-fill" style="width:${drawPct}%;background:${barColor}"></div></div>
        <div class="airport-stat">
          <span class="airport-stat-label">Import Dependency</span>
          <span class="badge ${depCls}" style="font-size:9px"><span class="badge-dot" aria-hidden="true"></span>${esc(a.import_dependency)}</span>
        </div>
      </div>
      <div class="airport-notes">${esc(a.notes)}</div>
    </div>`;
  }).join('');

  safeHTML(grid, html);
}

/* ================================================================
   RENDER: EUROPE MAP (Issue #2)
   ================================================================ */

let mapInstance = null;
let mapInitialized = false;

function renderMap() {
  if (mapInitialized && mapInstance) {
    updateMapMarkers();
    return;
  }

  const container = document.getElementById('map-el');
  if (!container || !window.L) return;

  container.style.height = '100%';
  container.style.width = '100%';

  try {
    mapInstance = L.map(container, { zoomControl: true }).setView([50, 10], 4);

    const isDark = AppState.theme === 'dark';
    L.tileLayer(isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '\u00A9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00A9 <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 18,
    }).addTo(mapInstance);

    updateMapMarkers();
    mapInitialized = true;
    setTimeout(() => mapInstance.invalidateSize(), 100);
  } catch (err) {
    console.error('Map init failed:', err);
    container.textContent = 'Map tiles failed to load. Check your network connection.';
  }
}

function updateMapMarkers() {
  if (!mapInstance) return;
  mapInstance.eachLayer(layer => {
    if (layer instanceof L.CircleMarker) mapInstance.removeLayer(layer);
  });

  const maxBurn = Math.max(...AppState.airports.map(a => a.daily_burn_ml));

  AppState.airports.forEach(a => {
    const days = getAirportCoverDays(a);
    const cls = getCoverDaysClass(days);
    const colorMap = { green: '#4ade80', amber: '#ffba3f', red: '#ffb4ab' };
    const radius = 6 + (a.daily_burn_ml / maxBurn) * 12;

    const marker = L.circleMarker([a.lat, a.lon], {
      radius, fillColor: colorMap[cls], color: 'rgba(255,255,255,0.4)',
      weight: 2, opacity: 1, fillOpacity: 0.8,
    }).addTo(mapInstance);

    marker.bindTooltip(
      `<strong>${esc(a.code)} \u2014 ${esc(a.name)}</strong><br>${days.toFixed(1)} days cover<br><span style="color:${colorMap[cls]}">${getCoverDaysRiskLabel(days)}</span>`,
      { direction: 'top', offset: [0, -radius] }
    );

    marker.on('click', () => openAirportDrawer(a));
  });
}

function openAirportDrawer(airport) {
  const days = getAirportCoverDays(airport);
  const cls = getCoverDaysClass(days);
  const colorVar = cls === 'green' ? '--c-low' : cls === 'amber' ? '--c-high' : '--c-critical';
  const depCls = airport.import_dependency === 'HIGH' ? 'critical' : airport.import_dependency === 'MED' ? 'high' : 'low';

  document.getElementById('drawer-airline-name').textContent = airport.name;
  document.getElementById('drawer-event-id').textContent = airport.code + ' \u00B7 ' + airport.city + ', ' + airport.country;

  const metaHTML = `
    <div>
      <div class="drawer-section-label">Fuel Supply Overview</div>
      <div class="drawer-meta-grid">
        <div class="drawer-meta-item"><span class="drawer-meta-key">Cover Days</span><span class="drawer-meta-val" style="color:var(${colorVar})">${days.toFixed(1)} days</span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Risk Level</span><span class="drawer-meta-val"><span class="badge ${depCls}" style="font-size:11px"><span class="badge-dot" aria-hidden="true"></span>${getCoverDaysRiskLabel(days)}</span></span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Daily Burn</span><span class="drawer-meta-val">${airport.daily_burn_ml.toFixed(1)} ML/day</span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Storage</span><span class="drawer-meta-val">${airport.storage_capacity_ml.toFixed(1)} ML</span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Import Dep.</span><span class="drawer-meta-val"><span class="badge ${depCls}" style="font-size:11px"><span class="badge-dot" aria-hidden="true"></span>${esc(airport.import_dependency)}</span></span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Location</span><span class="drawer-meta-val">${airport.lat.toFixed(2)}\u00B0N, ${Math.abs(airport.lon).toFixed(2)}\u00B0${airport.lon >= 0 ? 'E' : 'W'}</span></div>
      </div>
    </div>
    <div>
      <div class="drawer-section-label">Notes</div>
      <div class="drawer-ops-notes">${esc(airport.notes)}</div>
    </div>
    ${AppState.summerMode ? `<div>
      <div class="drawer-section-label">Summer Mode Active</div>
      <p class="drawer-summary">Demand multiplied by ${SUMMER_MULTIPLIER}x. Normal cover: ${airport.cover_days.toFixed(1)} days. Summer-adjusted: ${days.toFixed(1)} days.</p>
    </div>` : ''}`;

  safeHTML(document.getElementById('drawer-body'), metaHTML);

  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer-overlay').setAttribute('aria-hidden', 'false');
  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('detail-drawer').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => document.getElementById('drawer-close')?.focus());
}

/* ================================================================
   RENDER: ANALYTICS CHARTS
   ================================================================ */

function renderAnalyticsCharts() {
  renderAnalyticsFuelChart();
  renderRegionalChart();
  renderSeasonalityChart();
}

function renderAnalyticsFuelChart() {
  const prices = AppState.fuelPrices;
  if (!prices.length) return;
  const colors = cc();
  const ctx = document.getElementById('analytics-fuel-chart')?.getContext('2d');
  if (!ctx) return;
  if (analyticsFuelInst) analyticsFuelInst.destroy();

  analyticsFuelInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: prices.map(p => p.date),
      datasets: [{ label: 'Jet Fuel $/gal', data: prices.map(p => p.price), borderColor: colors.accent, backgroundColor: hexAlpha(colors.accent, 0.08), borderWidth: 2, pointRadius: 0, fill: true, tension: 0.35 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: colors.elevated, titleColor: colors.txt, bodyColor: colors.accent, borderColor: colors.grid, borderWidth: 1, padding: 10 } },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 }, maxTicksLimit: 10, maxRotation: 0 }, border: { display: false } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 }, callback: v => '$' + v.toFixed(2) }, border: { display: false } },
      },
    },
  });
}

function renderRegionalChart() {
  const colors = cc();
  const ctx = document.getElementById('regional-chart')?.getContext('2d');
  if (!ctx) return;
  if (regionalChartInst) regionalChartInst.destroy();

  const byRegion = {};
  for (const d of AppState.disruptions) byRegion[d.region] = (byRegion[d.region] || 0) + d.cancellations;
  const labels = Object.keys(byRegion).sort();
  const data = labels.map(r => byRegion[r]);
  const palette = [colors.accent, colors.critical, colors.high, colors.medium, colors.purple, colors.info];

  regionalChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Cancellations', data, backgroundColor: labels.map((_, i) => hexAlpha(palette[i % palette.length], 0.7)), borderColor: labels.map((_, i) => palette[i % palette.length]), borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { backgroundColor: colors.elevated, titleColor: colors.txt, bodyColor: colors.accent, borderColor: colors.grid, borderWidth: 1, padding: 10 } },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 } }, border: { display: false }, beginAtZero: true },
        y: { grid: { display: false }, ticks: { color: colors.txt, font: { family: "'Inter'", size: 11 } }, border: { display: false } },
      },
    },
  });
}

function renderSeasonalityChart() {
  const colors = cc();
  const ctx = document.getElementById('seasonality-chart')?.getContext('2d');
  if (!ctx) return;
  if (seasonalityChartInst) seasonalityChartInst.destroy();

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const demandIndex = [85, 82, 90, 95, 100, 118, 130, 135, 110, 95, 88, 80];
  const bgColors = demandIndex.map((_, i) => i >= 5 && i <= 7 ? hexAlpha(colors.high, 0.7) : hexAlpha(colors.accent, 0.4));

  seasonalityChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets: [{ label: 'Demand Index', data: demandIndex, backgroundColor: bgColors, borderColor: demandIndex.map((_, i) => i >= 5 && i <= 7 ? colors.high : colors.accent), borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: colors.elevated, titleColor: colors.txt, bodyColor: colors.accent, borderColor: colors.grid, borderWidth: 1, padding: 10, callbacks: { label: c => ' Index: ' + c.parsed.y } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 } }, border: { display: false } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.txt, font: { family: "'JetBrains Mono'", size: 10 } }, border: { display: false }, beginAtZero: true },
      },
    },
  });
}

/* ================================================================
   DETAIL DRAWER
   ================================================================ */

function openDrawer(eventId) {
  const ev = AppState.disruptions.find(d => d.id === eventId);
  if (!ev) return;
  AppState.selectedEventId = eventId;

  document.getElementById('drawer-airline-name').textContent = ev.airline || ev.summary || ev.id;
  document.getElementById('drawer-event-id').textContent = ev.id + (ev.region ? ' \u00B7 ' + ev.region : '');
  renderDrawerContent(ev);

  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer-overlay').setAttribute('aria-hidden', 'false');
  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('detail-drawer').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => document.getElementById('drawer-close')?.focus());
}

function closeDrawer() {
  AppState.selectedEventId = null;
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('drawer-overlay').setAttribute('aria-hidden', 'true');
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('detail-drawer').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  AppState._lastFocusedRow?.focus();
  AppState._lastFocusedRow = null;
}

function renderDrawerContent(ev) {
  const metaHTML = `
    <div>
      <div class="drawer-section-label">Overview</div>
      <div class="drawer-meta-grid">
        <div class="drawer-meta-item"><span class="drawer-meta-key">Event ID</span><span class="drawer-meta-val">${esc(ev.id)}</span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Region</span><span class="drawer-meta-val">${esc(ev.region)}</span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Cancellations</span><span class="drawer-meta-val">${ev.cancellations}</span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Severity</span><span class="drawer-meta-val"><span class="badge ${esc(ev.severity)}" style="font-size:11px"><span class="badge-dot" aria-hidden="true"></span>${esc(ev.severity)}</span></span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Impact</span><span class="drawer-meta-val"><span class="impact-badge impact-${esc(ev.impact_type)}" style="font-size:11px">${impactLabel(ev.impact_type)}</span></span></div>
        <div class="drawer-meta-item"><span class="drawer-meta-key">Updated</span><span class="drawer-meta-val" style="font-size:11px">${fmtDate(ev.updated_at)}</span></div>
      </div>
    </div>
    <div>
      <div class="drawer-section-label">Summary</div>
      <p class="drawer-summary">${esc(ev.summary)}</p>
    </div>
    <div>
      <div class="drawer-section-label">Affected Routes</div>
      <div class="drawer-routes">${ev.routes.map(r => `<span class="drawer-route-chip">${esc(r)}</span>`).join('')}</div>
      <div class="drawer-airports">${ev.airports.map(a => `<span class="drawer-airport">${esc(a)}</span>`).join('')}</div>
    </div>
    ${ev.operational_notes ? `<div>
      <div class="drawer-section-label">Operational Notes</div>
      <div class="drawer-ops-notes">${esc(ev.operational_notes)}</div>
    </div>` : ''}
    ${ev.timeline && ev.timeline.length ? `<div>
      <div class="drawer-section-label">Event Timeline</div>
      <div class="timeline" role="list">
        ${ev.timeline.map(t => `<div class="timeline-item" role="listitem">
            <div class="timeline-left" aria-hidden="true"><span class="timeline-dot"></span><span class="timeline-line"></span></div>
            <div><div class="timeline-date">${esc(t.date)}</div><div class="timeline-note">${esc(t.note)}</div></div>
          </div>`).join('')}
      </div>
    </div>` : ''}
    <div>
      <div class="drawer-section-label">Source</div>
      <a href="${esc(ev.source_url)}" target="_blank" rel="noopener noreferrer" class="drawer-source-link" aria-label="${esc(ev.source_name)} (opens new tab)">
        <span aria-hidden="true">\u2197</span>${esc(ev.source_name)}
      </a>
    </div>`;

  safeHTML(document.getElementById('drawer-body'), metaHTML);
}

/* ================================================================
   FILTERS & SORT
   ================================================================ */

function populateFilterOptions() {
  const airlines  = [...new Set(AppState.disruptions.map(d => d.airline).filter(Boolean))].sort();
  const regions   = [...new Set(AppState.disruptions.map(d => d.region).filter(Boolean))].sort();
  const countries = [...new Set(AppState.disruptions.map(d => d.country).filter(Boolean))].sort();
  const fill = (id, vals) => {
    const el = document.getElementById(id);
    if (!el) return;
    const first = el.options[0].outerHTML;
    safeHTML(el, first + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''));
  };
  fill('filter-airline', airlines);
  fill('filter-region', regions);
  fill('filter-country', countries);
}

function applyAndRender() {
  const rows = sortDisruptions(getFilteredDisruptions());
  renderKPIs(AppState.disruptions, AppState.fuelPrices, AppState.airports);
  renderTable(rows);
  renderTimelineChart(rows);
  renderDonutChart(rows);
  renderTable(sortDisruptions(getFilteredDisruptions()), 'table-body-full', 'table-count-full');
  renderAirportCards();
  if (mapInitialized) updateMapMarkers();
  updateSummerBanner();
}

function initFilters() {
  const map = { 'filter-airline': 'airline', 'filter-region': 'region', 'filter-country': 'country', 'filter-impact': 'impactType', 'filter-severity': 'severity' };
  Object.keys(map).forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      AppState.filters[map[id]] = e.target.value;
      applyAndRender();
    });
  });

  let searchTimer;
  document.getElementById('filter-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { AppState.filters.search = e.target.value; applyAndRender(); }, 200);
  });

  document.getElementById('filter-clear').addEventListener('click', () => {
    AppState.filters = { airline: '', region: '', country: '', impactType: '', severity: '', search: '' };
    ['filter-airline', 'filter-region', 'filter-country', 'filter-impact', 'filter-severity'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('filter-search').value = '';
    applyAndRender();
  });
}

function initTableSort() {
  document.querySelectorAll('thead th.sortable').forEach(th => {
    th.setAttribute('tabindex', '0');
    const activate = () => {
      const col = th.dataset.col;
      AppState.sort.col === col
        ? (AppState.sort.dir = AppState.sort.dir === 'asc' ? 'desc' : 'asc')
        : (AppState.sort.col = col, AppState.sort.dir = col === 'updated_at' ? 'desc' : 'asc');
      applyAndRender();
    };
    th.addEventListener('click', activate);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

function updateSortHeaders() {
  document.querySelectorAll('#disruptions-table thead th.sortable').forEach(th => {
    const active = th.dataset.col === AppState.sort.col;
    const icon = th.querySelector('.sort-icon');
    th.classList.remove('sort-asc', 'sort-desc');
    th.removeAttribute('aria-sort');
    if (active) {
      th.classList.add(AppState.sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      th.setAttribute('aria-sort', AppState.sort.dir === 'asc' ? 'ascending' : 'descending');
      if (icon) icon.textContent = AppState.sort.dir === 'asc' ? '\u2191' : '\u2193';
    } else {
      if (icon) icon.textContent = '\u2195';
    }
  });
}

/* ================================================================
   SUMMER TOGGLE (Issue #6)
   ================================================================ */

function initSummerToggle() {
  const toggle = document.getElementById('summer-toggle');
  const closeBtn = document.getElementById('summer-banner-close');

  // Auto-activate Jun-Aug
  const month = new Date().getMonth();
  if (month >= 5 && month <= 7) {
    AppState.summerMode = true;
    toggle.classList.add('active');
    toggle.setAttribute('aria-pressed', 'true');
  }

  toggle.addEventListener('click', () => {
    AppState.summerMode = !AppState.summerMode;
    AppState.bannerDismissed = false;
    toggle.classList.toggle('active', AppState.summerMode);
    toggle.setAttribute('aria-pressed', String(AppState.summerMode));
    applyAndRender();
  });

  closeBtn.addEventListener('click', () => {
    AppState.bannerDismissed = true;
    updateSummerBanner();
  });
}

function updateSummerBanner() {
  const banner = document.getElementById('summer-banner');
  banner.classList.toggle('hidden', !AppState.summerMode || AppState.bannerDismissed);
}

/* ================================================================
   THEME
   ================================================================ */

function initTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  AppState.theme = prefersDark ? 'dark' : 'light';
  applyTheme(AppState.theme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    AppState.theme = AppState.theme === 'dark' ? 'light' : 'dark';
    applyTheme(AppState.theme);
    if (mapInitialized && mapInstance) {
      mapInstance.remove();
      mapInstance = null;
      mapInitialized = false;
      if (AppState.currentView === 'map') renderMap();
    }
    renderFuelChart();
    applyAndRender();
    if (AppState.currentView === 'analytics') renderAnalyticsCharts();
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
}

/* ================================================================
   STATES
   ================================================================ */

function showLoading() {
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('dashboard').classList.add('hidden');
}
function showError(msg) {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('error-msg').textContent = msg || 'An unexpected error occurred.';
}
function showDashboard() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
}

/* ================================================================
   KEYBOARD / FOCUS TRAP (DRAWER)
   ================================================================ */

document.addEventListener('keydown', e => {
  const drawer = document.getElementById('detail-drawer');
  if (!drawer.classList.contains('open')) return;
  if (e.key === 'Escape') { closeDrawer(); return; }
  if (e.key === 'Tab') {
    const focusable = [...drawer.querySelectorAll('button,[href],input,select,[tabindex]:not([tabindex="-1"])')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
  }
});

document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('retry-btn').addEventListener('click', init);

/* ================================================================
   UTILITIES
   ================================================================ */

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function trunc(str, n) { return str && str.length > n ? str.slice(0, n - 1) + '\u2026' : (str || ''); }
function fmtDate(iso) {
  if (!iso) return '\u2014';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
         + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  } catch { return iso; }
}
function impactLabel(t) {
  return { cancellations: 'Cancellations', fare_increase: 'Fare Increase', schedule_cuts: 'Schedule Cuts', fuel_risk: 'Fuel Risk' }[t] || t;
}
function hexAlpha(hex, a) {
  if (!hex || hex.startsWith('var(') || hex.startsWith('rgb')) return hex;
  const h = hex.replace('#', '');
  const l = h.length === 3 ? 1 : 2;
  const r = parseInt(h.slice(0, l).padStart(2, h[0]), 16);
  const g = parseInt(h.slice(l, l * 2).padStart(2, h[l]), 16);
  const b = parseInt(h.slice(l * 2).padStart(2, h[l * 2]), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function updateTimestamp() {
  const now = new Date();
  const s = document.getElementById('header-ts-short');
  const f = document.getElementById('header-ts-full');
  if (s) s.textContent = 'Updated ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (f) f.textContent = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
}

/* ================================================================
   HASH ROUTING (Issue #3)
   ================================================================ */

const VIEW_TITLES = {
  overview:    'Fleet Overview',
  airports:    'Airport Inventory',
  map:         'Europe Risk Map',
  disruptions: 'Disruptions',
  analytics:   'Analytics',
};

function initRouting() {
  window.addEventListener('hashchange', () => navigateTo(location.hash));
}

function navigateTo(hash) {
  const view = (hash || '').replace('#', '') || 'overview';
  if (!VIEW_TITLES[view]) return;
  AppState.currentView = view;

  document.querySelectorAll('[data-view]').forEach(el => {
    el.classList.toggle('hidden', el.dataset.view !== view);
  });

  document.querySelectorAll('.nav-item[data-nav]').forEach(el => {
    const isActive = el.dataset.nav === view;
    el.classList.toggle('active', isActive);
    isActive ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');
  });

  const title = document.querySelector('.header-page-title');
  if (title) title.textContent = VIEW_TITLES[view];

  if (window._closeMobileNav) window._closeMobileNav();

  if (view === 'map') setTimeout(() => { renderMap(); if (mapInstance) mapInstance.invalidateSize(); }, 50);
  if (view === 'analytics') setTimeout(renderAnalyticsCharts, 50);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================================================================
   MOBILE NAV
   ================================================================ */

function initMobileNav() {
  const toggle  = document.getElementById('nav-toggle');
  const sideNav = document.getElementById('side-nav');
  const overlay = document.getElementById('nav-overlay');

  function openNav() {
    sideNav.classList.add('open'); overlay.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true'); overlay.removeAttribute('aria-hidden');
  }
  function closeNav() {
    sideNav.classList.remove('open'); overlay.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false'); overlay.setAttribute('aria-hidden', 'true');
  }

  toggle.addEventListener('click', () => sideNav.classList.contains('open') ? closeNav() : openNav());
  overlay.addEventListener('click', closeNav);
  window._closeMobileNav = closeNav;
}

function initNav() {
  document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      location.hash = '#' + item.dataset.nav;
    });
  });

  // Sidebar collapse toggle (desktop only)
  const collapseBtn = document.getElementById('nav-collapse');
  const sideNav = document.getElementById('side-nav');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      sideNav.classList.toggle('collapsed');
      // Invalidate map size if visible
      if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 350);
    });
  }
}

/* ================================================================
   INFO POPOVER
   ================================================================ */

function initInfoPopover() {
  const btn = document.getElementById('info-btn');
  const popover = document.getElementById('info-popover');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    popover.classList.toggle('open');
  });

  document.addEventListener('click', e => {
    if (!btn.contains(e.target)) popover.classList.remove('open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') popover.classList.remove('open');
  });
}

/* ================================================================
   INIT
   ================================================================ */

async function init() {
  showLoading();
  initTheme();
  initMobileNav();
  initNav();
  initRouting();
  initSummerToggle();
  initInfoPopover();

  try {
    const [disruptions, fuelPrices, airports] = await Promise.all([
      fetchDisruptionEvents(),
      fetchFuelPrices(),
      fetchAirports(),
    ]);
    AppState.disruptions = disruptions;
    AppState.fuelPrices  = fuelPrices;
    AppState.airports    = airports;

    populateFilterOptions();
    initFilters();
    initTableSort();
    showDashboard();
    renderFuelChart();
    applyAndRender();
    updateTimestamp();
    setInterval(updateTimestamp, 60000);
    navigateTo(location.hash);
  } catch (err) {
    console.error('FuelWatch init error:', err);
    showError(err.message || 'Failed to load dashboard data. Please retry.');
  }
}

document.addEventListener('DOMContentLoaded', init);
