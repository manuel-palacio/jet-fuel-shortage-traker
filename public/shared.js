'use strict';

window.EFC = (function () {
  const _modes = {};
  let _currentModeId = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

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

  function escapeHTML(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

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
    // plugin: {
    //   id, label, icon, defaultView,
    //   views: [{ id, label, icon, render }],
    //   filters: { html, init },
    //   init(),                    // called once on first activation
    //   onThemeChange?(theme),     // optional: re-render mode visuals on dark/light swap
    //   onSidebarChange?(collapsed) // optional: react to desktop sidebar collapse
    // }
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

    // Legacy bookmark compat: #overview -> #energy/overview
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
      return; // setMode -> routeTo -> hashchange re-fires
    }

    const mode = _modes[modeId];
    const view = mode.views.find(function (v) { return v.id === viewId; })
      || mode.views.find(function (v) { return v.id === mode.defaultView; });
    if (view && typeof view.render === 'function') view.render();
    _highlightActiveNav(view ? view.id : null);
    _setHeaderTitle(view ? view.label : '');
    _closeMobileNav();
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

  /* ---- Theme + sidebar collapse + info popover ----
     Pure infrastructure. The active mode plugin can opt in to
     reactive re-renders by implementing onThemeChange(theme) and
     onSidebarChange(collapsed) on its registration object.
  */

  function initTheme() {
    const KEY = 'efc.theme';
    const root = document.documentElement;
    const btn = $('#theme-toggle');
    const icon = $('#theme-icon');
    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    apply(stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    if (btn) btn.addEventListener('click', function () {
      apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    function apply(theme) {
      root.setAttribute('data-theme', theme);
      if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
      try { localStorage.setItem(KEY, theme); } catch (e) {}
      const mode = currentMode();
      if (mode && typeof mode.onThemeChange === 'function') {
        try { mode.onThemeChange(theme); } catch (e) { console.error(e); }
      }
    }
  }

  function initSidebar() {
    const KEY = 'efc.sidebarCollapsed';
    const sideNav = $('#side-nav');
    const overlay = $('#nav-overlay');
    const collapseBtn = $('#nav-collapse');
    const mobileToggle = $('#nav-toggle');

    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    if (stored === '1' && sideNav) sideNav.classList.add('collapsed');

    if (collapseBtn && sideNav) collapseBtn.addEventListener('click', function () {
      const collapsed = sideNav.classList.toggle('collapsed');
      try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) {}
      const mode = currentMode();
      if (mode && typeof mode.onSidebarChange === 'function') {
        try { mode.onSidebarChange(collapsed); } catch (e) { console.error(e); }
      }
    });

    if (mobileToggle && sideNav && overlay) {
      mobileToggle.addEventListener('click', function () {
        const isOpen = sideNav.classList.contains('open');
        sideNav.classList.toggle('open', !isOpen);
        overlay.classList.toggle('open', !isOpen);
        mobileToggle.setAttribute('aria-expanded', String(!isOpen));
        if (isOpen) overlay.setAttribute('aria-hidden', 'true');
        else overlay.removeAttribute('aria-hidden');
      });
      overlay.addEventListener('click', _closeMobileNav);
    }
  }

  function _closeMobileNav() {
    const sideNav = $('#side-nav');
    const overlay = $('#nav-overlay');
    const toggle = $('#nav-toggle');
    if (!sideNav || !sideNav.classList.contains('open')) return;
    sideNav.classList.remove('open');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

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
