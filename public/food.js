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
      latestPrice:   latest ? latest.price : null,
      latestDate:    latest ? latest.date  : '',
      mom:           mom,
      eventCount:    events.length,
      criticalCount: critical,
      topCountry:    topCountry
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
      ['#food-filter-commodity',  'commodity'],
      ['#food-filter-region',     'region'],
      ['#food-filter-country',    'country'],
      ['#food-filter-event-type', 'event_type'],
      ['#food-filter-severity',   'severity'],
      ['#food-filter-search',     'search']
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
    rerender();
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
