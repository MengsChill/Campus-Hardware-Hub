/* ============================================================
   Campus Hardware Lending System – App Shell & Shared Helpers
   Every signed-in page loads: auth.js → app.js → its page script.
   Pages call App.ready(user => { ... }) to start once the session
   has been verified and the sidebar/topbar have been drawn.
   ============================================================ */

const App = (() => {
  let currentUser = null;

  /* ── Navigation ─────────────────────────────────── */
  const NAV = {
    student: [
      { section: 'Main' },
      { page: 'dashboard',     icon: 'fa-gauge-high',        label: 'Dashboard' },
      { page: 'catalog',       icon: 'fa-magnifying-glass',  label: 'Browse Hardware' },
      { section: 'Lending' },
      { page: 'my-tools',      icon: 'fa-toolbox',           label: 'My Listings' },
      { page: 'requests',      icon: 'fa-inbox',             label: 'Lending Requests', badge: 'incoming' },
      { section: 'Borrowing' },
      { page: 'my-loans',      icon: 'fa-calendar-check',    label: 'My Bookings', badge: 'myLoans' },
      { page: 'history',       icon: 'fa-clock-rotate-left', label: 'History & Reviews' },
      { section: 'Account' },
      { page: 'disputes',      icon: 'fa-scale-balanced',    label: 'Disputes', badge: 'disputes' },
      { page: 'notifications', icon: 'fa-bell',              label: 'Notifications', badge: 'unread' },
      { page: 'profile',       icon: 'fa-user',              label: 'My Profile' },
    ],
    admin: [
      { section: 'Main' },
      { page: 'dashboard',     icon: 'fa-gauge-high',        label: 'Dashboard' },
      { page: 'catalog',       icon: 'fa-magnifying-glass',  label: 'Browse Hardware' },
      { section: 'Admin' },
      { page: 'manage-users',  icon: 'fa-users',             label: 'Manage Users', badge: 'flagged' },
      { page: 'manage-tools',  icon: 'fa-screwdriver-wrench', label: 'Manage Listings' },
      { page: 'bookings',      icon: 'fa-calendar-check',    label: 'All Bookings' },
      { page: 'disputes',      icon: 'fa-scale-balanced',    label: 'Disputes', badge: 'disputes' },
      { page: 'reports',       icon: 'fa-chart-column',      label: 'Reports' },
      { section: 'Account' },
      { page: 'notifications', icon: 'fa-bell',              label: 'Notifications', badge: 'unread' },
      { page: 'profile',       icon: 'fa-user',              label: 'My Profile' },
    ],
  };

  // Pages shown as quick-switch tabs in the top header.
  // Short labels keep the strip on one line; the full name shows on hover.
  const QUICK = {
    student: ['dashboard', 'catalog', 'my-loans', 'my-tools', 'requests', 'notifications'],
    admin:   ['dashboard', 'catalog', 'manage-users', 'manage-tools', 'bookings', 'disputes', 'reports'],
  };
  const QUICK_LABEL = {
    catalog: 'Browse', 'my-loans': 'Bookings', 'my-tools': 'Listings', requests: 'Requests',
    notifications: 'Alerts', 'manage-users': 'Users', 'manage-tools': 'Listings', bookings: 'Bookings',
  };

  /* ── Formatting helpers ─────────────────────────── */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ESC[ch]);

  // 'YYYY-MM-DD' = calendar date; 'YYYY-MM-DD HH:MM' = local time typed by a user; SQLite datetime('now') = UTC.
  function toDate(value, utc = true) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T00:00:00');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return new Date(value.replace(' ', 'T'));   // handover times
    const s = String(value).replace(' ', 'T');
    return new Date(utc && !/Z|[+-]\d\d:?\d\d$/.test(s) ? s + 'Z' : s);
  }
  const fmtDate = value => {
    const d = toDate(value);
    return d ? d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  };
  const fmtDateTime = value => {
    const d = toDate(value);
    return d ? d.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  };
  const fmtHandover = value => {
    const d = toDate(value);
    return d ? d.toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
  };
  function timeAgo(value) {
    const d = toDate(value);
    if (!d) return '';
    const secs = Math.round((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'Just now';
    if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
    if (secs < 7 * 86400) return `${Math.floor(secs / 86400)} day${secs < 172800 ? '' : 's'} ago`;
    return fmtDate(value);
  }
  const todayStr = () => new Date().toLocaleDateString('en-CA');
  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA');
  }
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const money = sen => `RM ${(Number(sen || 0) / 100).toFixed(2)}`;

  /* ── Small UI builders ──────────────────────────── */
  const CATEGORY_ICON = {
    electrical: 'fa-plug', mechanical: 'fa-screwdriver-wrench', measuring: 'fa-ruler-combined',
    computing: 'fa-microchip', others: 'fa-box-open',
  };
  function toolImage(url, opts = {}) {
    if (url) return `<img src="${esc(url)}" alt="${esc(opts.alt || 'Hardware photo')}" loading="lazy" />`;
    const icon = CATEGORY_ICON[opts.category];
    return `<div class="img-placeholder ${opts.small ? 'sm' : ''} ${icon ? 'cat-' + esc(opts.category) : ''}">
      <i class="${icon ? 'fa-solid ' + icon : 'fa-regular fa-image'}" aria-hidden="true"></i><span>No photo yet</span></div>`;
  }

  function avatar(person, size = '') {
    const content = person?.avatar ? `<img src="${esc(person.avatar)}" alt="" />` : esc(initials(person?.name || person?.fullName));
    return `<div class="avatar ${size}">${content}</div>`;
  }

  function stars(rating, { count, size = '' } = {}) {
    if (rating == null) return `<span class="stars muted ${size}">No ratings yet</span>`;
    const full = Math.round(rating);
    const icons = Array.from({ length: 5 }, (_, i) => `<i class="fa-${i < full ? 'solid' : 'regular'} fa-star"></i>`).join('');
    return `<span class="stars ${size}" aria-label="${rating} out of 5">${icons} <b>${Number(rating).toFixed(1)}</b>${count != null ? ` <small>(${count})</small>` : ''}</span>`;
  }

  function trustBadge(points) {
    const cls = points < 50 ? 'badge-red' : points < 80 ? 'badge-orange' : 'badge-green';
    return `<span class="badge ${cls}" title="Trust Points"><i class="fa-solid fa-shield-heart"></i> ${points} TP</span>`;
  }

  const STATUS = {
    awaiting_payment: ['badge-orange', 'Awaiting payment'],
    pending:          ['badge-orange', 'Paid · awaiting response'],
    confirmed:        ['badge-blue',   'Confirmed · PIN issued'],
    active:           ['badge-blue',   'Item handed over'],
    overdue:          ['badge-red',    'Overdue'],
    return_pending:   ['badge-purple', 'Returned · pending inspection'],
    disputed:         ['badge-red',    'Disputed'],
    completed:        ['badge-green',  'Completed'],
    cancelled:        ['badge-gray',   'Cancelled'],
    declined:         ['badge-gray',   'Declined'],
    voided:           ['badge-gray',   'Voided'],
  };
  const SHORT = { pending: 'Pending', confirmed: 'Confirmed', active: 'On loan', return_pending: 'Inspecting', awaiting_payment: 'Unpaid' };
  const statusLabel = status => (STATUS[status] || ['', status])[1];
  function statusBadge(status, short) {
    const [cls, label] = STATUS[status] || ['badge-gray', status];
    return `<span class="badge ${cls}">${short && SHORT[status] ? SHORT[status] : label}</span>`;
  }

  function availabilityBadge(tool) {
    const map = {
      available:   ['badge-green',  'Available'],
      on_loan:     ['badge-orange', tool.onLoanUntil ? `On loan until ${fmtDate(tool.onLoanUntil)}` : 'On loan'],
      maintenance: ['badge-gray',   'Under maintenance'],
      removed:     ['badge-red',    'Removed'],
    };
    const [cls, label] = map[tool.availability] || map.available;
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function daysPill(loan) {
    if (loan.status === 'overdue') return `<span class="days-pill bad"><i class="fa-solid fa-triangle-exclamation"></i> ${plural(Math.abs(loan.daysLeft), 'day')} overdue</span>`;
    if (loan.status !== 'active') return '';
    if (loan.daysLeft === 0) return '<span class="days-pill warn">Due today</span>';
    return `<span class="days-pill ${loan.daysLeft <= 2 ? 'warn' : 'ok'}">${plural(loan.daysLeft, 'day')} left</span>`;
  }

  /** Module 4 – the loan stage at a glance. */
  function stageTracker(loan) {
    const stages = [
      ['Booked', true],
      ['Payment completed', !!loan.timestamps.paid],
      ['Confirmed', !!loan.timestamps.confirmed],
      ['Item handed over', !!loan.timestamps.handedOver],
      ['Returned · inspection', !!loan.timestamps.returned],
      ['Completed', loan.status === 'completed'],
    ];
    const ended = ['cancelled', 'declined', 'voided'].includes(loan.status);
    const current = stages.filter(s => s[1]).length;
    return `<ol class="stage-tracker ${ended ? 'ended' : ''}">${stages.map(([label, done], i) => `
      <li class="${done ? 'done' : ''} ${i === current && !ended ? 'current' : ''}"><span></span>${label}</li>`).join('')}
      ${ended ? `<li class="ended-label">${esc(statusLabel(loan.status))}</li>` : ''}</ol>`;
  }

  const loading = (text = 'Loading…') => `<div class="loading-state"><span class="spinner"></span> ${esc(text)}</div>`;
  const emptyState = (icon, text, action = '') =>
    `<div class="empty-state"><i class="fa-solid ${icon}" aria-hidden="true"></i><p>${esc(text)}</p>${action}</div>`;

  /* ── API wrapper ────────────────────────────────── */
  class ApiError extends Error {
    constructor(message, status, fields) { super(message); this.status = status; this.fields = fields || null; }
  }

  async function api(url, data, method) {
    const { ok, status, data: body } = await apiRequest(url, data, method);
    if (status === 401 && !url.startsWith('/api/auth/')) {
      window.location.replace('login.html?expired=1');
      throw new ApiError('Your session has expired.', 401);
    }
    if (!ok) throw new ApiError(body.error || 'Something went wrong. Please try again.', status, body.fields);
    return body;
  }

  /** Show field errors from the server; idMap maps API field → input id. */
  function showFieldErrors(err, idMap = {}) {
    if (!err.fields) return false;
    Object.entries(err.fields).forEach(([name, msg]) => setError(idMap[name] || name, msg));
    const first = Object.keys(err.fields)[0];
    document.getElementById(idMap[first] || first)?.focus();
    return true;
  }
  function clearFieldErrors(root) {
    root.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
    root.querySelectorAll('.error-msg').forEach(el => { el.textContent = ''; });
  }
  async function withLoading(btn, fn) {
    setLoading(btn, true);
    try { return await fn(); } finally { setLoading(btn, false); }
  }

  /* ── Modals ─────────────────────────────────────── */
  function modal({ title, body = '', footer = '', size = '', onClose } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal-card app-modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="app-modal-header">
          <h3>${esc(title)}</h3>
          <button type="button" class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
        <div class="app-modal-body">${body}</div>
        ${footer ? `<div class="app-modal-footer">${footer}</div>` : ''}
      </div>`;
    const opener = document.activeElement;
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.modal-overlay.open')) document.documentElement.style.overflow = '';
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      onClose?.();
    };
    const onKey = e => {
      if (overlay !== [...document.querySelectorAll('.modal-overlay.open')].pop()) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {   // keep keyboard focus inside the dialog
        const focusable = [...overlay.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter(el => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', close));
    // On touch screens focusing an input would pop up the keyboard and scroll past the content.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      setTimeout(() => overlay.querySelector('input:not([type=hidden]):not([type=file]):not([type=radio]), textarea, select')?.focus(), 50);
    } else {
      overlay.querySelector('.modal-close')?.focus({ preventScroll: true });
    }

    return { el: overlay, body: overlay.querySelector('.app-modal-body'), close };
  }

  /** Confirmation dialog. Resolves true / the typed text, or null if cancelled. */
  function confirm({ title, message, confirmText = 'Confirm', danger = false, input } = {}) {
    return new Promise(resolve => {
      let done = false;
      const m = modal({
        title,
        body: `
          <p style="font-size:14px;color:var(--gray-700);margin-bottom:${input ? '14px' : '0'};">${esc(message)}</p>
          ${input ? `
            <div class="form-group" style="margin-bottom:0;">
              <label for="confirmInput">${esc(input.label)}${input.required ? '' : ' <span class="muted">(optional)</span>'}</label>
              <textarea id="confirmInput" class="form-control" rows="3" maxlength="300" placeholder="${esc(input.placeholder || '')}"></textarea>
              <span class="error-msg" id="confirmInputErr"></span>
            </div>` : ''}`,
        footer: `
          <button type="button" class="btn-secondary" data-close>Cancel</button>
          <button type="button" class="btn-primary ${danger ? 'btn-danger' : ''}" id="confirmOk">${esc(confirmText)}</button>`,
        onClose: () => { if (!done) resolve(null); },
      });
      m.el.querySelector('#confirmOk').addEventListener('click', () => {
        let value = true;
        if (input) {
          value = m.el.querySelector('#confirmInput').value.trim();
          if (input.required && value.length < (input.minLength || 1)) {
            setError('confirmInput', `Please enter at least ${input.minLength || 1} characters.`);
            return;
          }
        }
        done = true;
        m.close();
        resolve(value);
      });
    });
  }

  /* ── Images ─────────────────────────────────────── */
  const MAX_UPLOAD_MB = 10;

  /** Resize an image file in the browser and return a JPEG data URL. */
  function resizeImage(file, maxDim) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Please choose a JPG, PNG or WebP image.'));
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return reject(new Error(`Image is too large (max ${MAX_UPLOAD_MB} MB).`));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image.')); };
      img.src = url;
    });
  }

  /** Single-image upload box with an empty-state placeholder. */
  function uploader(container, opts = {}) {
    const state = { current: opts.current || null, data: null, removed: false };
    container.className = `upload-box ${opts.round ? 'round' : ''}`;
    container.tabIndex = 0;
    container.setAttribute('role', 'button');
    container.setAttribute('aria-label', opts.title || 'Upload photo');
    container.innerHTML = `
      <input type="file" accept="image/jpeg,image/png,image/webp" />
      <div class="upload-empty">
        <div class="upload-icon"><i class="fa-solid fa-camera" aria-hidden="true"></i></div>
        <strong>${esc(opts.title || 'Upload a photo')}</strong>
        <small>${esc(opts.hint || 'Click or drag an image here · JPG, PNG or WebP · max 10 MB')}</small>
      </div>
      <img class="upload-preview" alt="Selected photo" hidden />
      <div class="upload-actions" hidden>
        <button type="button" data-act="change" aria-label="Change photo" title="Change photo"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-act="remove" aria-label="Remove photo" title="Remove photo"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    const input = container.querySelector('input');
    const preview = container.querySelector('.upload-preview');
    const empty = container.querySelector('.upload-empty');
    const actions = container.querySelector('.upload-actions');
    const render = () => {
      const src = state.data || (!state.removed && state.current);
      preview.hidden = !src; empty.hidden = !!src; actions.hidden = !src;
      if (src) preview.src = src;
    };
    async function handleFile(file) {
      if (!file) return;
      container.classList.add('busy');
      try {
        state.data = await resizeImage(file, opts.maxDim || 1200);
        state.removed = false;
        container.classList.remove('invalid');
        render();
        opts.onChange?.(state.data);
      } catch (err) { showToast(err.message, 'error'); }
      finally { container.classList.remove('busy'); input.value = ''; }
    }
    container.addEventListener('click', e => {
      if (e.target.closest('[data-act]')?.dataset.act === 'remove') {
        e.stopPropagation();
        state.data = null; state.removed = true; render(); opts.onChange?.(null);
        return;
      }
      input.click();
    });
    container.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('change', () => handleFile(input.files[0]));
    ['dragenter', 'dragover'].forEach(ev => container.addEventListener(ev, e => { e.preventDefault(); container.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => container.addEventListener(ev, e => { e.preventDefault(); container.classList.remove('dragover'); }));
    container.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
    render();
    return {
      data: () => state.data,
      setCurrent(url) { state.current = url; state.data = null; state.removed = false; render(); },
      markInvalid() { container.classList.add('invalid'); },
    };
  }

  /**
   * Multi-photo manager: thumbnails + an "add photo" tile. The first photo is the cover.
   * value() → [{ id }] for kept photos and [{ data }] for new ones, in display order.
   */
  function photoManager(container, { photos = [], max = 5, maxDim = 1200, title = 'Add photo', onChange } = {}) {
    let items = photos.map(p => ({ id: p.id, url: p.url }));
    container.className = 'photo-manager';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.multiple = true;
    input.hidden = true;

    function render() {
      container.innerHTML = items.map((p, i) => `
        <div class="photo-thumb" data-i="${i}">
          <img src="${esc(p.url || p.data)}" alt="Photo ${i + 1}" />
          ${i === 0 ? '<span class="cover-tag">Cover</span>' : `<button type="button" class="ph-btn ph-cover" data-act="cover" title="Make cover photo" aria-label="Make cover photo"><i class="fa-solid fa-star"></i></button>`}
          <button type="button" class="ph-btn ph-remove" data-act="remove" title="Remove photo" aria-label="Remove photo"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('') + (items.length < max ? `
        <button type="button" class="photo-add" data-act="add">
          <i class="fa-solid fa-camera"></i><strong>${esc(title)}</strong><small>${items.length}/${max} · JPG, PNG, WebP</small>
        </button>` : '');
      container.appendChild(input);
    }
    async function addFiles(files) {
      for (const file of [...files].slice(0, max - items.length)) {
        try { items.push({ data: await resizeImage(file, maxDim) }); }
        catch (err) { showToast(err.message, 'error'); }
      }
      container.classList.remove('invalid');
      render();
      onChange?.(items.length);
    }
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const i = Number(btn.closest('[data-i]')?.dataset.i);
      if (btn.dataset.act === 'add') input.click();
      if (btn.dataset.act === 'remove') { items.splice(i, 1); render(); onChange?.(items.length); }
      if (btn.dataset.act === 'cover') { items.unshift(items.splice(i, 1)[0]); render(); }
    });
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
    container.addEventListener('dragover', e => { e.preventDefault(); container.classList.add('dragover'); });
    container.addEventListener('dragleave', () => container.classList.remove('dragover'));
    container.addEventListener('drop', e => { e.preventDefault(); container.classList.remove('dragover'); addFiles(e.dataTransfer.files); });
    render();
    return {
      value: () => items.map(p => (p.id ? { id: p.id } : { data: p.data })),
      count: () => items.length,
      markInvalid() { container.classList.add('invalid'); },
    };
  }

  /** Photo gallery with thumbnails (read-only). */
  function gallery(photos, alt, category) {
    if (!photos.length) return `<div class="detail-media">${toolImage(null, { category })}</div>`;
    return `
      <div class="gallery">
        <div class="detail-media"><img src="${esc(photos[0].url)}" alt="${esc(alt)}" data-gallery-main /></div>
        ${photos.length > 1 ? `<div class="gallery-thumbs">${photos.map((p, i) => `
          <button type="button" class="${i === 0 ? 'active' : ''}" data-gallery-src="${esc(p.url)}" aria-label="Photo ${i + 1}"><img src="${esc(p.url)}" alt="" /></button>`).join('')}</div>` : ''}
      </div>`;
  }
  document.addEventListener('click', e => {
    const thumb = e.target.closest('[data-gallery-src]');
    if (!thumb) return;
    const root = thumb.closest('.gallery');
    root.querySelector('[data-gallery-main]').src = thumb.dataset.gallerySrc;
    root.querySelectorAll('[data-gallery-src]').forEach(b => b.classList.toggle('active', b === thumb));
  });

  /* ── Reviews ────────────────────────────────────── */
  function reviewList(reviews, emptyText = 'No reviews yet.') {
    if (!reviews.length) return `<p class="muted" style="font-size:13px;">${esc(emptyText)}</p>`;
    const isAdmin = currentUser?.role === 'admin';
    return `<ul class="review-list">${reviews.map(r => `
      <li data-review-id="${r.id}">
        <div class="review-head">
          ${avatar(r.reviewer, 'sm')}
          <strong>${esc(r.reviewer.name)}</strong>
          ${stars(r.rating, { size: 'sm' })}
          <span class="muted">${fmtDate(r.createdAt)}${r.edited ? ' · edited' : ''}</span>
        </div>
        ${r.toolName ? `<div class="muted" style="font-size:11.5px;margin:2px 0 0 36px;">for ${esc(r.toolName)}</div>` : ''}
        ${r.commentHidden && !isAdmin
          ? '<p class="review-comment hidden-comment"><i class="fa-solid fa-eye-slash"></i> Comment hidden by an admin</p>'
          : r.comment ? `<p class="review-comment ${r.commentHidden ? 'hidden-comment' : ''}">${esc(r.comment)}${r.commentHidden ? ' <em>(hidden from others)</em>' : ''}</p>` : ''}
        ${isAdmin ? `<div class="btn-row" style="margin:6px 0 0 36px;">
          <button type="button" class="btn-sm" data-review-act="${r.commentHidden ? 'unhide' : 'hide'}"><i class="fa-solid fa-eye${r.commentHidden ? '' : '-slash'}"></i> ${r.commentHidden ? 'Show comment' : 'Hide comment'}</button>
          <button type="button" class="btn-sm danger" data-review-act="remove"><i class="fa-solid fa-trash"></i> Remove review</button>
        </div>` : ''}
      </li>`).join('')}</ul>`;
  }

  /** Admin moderation buttons inside a review list. */
  function bindReviewModeration(root, onChange) {
    root.addEventListener('click', async e => {
      const btn = e.target.closest('[data-review-act]');
      if (!btn) return;
      const id = btn.closest('[data-review-id]').dataset.reviewId;
      try {
        let res;
        if (btn.dataset.reviewAct === 'remove') {
          const reason = await confirm({
            title: 'Remove review', danger: true, confirmText: 'Remove',
            message: 'Remove this review entirely? Its star rating will no longer count and any Trust Point bonus it earned will be reversed.',
            input: { label: 'Reason', placeholder: 'e.g. Fake review / spam', required: true, minLength: 3 },
          });
          if (!reason) return;
          res = await api(`/api/reviews/${id}`, { reason }, 'DELETE');
        } else {
          res = await api(`/api/reviews/${id}/hide`, { hidden: btn.dataset.reviewAct === 'hide' });
        }
        showToast(res.message, 'success');
        onChange?.();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  /* ── Public profile ─────────────────────────────── */
  async function showUserProfile(userId) {
    const m = modal({ title: 'Profile', icon: 'fa-id-badge', size: 'lg', body: loading() });
    const load = async () => {
      try {
        const { profile: p } = await api(`/api/users/${userId}`);
        m.body.innerHTML = `
          <div class="profile-head">
            ${avatar({ name: p.fullName, avatar: p.avatar }, 'xl')}
            <div>
              <div class="detail-title" style="margin:0;">${esc(p.fullName)}</div>
              <div class="muted" style="font-size:13px;">${esc(p.departmentName || '')} · member since ${fmtDate(p.createdAt)}</div>
              <div class="btn-row" style="margin-top:8px;">
                ${p.role === 'student' ? trustBadge(p.trustPoints) : '<span class="badge badge-purple">Admin</span>'}
                ${p.flagged ? '<span class="badge badge-red"><i class="fa-solid fa-flag"></i> Flagged</span>' : ''}
                ${p.status !== 'active' ? `<span class="badge badge-gray">${esc(p.status)}</span>` : ''}
                ${stars(p.rating.average, { count: p.rating.count })}
              </div>
            </div>
          </div>
          <div class="mini-stats">
            <div><strong>${p.completed}</strong><span>Completed bookings</span></div>
            <div><strong>${p.listings}</strong><span>Listings</span></div>
            <div><strong>${p.rating.count}</strong><span>Reviews</span></div>
          </div>
          ${p.email ? `<div class="contact-line" style="margin:0 0 14px;">
            <span><i class="fa-solid fa-envelope"></i> ${esc(p.email)}</span>
            <span><i class="fa-solid fa-phone"></i> ${esc(p.phone || '—')}</span>
            <span><i class="fa-brands fa-whatsapp"></i> ${esc(p.whatsapp || '—')}</span>
            <span><i class="fa-solid fa-id-card"></i> ${esc(p.campusId || '—')}</span></div>` : ''}
          <h4 class="section-title">Reviews from other students</h4>
          <div id="profileReviews">${reviewList(p.reviews)}</div>
          ${p.trustHistory ? `<h4 class="section-title">Trust Point history</h4>${trustHistoryTable(p.trustHistory)}` : ''}`;
      } catch (err) { m.body.innerHTML = emptyState('fa-circle-exclamation', err.message); }
    };
    bindReviewModeration(m.body, load);
    load();
  }

  function trustHistoryTable(history) {
    if (!history.length) return '<p class="muted" style="font-size:13px;">No Trust Point changes yet.</p>';
    return `<div class="table-wrapper"><table class="data-table compact">
      <thead><tr><th>Date</th><th>Change</th><th>Reason</th><th>Balance</th></tr></thead>
      <tbody>${history.map(h => `<tr>
        <td class="date-cell">${fmtDate(h.createdAt)}</td>
        <td><strong style="color:${h.delta > 0 ? '#16A34A' : '#DC2626'};">${h.delta > 0 ? '+' : ''}${h.delta}</strong></td>
        <td style="white-space:normal;">${esc(h.reason)}</td>
        <td>${h.balance}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ── Booking chat (Module 3) ────────────────────── */
  function openChat(loanId, title) {
    let lastId = 0;
    let timer;
    const m = modal({
      title: title || 'Chat', icon: 'fa-comments',
      body: `<div class="chat-log" id="chatLog">${loading()}</div>`,
      footer: `<form class="chat-form" id="chatForm"><input class="form-control" id="chatInput" maxlength="1000" placeholder="Discuss the handover time and place…" autocomplete="off" />
               <button type="submit" class="btn-primary"><i class="fa-solid fa-paper-plane"></i></button></form>`,
      onClose: () => { clearInterval(timer); refreshCounts(); },
    });
    const log = m.el.querySelector('#chatLog');
    const form = m.el.querySelector('#chatForm');
    let first = true;

    async function poll() {
      try {
        const { messages, canSend } = await api(`/api/loans/${loanId}/messages?after=${lastId}`);
        if (first) {
          log.innerHTML = messages.length ? '' : '<p class="chat-empty">No messages yet. Say hi and agree on the handover details.</p>';
          first = false;
          form.querySelectorAll('input, button').forEach(el => { el.disabled = !canSend; });
          if (!canSend) form.querySelector('input').placeholder = currentUser.role === 'admin' ? 'Admins can read but not send messages.' : 'This booking is closed – chat is read-only.';
        }
        if (messages.length) {
          log.querySelector('.chat-empty')?.remove();
          log.insertAdjacentHTML('beforeend', messages.map(msg => `
            <div class="chat-msg ${msg.mine ? 'mine' : ''}">
              ${msg.mine ? '' : avatar({ name: msg.sender, avatar: msg.avatar }, 'sm')}
              <div><div class="chat-bubble">${esc(msg.body)}</div><div class="chat-meta">${msg.mine ? '' : esc(msg.sender) + ' · '}${fmtDateTime(msg.createdAt)}</div></div>
            </div>`).join(''));
          lastId = messages[messages.length - 1].id;
          log.scrollTop = log.scrollHeight;
        }
      } catch { /* keep polling */ }
    }
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const input = form.querySelector('input');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try { await api(`/api/loans/${loanId}/messages`, { body }); poll(); }
      catch (err) { showToast(err.message, 'error'); input.value = body; }
    });
    poll();
    timer = setInterval(poll, 4000);
  }

  /* ── Loan detail & receipt ──────────────────────── */
  const EVENT_TEXT = {
    requested:        ['Booking created', ''],
    paid:             ['Payment completed – held in escrow', 'good'],
    payment_failed:   ['Payment attempt failed', 'bad'],
    counter_offer:    ['Handover counter-offer', ''],
    confirmed:        ['Booking confirmed – PIN issued', 'good'],
    declined:         ['Declined – full refund', 'bad'],
    cancelled:        ['Cancelled', 'bad'],
    voided:           ['Handover voided – full refund', 'bad'],
    pin_locked:       ['PIN entry locked after wrong attempts', 'bad'],
    handed_over:      ['PIN verified – item handed over', 'good'],
    return_submitted: ['Borrower returned the item', ''],
    inspected:        ['Lender inspected the return', 'good'],
    disputed:         ['Dispute filed', 'bad'],
    completed:        ['Booking completed', 'good'],
    reminder_due:     ['Due-date reminder sent', ''],
    reminder_overdue: ['Overdue notice sent', 'bad'],
  };
  const TX_LABEL = {
    payment: 'Payment received (escrow)', release_fee: 'Rental fee released to lender',
    refund: 'Refund to borrower', deposit_deduction: 'Deposit deduction to lender',
  };

  function contactHtml(person) {
    if (!person.email && !person.phone) return '';
    const wa = (person.whatsapp || '').replace(/\D/g, '').replace(/^0/, '60');
    return `<div class="contact-line">
      ${person.phone ? `<a href="tel:${esc(person.phone)}"><i class="fa-solid fa-phone"></i> ${esc(person.phone)}</a>` : ''}
      ${wa ? `<a href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : ''}
      ${person.email ? `<a href="mailto:${esc(person.email)}"><i class="fa-solid fa-envelope"></i> ${esc(person.email)}</a>` : ''}
    </div>`;
  }

  function costTable(loan) {
    return `<table class="cost-table">
      <tr><td>Rental: ${money(loan.cost.dailyRate)} × ${plural(loan.days, 'day')}</td><td>${money(loan.cost.rental)}</td></tr>
      <tr><td>Security deposit <span class="muted">(refundable)</span></td><td>${money(loan.cost.deposit)}</td></tr>
      <tr class="total"><td>Total</td><td>${money(loan.cost.total)}</td></tr>
      ${loan.timestamps.paid ? `<tr class="escrow"><td><i class="fa-solid fa-lock"></i> Currently held in escrow</td><td>${money(loan.cost.escrow)}</td></tr>` : ''}
    </table>`;
  }

  async function showLoanDetail(id) {
    const m = modal({ title: 'Booking details', icon: 'fa-file-lines', size: 'lg', body: loading() });
    try {
      const { loan } = await api(`/api/loans/${id}`);
      m.body.innerHTML = `
        ${stageTracker(loan)}
        <div class="detail-layout" style="margin-top:18px;">
          <div>
            <div class="detail-media">${toolImage(loan.tool.image, { alt: loan.tool.name, category: loan.tool.category })}</div>
            <h4 class="section-title">Cost & escrow</h4>
            ${costTable(loan)}
            ${loan.transactions.length ? `<h4 class="section-title">Payment ledger</h4>
              <ul class="ledger">${loan.transactions.map(t => `<li class="${t.type}">
                <div><strong>${esc(TX_LABEL[t.type] || t.type)}</strong><small>${esc(t.reference)} · ${fmtDateTime(t.createdAt)}${t.note ? ' · ' + esc(t.note) : ''}</small></div>
                <span>${t.type === 'payment' ? '+' : '−'}${money(t.amount)}</span></li>`).join('')}</ul>` : ''}
            ${loan.returnPhoto ? `<h4 class="section-title">Condition photo at return</h4>
              <div class="photo-frame"><img src="${esc(loan.returnPhoto)}" alt="Condition photo uploaded by borrower" /></div>
              ${loan.returnNote ? `<div class="loan-message">${esc(loan.returnNote)}</div>` : ''}` : ''}
          </div>
          <div>
            <span class="loan-ref">${esc(loan.ref)}</span>
            <div class="detail-title">${esc(loan.tool.name)}</div>
            <div style="margin-bottom:14px;">${statusBadge(loan.status)} ${daysPill(loan)}</div>
            <dl class="info-list">
              <dt><i class="fa-solid fa-user"></i> Borrower</dt><dd>${esc(loan.borrower.name)}</dd>
              <dt><i class="fa-solid fa-user-tie"></i> Lender</dt><dd>${esc(loan.owner.name)}</dd>
              <dt><i class="fa-solid fa-calendar"></i> Rental</dt><dd>${fmtDate(loan.startDate)} → ${fmtDate(loan.endDate)} (${plural(loan.days, 'day')})</dd>
              <dt><i class="fa-solid fa-handshake"></i> Handover</dt><dd>${fmtHandover(loan.handover.time)}<br><span class="muted">${esc(loan.handover.location || '')}</span></dd>
            </dl>
            ${loan.message ? `<div class="loan-message"><strong>Borrower:</strong> ${esc(loan.message)}</div>` : ''}
            ${loan.ownerNote ? `<div class="loan-message owner"><strong>Lender:</strong> ${esc(loan.ownerNote)}</div>` : ''}
            ${loan.cancelReason ? `<div class="loan-message"><strong>Closed:</strong> ${esc(loan.cancelReason)}</div>` : ''}
            ${loan.viewerRole !== 'borrower' ? contactHtml(loan.borrower) : ''}
            ${loan.viewerRole !== 'lender' ? contactHtml(loan.owner) : ''}
            ${loan.proposals.length > 1 ? `<h4 class="section-title">Handover negotiation</h4>
              <ul class="timeline">${loan.proposals.map(p => `<li class="${p.status === 'accepted' ? 'good' : p.status === 'declined' ? 'bad' : ''}">
                <div class="tl-title">${esc(p.proposer)} proposed ${fmtHandover(p.time)} · ${esc(p.location)}</div>
                <div class="tl-time">${fmtDateTime(p.createdAt)} · ${esc(p.status)}</div>${p.message ? `<div class="tl-note">${esc(p.message)}</div>` : ''}</li>`).join('')}</ul>` : ''}
            <h4 class="section-title">Timeline</h4>
            <ul class="timeline">${loan.events.map(ev => {
              const [text, cls] = EVENT_TEXT[ev.action] || [ev.action, ''];
              return `<li class="${cls}"><div class="tl-title">${esc(text)}</div>
                <div class="tl-time">${fmtDateTime(ev.createdAt)}${ev.actor ? ' · ' + esc(ev.actor) : ' · System'}</div>
                ${ev.note ? `<div class="tl-note">${esc(ev.note)}</div>` : ''}</li>`;
            }).join('')}</ul>
          </div>
        </div>`;
    } catch (err) {
      m.body.innerHTML = emptyState('fa-circle-exclamation', err.message);
    }
  }

  async function showReceipt(id) {
    const m = modal({ title: 'Payment receipt', icon: 'fa-receipt', body: loading(),
      footer: '<button type="button" class="btn-secondary" data-close>Close</button><button type="button" class="btn-primary" id="printReceipt"><i class="fa-solid fa-print"></i> Print</button>' });
    m.el.querySelector('#printReceipt').addEventListener('click', () => {
      document.body.classList.add('printing-receipt');
      window.print();
      document.body.classList.remove('printing-receipt');
    });
    try {
      const { loan } = await api(`/api/loans/${id}`);
      const pay = loan.transactions.find(t => t.type === 'payment');
      m.body.innerHTML = `
        <div class="receipt" id="receipt">
          <div class="receipt-head">
            <div class="brand-icon" style="width:40px;height:40px;background:var(--blue-primary);color:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center;"><i class="fa-solid fa-screwdriver-wrench"></i></div>
            <div><strong>Campus Hardware Lending System</strong><small>Official payment receipt · simulated gateway</small></div>
          </div>
          <dl class="info-list">
            <dt>Receipt no.</dt><dd>${esc(pay?.reference || '—')}</dd>
            <dt>Booking</dt><dd>${esc(loan.ref)}</dd>
            <dt>Paid on</dt><dd>${fmtDateTime(pay?.createdAt)}</dd>
            <dt>Method</dt><dd>${pay?.method === 'fpx' ? `Online banking (${esc(pay.note || '')})` : `Card ending ${esc(pay?.last4 || '')}`}</dd>
            <dt>Paid by</dt><dd>${esc(loan.borrower.name)}</dd>
            <dt>Lender</dt><dd>${esc(loan.owner.name)}</dd>
            <dt>Item</dt><dd>${esc(loan.tool.name)}</dd>
            <dt>Rental dates</dt><dd>${fmtDate(loan.startDate)} → ${fmtDate(loan.endDate)}</dd>
          </dl>
          ${costTable(loan)}
          <ul class="ledger">${loan.transactions.filter(t => t.type !== 'payment').map(t => `<li class="${t.type}">
            <div><strong>${esc(TX_LABEL[t.type])}</strong><small>${esc(t.reference)} · ${fmtDateTime(t.createdAt)}</small></div><span>−${money(t.amount)}</span></li>`).join('')}</ul>
          <p class="field-hint" style="text-align:center;margin-top:14px;">The rental fee is released to the lender when the handover PIN is verified. The deposit is refunded after the return is inspected, unless a dispute is upheld.</p>
        </div>`;
    } catch (err) { m.body.innerHTML = emptyState('fa-circle-exclamation', err.message); }
  }

  /* ── Shell (sidebar + topbar) ───────────────────── */
  function renderShell(user) {
    const page = document.body.dataset.page;
    const title = document.body.dataset.title || document.title.split('–')[0].trim();

    const nav = NAV[user.role === 'admin' ? 'admin' : 'student'].map(item => item.section
      ? `<div class="nav-section-label">${item.section}</div>`
      : `<a href="${item.page}.html" class="nav-item ${item.page === page ? 'active' : ''}" ${item.page === page ? 'aria-current="page"' : ''}>
           <i class="fa-solid ${item.icon}" aria-hidden="true"></i><span>${item.label}</span>
           ${item.badge ? `<span class="nav-count" data-badge="${item.badge}" hidden></span>` : ''}
         </a>`).join('');

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.id = 'sidebar';
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="brand-icon"><i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i></div>
        <div class="brand-text"><span class="brand-top">Campus</span><span class="brand-bot">Hardware Lending<br />System</span></div>
      </div>
      <nav class="sidebar-nav" aria-label="Main navigation">${nav}</nav>
      <div class="sidebar-footer">
        <a href="#" class="nav-item" data-logout><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>Log Out</span></a>
      </div>`;

    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebarOverlay';
    const main = document.querySelector('.main-content');
    document.body.insertBefore(overlay, main);
    document.body.insertBefore(sidebar, overlay);

    const role = user.role === 'admin' ? 'admin' : 'student';
    const quickTabs = QUICK[role].map(key => {
      const item = NAV[role].find(n => n.page === key);
      if (!item) return '';
      const active = item.page === page;
      return `<a href="${item.page}.html" class="quick-tab ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''} title="${esc(item.label)}">
                <i class="fa-solid ${item.icon}" aria-hidden="true"></i><span>${QUICK_LABEL[item.page] || item.label}</span>
                ${item.badge ? `<span class="nav-count" data-badge="${item.badge}" hidden></span>` : ''}
              </a>`;
    }).join('');

    const topbar = document.createElement('header');
    topbar.className = 'topbar';
    topbar.innerHTML = `
      <div class="topbar-left">
        <button class="hamburger" data-toggle-sidebar aria-label="Open menu" aria-controls="sidebar" aria-expanded="false"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
        <div class="breadcrumb"><span>Home</span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span class="active">${esc(title)}</span></div>
      </div>
      <div class="topbar-center">
        <nav class="quick-tabs" aria-label="Quick navigation">${quickTabs}</nav>
      </div>
      <div class="topbar-right">
        ${user.role === 'student' ? `<span class="topbar-trust" title="Your Trust Points">${trustBadge(user.trustPoints)}</span>` : ''}
        <a href="notifications.html" class="topbar-icon-btn" aria-label="Notifications">
          <i class="fa-solid fa-bell"></i><span class="icon-badge" data-badge="unread" hidden></span>
        </a>
        <div class="user-menu" id="userMenu">
          <button class="user-avatar-btn" data-toggle-user aria-label="User menu" aria-haspopup="true">
            <span id="topbarAvatar">${avatar(user)}</span>
            <div class="user-info">
              <span class="user-name">${esc(user.fullName)}</span>
              <span class="user-role">${user.role === 'admin' ? 'Administrator' : 'Student'}</span>
            </div>
            <i class="fa-solid fa-chevron-down user-chevron"></i>
          </button>
          <div class="user-dropdown">
            <a href="profile.html" class="dropdown-item"><i class="fa-solid fa-user"></i> My Profile</a>
            <a href="notifications.html" class="dropdown-item"><i class="fa-solid fa-bell"></i> Notifications</a>
            <div class="dropdown-divider"></div>
            <button class="dropdown-item danger" data-logout><i class="fa-solid fa-right-from-bracket"></i> Log Out</button>
          </div>
        </div>
      </div>`;
    main.insertBefore(topbar, main.firstChild);
    // Keep the current page's tab visible when the strip has to scroll.
    const activeTab = topbar.querySelector('.quick-tab.active');
    if (activeTab) activeTab.scrollIntoView({ inline: 'center', block: 'nearest' });

    if (!document.getElementById('toast')) {
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.id = 'toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    if (user.role === 'admin') document.body.classList.add('role-admin');

    // Sidebar: hover the menu button to slide it in, click to keep it open
    // (click again to hide). On small screens the button opens a drawer.
    const hamburger = topbar.querySelector('[data-toggle-sidebar]');
    const desktopMQ = window.matchMedia('(min-width: 901px)');
    const hoverMQ   = window.matchMedia('(hover: hover) and (pointer: fine)');
    const PIN_KEY   = 'chh_sidebar_pinned';
    let pinned = localStorage.getItem(PIN_KEY) === '1';

    const syncState = () => {
      const visible = (pinned && desktopMQ.matches) || sidebar.classList.contains('peek') || sidebar.classList.contains('open');
      document.body.classList.toggle('sidebar-pinned', pinned);
      hamburger.setAttribute('aria-expanded', String(visible));
      hamburger.setAttribute('aria-label', visible ? 'Hide menu' : 'Open menu');
    };
    const setPeek   = on => { sidebar.classList.toggle('peek', on); syncState(); };
    const setDrawer = on => { sidebar.classList.toggle('open', on); overlay.classList.toggle('open', on); syncState(); };
    const toggleSidebar = () => {
      if (desktopMQ.matches) {
        pinned = !pinned;
        localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
        sidebar.classList.remove('peek');
        syncState();
      } else {
        setDrawer(!sidebar.classList.contains('open'));
      }
    };

    hamburger.addEventListener('click', toggleSidebar);
    overlay.addEventListener('click', () => setDrawer(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { setPeek(false); setDrawer(false); } });
    desktopMQ.addEventListener('change', () => { setPeek(false); setDrawer(false); });

    if (hoverMQ.matches) {
      let closeTimer = null;
      const cancelClose   = () => { clearTimeout(closeTimer); closeTimer = null; };
      const scheduleClose = () => { cancelClose(); closeTimer = setTimeout(() => setPeek(false), 220); };
      hamburger.addEventListener('mouseenter', () => { cancelClose(); if (desktopMQ.matches && !pinned) setPeek(true); });
      hamburger.addEventListener('mouseleave', scheduleClose);
      sidebar.addEventListener('mouseenter', cancelClose);
      sidebar.addEventListener('mouseleave', scheduleClose);
      sidebar.addEventListener('focusin',  () => { cancelClose(); if (desktopMQ.matches && !pinned) setPeek(true); });
      sidebar.addEventListener('focusout', e => { if (!sidebar.contains(e.relatedTarget)) scheduleClose(); });
    }
    syncState();
    const userMenu = topbar.querySelector('#userMenu');
    topbar.querySelector('[data-toggle-user]').addEventListener('click', e => { e.stopPropagation(); userMenu.classList.toggle('open'); });
    document.addEventListener('click', e => { if (!userMenu.contains(e.target)) userMenu.classList.remove('open'); });
    document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); logout(); }));
  }

  /** Give each table cell its column name so phones can show rows as labelled cards. */
  function labelTables(root = document) {
    root.querySelectorAll('.data-table').forEach(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => {
          if (!td.hasAttribute('colspan') && headers[i] !== undefined && td.dataset.label !== headers[i]) td.dataset.label = headers[i];
        });
      });
    });
  }
  let labelQueued = false;
  new MutationObserver(() => {
    if (labelQueued) return;
    labelQueued = true;
    requestAnimationFrame(() => { labelQueued = false; labelTables(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Any element with data-user-id opens that person's profile.
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-user-id]');
    if (el && !e.target.closest('[data-act]')) { e.preventDefault(); e.stopPropagation(); showUserProfile(el.dataset.userId); }
  }, true);

  async function logout() {
    const ok = await confirm({
      title: 'Log out?', icon: 'fa-right-from-bracket', danger: true, confirmText: 'Log Out',
      message: 'Are you sure you want to log out of Campus Hardware Lending System?',
    });
    if (!ok) return;
    try { await apiRequest('/api/auth/logout', {}); } catch { /* still leave */ }
    window.location.replace('login.html?loggedout=1');
  }

  async function refreshCounts() {
    try {
      const counts = await api('/api/me/counts');
      document.querySelectorAll('[data-badge]').forEach(el => {
        const n = counts[el.dataset.badge] || 0;
        el.textContent = n > 99 ? '99+' : n;
        el.hidden = n === 0;
      });
    } catch { /* badges are optional */ }
  }

  function updateUser(user) {
    currentUser = user;
    const slot = document.getElementById('topbarAvatar');
    if (slot) slot.innerHTML = avatar(user);
    const name = document.querySelector('.user-name');
    if (name) name.textContent = user.fullName;
  }

  async function init() {
    let user = null;
    try {
      const { ok, data } = await apiRequest('/api/auth/me');
      if (ok) user = data.user;
    } catch (err) {
      document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;">${esc(err.message)}</div>`;
      return null;
    }
    if (!user) { window.location.replace('login.html?expired=1'); return null; }
    currentUser = user;
    renderShell(user);
    refreshCounts();
    // Keep the badges current while the tab is open.
    setInterval(() => { if (!document.hidden) refreshCounts(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCounts(); });
    showDemoStrip();
    return user;
  }

  /** On the public demo deployment, remind people that data resets. */
  async function showDemoStrip() {
    try {
      if (sessionStorage.getItem('chh_demo_strip_closed')) return;
    } catch { /* storage unavailable */ }
    try {
      const { ok, data } = await apiRequest('/api/auth/config');
      if (!ok || !data.demo) return;
    } catch { return; }
    const strip = document.createElement('div');
    strip.className = 'demo-strip';
    strip.setAttribute('role', 'note');
    strip.innerHTML = `<i class="fa-solid fa-flask" aria-hidden="true"></i>
      <span>Demo site – data resets from time to time.</span>
      <button type="button" aria-label="Dismiss"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
    strip.querySelector('button').addEventListener('click', () => {
      strip.remove();
      try { sessionStorage.setItem('chh_demo_strip_closed', '1'); } catch { /* ignore */ }
    });
    document.querySelector('.page-body')?.prepend(strip);
  }

  function ready(fn) {
    document.addEventListener('DOMContentLoaded', async () => {
      const user = await init();
      if (user) fn(user);
    });
  }

  return {
    ready, api, ApiError, refreshCounts, updateUser, get user() { return currentUser; },
    esc, fmtDate, fmtDateTime, fmtHandover, timeAgo, todayStr, addDays, daysBetween, plural, initials, money,
    toolImage, avatar, stars, trustBadge, statusBadge, statusLabel, availabilityBadge, daysPill, stageTracker,
    loading, emptyState, contactHtml, costTable,
    showFieldErrors, clearFieldErrors, withLoading, modal, confirm, uploader, photoManager, gallery, resizeImage,
    reviewList, bindReviewModeration, trustHistoryTable, showUserProfile, openChat, showLoanDetail, showReceipt, EVENT_TEXT,
  };
})();
