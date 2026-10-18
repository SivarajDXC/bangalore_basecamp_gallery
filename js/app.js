/* Event Moments – photo album
 * Plain JavaScript, no frameworks. Reads manifest.json and serves images from /images.
 * Admin mode (password-protected) assigns photos to days/categories and exports an updated
 * manifest.json, which is committed to the repository (GitHub Pages is static).
 */
(() => {
  'use strict';

  const MANIFEST_URL = 'manifest.json';
  const DEFAULT_CATEGORIES = ['General', 'Session'];

  // Admin password check: SHA-256 of (SALT + password). The plaintext is not stored in the page.
  // Note: this is a client-side gate only; anyone with the source can bypass it.
  const ADMIN_SALT = 'DXC-Bangalore-Basecamp-2026';
  const ADMIN_HASH = '325e8803925a4e96ffb9879217b940f366379a012465be99db1299a8f40b1b95';

  const $ = (sel) => document.querySelector(sel);

  const ui = {
    sidebar: $('#sidebar'),
    backdrop: $('#backdrop'),
    menuBtn: $('#menuBtn'),
    brandName: $('#brandName'),
    brandSub: $('#brandSub'),
    sidebarFooter: $('#sidebarFooter'),
    nav: $('#nav'),
    dayNav: $('#dayNav'),
    countAll: $('#countAll'),
    countUnassigned: $('#countUnassigned'),
    unassignedNav: $('.nav-item[data-view="unassigned"]'),
    library: $('#library'),
    eyebrow: $('#eyebrow'),
    pageTitle: $('#pageTitle'),
    countLine: $('#countLine'),
    themeBtn: $('#themeBtn'),
    refreshBtn: $('#refreshBtn'),
    adminLoginBtn: $('#adminLoginBtn'),
    adminExitBtn: $('#adminExitBtn'),
    statsRow: $('#statsRow'),
    statTotal: $('#statTotal'),
    statAssigned: $('#statAssigned'),
    statUnassigned: $('#statUnassigned'),
    statChanged: $('#statChanged'),
    adminBar: $('#adminBar'),
    adminDiscard: $('#adminDiscard'),
    adminExport: $('#adminExport'),
    loading: $('#loading'),
    errorBox: $('#errorBox'),
    selectionBar: $('#selectionBar'),
    selCount: $('#selCount'),
    selAll: $('#selAll'),
    selClear: $('#selClear'),
    downloadBtn: $('#downloadBtn'),
    grid: $('#grid'),
    empty: $('#empty'),
    lightbox: $('#lightbox'),
    lbImg: $('#lbImg'),
    lbCounter: $('#lbCounter'),
    lbDownload: $('#lbDownload'),
    lbClose: $('#lbClose'),
    lbPrev: $('#lbPrev'),
    lbNext: $('#lbNext'),
    loginModal: $('#loginModal'),
    loginForm: $('#loginForm'),
    adminPassword: $('#adminPassword'),
    loginError: $('#loginError'),
    loginCancel: $('#loginCancel'),
    toast: $('#toast'),
  };

  const state = {
    raw: null,              // manifest exactly as loaded (used when exporting)
    event: {},
    days: [],               // [{ id, label, date }]
    categories: DEFAULT_CATEGORIES,
    photos: [],             // [{ file, title, day, category, raw }]
    mode: 'viewer',         // 'viewer' | 'admin'
    view: { type: 'all' },  // {type:'all'} | {type:'unassigned'} | {type:'day', day} | {type:'cat', day, category}
    selected: new Set(),    // file paths
    visible: [],            // photos currently in the grid (lightbox uses this)
    lightboxIndex: -1,
    edits: new Map(),       // admin: file -> { day, category } (unsaved)
  };

  /* ---------- Helpers ---------- */

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const fileName = (path) => path.split('/').pop();

  const prettyName = (path) =>
    fileName(path)
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photos';

  const dayById = (id) => state.days.find((d) => d.id === id);
  const dayIndex = (id) => state.days.findIndex((d) => d.id === id);

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { ui.toast.hidden = true; }, 3200);
  }

  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Theme ---------- */

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const toDark = theme !== 'dark';
    ui.themeBtn.setAttribute('aria-label', toDark ? 'Switch to dark theme' : 'Switch to light theme');
    ui.themeBtn.title = toDark ? 'Dark theme' : 'Light theme';
    try { localStorage.setItem('em-theme', theme); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- Data ---------- */

  function normalise(data) {
    if (!data || !Array.isArray(data.days) || !Array.isArray(data.photos)) {
      throw new Error('manifest.json must contain "days" and "photos" arrays.');
    }
    state.raw = data;
    state.event = data.event || {};
    state.categories = Array.isArray(data.categories) && data.categories.length
      ? data.categories.map(String)
      : DEFAULT_CATEGORIES;
    state.days = data.days.map((d) => ({
      id: String(d.id),
      label: d.label || String(d.id),
      date: d.date || '',
    }));
    state.photos = data.photos
      .filter((p) => p && p.file)
      .map((p) => {
        const day = state.days.some((d) => d.id === p.day) ? p.day : null;
        let category = null;
        if (day) {
          category = state.categories.includes(p.category) ? p.category : state.categories[0];
        }
        return {
          file: String(p.file),
          title: p.title || prettyName(p.file),
          day,
          category,
          raw: p,
        };
      });
  }

  async function loadManifest(fromRefresh) {
    ui.loading.hidden = false;
    ui.errorBox.hidden = true;
    try {
      const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest.json could not be loaded (HTTP ${res.status}).`);
      normalise(await res.json());
      state.edits.clear();
      state.selected = new Set(
        [...state.selected].filter((f) => state.photos.some((p) => p.file === f))
      );
      ui.loading.hidden = true;
      ui.library.hidden = false;
      render();
      if (fromRefresh) showToast('Photographs refreshed');
    } catch (err) {
      ui.loading.hidden = true;
      ui.errorBox.hidden = false;
      ui.errorBox.textContent =
        `Could not load photographs. ${err.message} ` +
        'Make sure manifest.json is in the site root and the site is opened over http(s), not as a local file.';
    }
  }

  function effective(p) {
    return state.edits.get(p.file) || { day: p.day, category: p.category };
  }

  function isChanged(p) {
    const e = state.edits.get(p.file);
    return !!e && (e.day !== p.day || e.category !== p.category);
  }

  function pendingCount() {
    return state.photos.filter(isChanged).length;
  }

  function countFor(dayId, category) {
    return state.photos.filter(
      (p) => p.day === dayId && (category == null || p.category === category)
    ).length;
  }

  function matchesView(p) {
    const v = state.view;
    if (v.type === 'unassigned') return !effective(p).day;
    if (v.type === 'day') return effective(p).day === v.day;
    if (v.type === 'cat') {
      const e = effective(p);
      return e.day === v.day && e.category === v.category;
    }
    return true;
  }

  function getVisiblePhotos() {
    return state.photos
      .filter(matchesView)
      .sort((a, b) =>
        fileName(a.file).localeCompare(fileName(b.file), undefined, { numeric: true, sensitivity: 'base' }));
  }

  function viewInfo() {
    const v = state.view;
    if (v.type === 'unassigned') return { title: 'Unassigned' };
    if (v.type === 'day') {
      const d = dayById(v.day);
      if (d) return { title: `${d.label} · ${d.date}` };
    }
    if (v.type === 'cat') {
      const d = dayById(v.day);
      if (d) return { title: `${d.label} · ${v.category}` };
    }
    return { title: 'All photographs' };
  }

  /* ---------- Rendering ---------- */

  function render() {
    renderBrand();
    renderNav();

    const admin = state.mode === 'admin';
    document.body.classList.toggle('is-admin', admin);
    ui.statsRow.hidden = !admin;
    ui.adminBar.hidden = !admin;
    ui.unassignedNav.hidden = !admin;
    ui.adminLoginBtn.hidden = admin;
    ui.adminExitBtn.hidden = !admin;
    ui.eyebrow.textContent = admin ? 'Admin · Event photo library' : 'Event photo library';

    if (admin) renderStats();
    renderLibrary();
  }

  function renderBrand() {
    const title = state.event.title || 'Event Moments';
    const sub = state.event.subtitle || 'Photo album';
    ui.brandName.textContent = title;
    ui.brandSub.textContent = sub;
    ui.sidebarFooter.textContent = state.event.footer || 'Three days. Every moment.';
    document.title = `${title} · ${sub}`;
  }

  function renderStats() {
    const unassigned = state.photos.filter((p) => !effective(p).day).length;
    ui.statTotal.textContent = state.photos.length;
    ui.statAssigned.textContent = state.photos.length - unassigned;
    ui.statUnassigned.textContent = unassigned;
    ui.statChanged.textContent = pendingCount();
    ui.adminDiscard.disabled = pendingCount() === 0;
    ui.countUnassigned.textContent = unassigned;
  }

  function renderNav() {
    ui.countAll.textContent = state.photos.length;
    ui.countUnassigned.textContent = state.photos.filter((p) => !effective(p).day).length;
    ui.dayNav.innerHTML = state.days
      .map((d) => `
        <div class="day-group">
          <button type="button" class="nav-item day-label" data-view="day" data-day="${esc(d.id)}">
            <span>${esc(d.label)} · ${esc(d.date)}</span>
            <span class="count">${state.photos.filter((p) => matchesDayOnly(p, d.id)).length}</span>
          </button>
          ${state.categories
            .map((c) => `
              <button type="button" class="nav-item sub" data-view="cat" data-day="${esc(d.id)}" data-category="${esc(c)}">
                <span>${esc(c)}</span>
                <span class="count">${countFor(d.id, c)}</span>
              </button>`)
            .join('')}
        </div>`)
      .join('');
    markActiveNav();
  }

  function matchesDayOnly(p, dayId) {
    return effective(p).day === dayId;
  }

  function markActiveNav() {
    const v = state.view;
    ui.nav.querySelectorAll('.nav-item').forEach((btn) => {
      let active = false;
      if (v.type === 'all') active = btn.dataset.view === 'all';
      else if (v.type === 'unassigned') active = btn.dataset.view === 'unassigned';
      else if (v.type === 'day') active = btn.dataset.view === 'day' && btn.dataset.day === v.day;
      else active = btn.dataset.view === 'cat' && btn.dataset.day === v.day && btn.dataset.category === v.category;
      btn.classList.toggle('active', active);
    });
  }

  function assignHtml(p) {
    const e = effective(p);
    const dayOptions = [`<option value="">Unassigned</option>`]
      .concat(state.days.map((d) =>
        `<option value="${esc(d.id)}"${d.id === e.day ? ' selected' : ''}>${esc(d.label)}</option>`))
      .join('');
    const catOptions = state.categories
      .map((c) => `<option value="${esc(c)}"${c === e.category ? ' selected' : ''}>${esc(c)}</option>`)
      .join('');
    return `
      <div class="assign">
        <select data-field="day" aria-label="Day">${dayOptions}</select>
        <select data-field="category" aria-label="Category"${e.day ? '' : ' disabled'}>${catOptions}</select>
      </div>`;
  }

  function tileHtml(p, i) {
    const admin = state.mode === 'admin';
    const selected = state.selected.has(p.file);
    const changed = admin && isChanged(p);
    const unassigned = admin && !effective(p).day;
    return `
      <div class="tile${selected ? ' selected' : ''}${changed ? ' changed' : ''}" role="button" tabindex="0"
           data-index="${i}" data-file="${esc(p.file)}" aria-label="Open photograph">
        <img src="${esc(p.file)}" alt="Event photograph" loading="lazy" decoding="async">
        <span class="missing-label">Image not found</span>
        <button type="button" class="tile-check" aria-label="Select photograph" aria-pressed="${selected}">✓</button>
        ${unassigned ? '<span class="tag-unassigned">Unassigned</span>' : ''}
        ${admin ? assignHtml(p) : ''}
      </div>`;
  }

  function renderLibrary() {
    const info = viewInfo();
    ui.pageTitle.textContent = info.title;

    state.visible = getVisiblePhotos();
    ui.grid.innerHTML = state.visible.map(tileHtml).join('');
    ui.empty.hidden = state.visible.length > 0;
    ui.countLine.textContent = plural(state.visible.length, 'image');
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const n = state.selected.size;
    ui.selectionBar.hidden = n === 0;
    ui.selCount.textContent = `${n} selected`;
    ui.downloadBtn.textContent = n > 1 ? `Download ZIP (${n})` : 'Download';
    ui.grid.querySelectorAll('.tile').forEach((tile) => {
      const on = state.selected.has(tile.dataset.file);
      tile.classList.toggle('selected', on);
      tile.querySelector('.tile-check').setAttribute('aria-pressed', String(on));
    });
  }

  function toggleSelect(file) {
    if (state.selected.has(file)) state.selected.delete(file);
    else state.selected.add(file);
    updateSelectionUI();
  }

  /* ---------- Downloads ---------- */

  let downloading = false;

  async function fetchBytes(file) {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`${fileName(file)} (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  function uniqueName(name, used) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    let i = 2;
    while (used.has(candidate)) candidate = `${base}-${i++}${ext}`;
    used.add(candidate);
    return candidate;
  }

  async function downloadSelected() {
    if (downloading || state.selected.size === 0) return;
    const files = [...state.selected];
    downloading = true;
    ui.downloadBtn.disabled = true;
    try {
      if (files.length === 1) {
        const bytes = await fetchBytes(files[0]);
        triggerDownload(new Blob([bytes]), fileName(files[0]));
      } else {
        const used = new Set();
        const entries = [];
        for (let i = 0; i < files.length; i++) {
          ui.downloadBtn.textContent = `Preparing ${i + 1} of ${files.length}…`;
          entries.push({ name: uniqueName(fileName(files[i]), used), data: await fetchBytes(files[i]) });
        }
        triggerDownload(buildZip(entries), `${slug(state.event.title || 'photos')}-photos.zip`);
      }
    } catch (err) {
      showToast(`Download failed: ${err.message}`);
    } finally {
      downloading = false;
      ui.downloadBtn.disabled = false;
      updateSelectionUI();
    }
  }

  /* Minimal ZIP writer (store method) – JPEG/PNG files are already compressed. */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function buildZip(entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const parts = [];
    const central = [];
    let offset = 0;

    entries.forEach((e) => {
      const nameBytes = enc.encode(e.name);
      const crc = crc32(e.data);
      const size = e.data.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 file names
      local.setUint16(8, 0, true);      // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, e.data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    });

    const centralSize = central.reduce((sum, b) => sum + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  /* ---------- Lightbox ---------- */

  function openLightbox(index) {
    if (!state.visible[index]) return;
    state.lightboxIndex = index;
    ui.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    showLightboxPhoto();
    ui.lbClose.focus();
  }

  function closeLightbox() {
    ui.lightbox.hidden = true;
    document.body.style.overflow = '';
    state.lightboxIndex = -1;
  }

  function stepLightbox(delta) {
    const n = state.visible.length;
    if (!n) return;
    state.lightboxIndex = (state.lightboxIndex + delta + n) % n;
    showLightboxPhoto();
  }

  function showLightboxPhoto() {
    const p = state.visible[state.lightboxIndex];
    if (!p) return;
    ui.lbImg.src = p.file;
    ui.lbCounter.textContent = `${state.lightboxIndex + 1} / ${state.visible.length}`;
    ui.lbDownload.href = p.file;
    ui.lbDownload.download = fileName(p.file);
    const multiple = state.visible.length > 1;
    ui.lbPrev.hidden = !multiple;
    ui.lbNext.hidden = !multiple;
  }

  /* ---------- Admin ---------- */

  async function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Secure browsing (https or localhost) is required for admin login.');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function openLoginModal() {
    ui.loginError.hidden = true;
    ui.adminPassword.value = '';
    ui.loginModal.hidden = false;
    ui.adminPassword.focus();
  }

  function closeLoginModal() {
    ui.loginModal.hidden = true;
    ui.adminPassword.value = '';
  }

  async function handleLogin(e) {
    e.preventDefault();
    const submit = ui.loginForm.querySelector('#loginSubmit');
    submit.disabled = true;
    try {
      const hash = await sha256Hex(ADMIN_SALT + ui.adminPassword.value);
      if (hash === ADMIN_HASH) {
        closeLoginModal();
        state.mode = 'admin';
        state.view = { type: 'all' };
        render();
        showToast('Admin mode unlocked');
      } else {
        ui.loginError.textContent = 'Incorrect password. Please try again.';
        ui.loginError.hidden = false;
        ui.adminPassword.select();
      }
    } catch (err) {
      ui.loginError.textContent = err.message;
      ui.loginError.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function exitAdmin() {
    if (pendingCount() > 0 &&
        !window.confirm('Leave admin mode and discard unsaved assignment changes?')) {
      return;
    }
    state.edits.clear();
    state.mode = 'viewer';
    render();
    showToast('Left admin mode');
  }

  function exportManifest() {
    const out = {
      ...state.raw,
      photos: state.photos.map((p) => {
        const e = effective(p);
        return { ...p.raw, day: e.day, category: e.day ? e.category : null };
      }),
    };
    triggerDownload(
      new Blob([JSON.stringify(out, null, 2) + '\n'], { type: 'application/json' }),
      'manifest.json'
    );
    showToast('manifest.json exported. Commit it to the repository to publish the changes.');
  }

  /* ---------- Sidebar drawer (mobile) ---------- */

  function setDrawer(open) {
    ui.sidebar.classList.toggle('open', open);
    ui.backdrop.hidden = !open;
    ui.menuBtn.setAttribute('aria-expanded', String(open));
  }

  /* ---------- Events ---------- */

  ui.nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    const type = btn.dataset.view;
    if (type === 'all') state.view = { type: 'all' };
    else if (type === 'unassigned') state.view = { type: 'unassigned' };
    else if (type === 'day') state.view = { type: 'day', day: btn.dataset.day };
    else state.view = { type: 'cat', day: btn.dataset.day, category: btn.dataset.category };
    setDrawer(false);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  ui.themeBtn.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));

  ui.refreshBtn.addEventListener('click', () => {
    if (state.mode === 'admin' && pendingCount() > 0 &&
        !window.confirm('Discard unsaved assignment changes and reload the manifest?')) {
      return;
    }
    loadManifest(true);
  });

  ui.adminLoginBtn.addEventListener('click', openLoginModal);
  ui.adminExitBtn.addEventListener('click', exitAdmin);
  ui.loginCancel.addEventListener('click', closeLoginModal);
  ui.loginModal.addEventListener('click', (e) => {
    if (e.target === ui.loginModal) closeLoginModal();
  });
  ui.loginForm.addEventListener('submit', handleLogin);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ui.loginModal.hidden) closeLoginModal();
  });

  ui.menuBtn.addEventListener('click', () => setDrawer(!ui.sidebar.classList.contains('open')));
  ui.backdrop.addEventListener('click', () => setDrawer(false));

  ui.grid.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (e.target.closest('.assign')) return;          // admin controls handled by 'change'
    if (e.target.closest('.tile-check')) {
      toggleSelect(tile.dataset.file);
    } else {
      openLightbox(Number(tile.dataset.index));
    }
  });

  ui.grid.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tile')) {
      e.preventDefault();
      openLightbox(Number(e.target.dataset.index));
    }
  });

  // Admin: change day/category on a tile
  ui.grid.addEventListener('change', (e) => {
    const select = e.target.closest('select[data-field]');
    if (!select) return;
    const tile = select.closest('.tile');
    const p = state.photos.find((x) => x.file === tile.dataset.file);
    if (!p) return;

    const current = effective(p);
    let next;
    if (select.dataset.field === 'day') {
      next = select.value
        ? { day: select.value, category: current.category || state.categories[0] }
        : { day: null, category: null };
    } else {
      next = { day: current.day, category: select.value };
    }

    if (next.day === p.day && next.category === p.category) state.edits.delete(p.file);
    else state.edits.set(p.file, next);
    renderStats();
    renderNav();
    renderLibrary();
  });

  // Image load failures do not bubble, so listen in the capture phase.
  ui.grid.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.closest('.tile')?.classList.add('missing');
  }, true);

  ui.selAll.addEventListener('click', () => {
    state.visible.forEach((p) => state.selected.add(p.file));
    updateSelectionUI();
  });
  ui.selClear.addEventListener('click', () => {
    state.selected.clear();
    updateSelectionUI();
  });
  ui.downloadBtn.addEventListener('click', downloadSelected);

  ui.adminDiscard.addEventListener('click', () => {
    state.edits.clear();
    render();
    showToast('Changes discarded');
  });
  ui.adminExport.addEventListener('click', exportManifest);

  ui.lbClose.addEventListener('click', closeLightbox);
  ui.lbPrev.addEventListener('click', () => stepLightbox(-1));
  ui.lbNext.addEventListener('click', () => stepLightbox(1));
  ui.lightbox.addEventListener('click', (e) => {
    if (e.target === ui.lightbox || e.target.classList.contains('lb-stage')) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (ui.lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft') stepLightbox(-1);
    else if (e.key === 'ArrowRight') stepLightbox(1);
  });

  /* ---------- Start ---------- */

  applyTheme(currentTheme());
  loadManifest(false);
})();
