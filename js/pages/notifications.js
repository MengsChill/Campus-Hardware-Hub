/* ============================================================
   Notifications
   ============================================================ */

App.ready(async () => {
  const { esc } = App;
  const list = document.getElementById('notifPageList');
  const tabs = document.getElementById('notifTabs');
  let items = [];
  let filter = 'all';

  function render() {
    tabs.querySelectorAll('[data-tab]').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === filter);
      t.querySelector('.tab-count').textContent = t.dataset.tab === 'unread' ? items.filter(n => !n.read).length : items.length;
    });
    const shown = filter === 'unread' ? items.filter(n => !n.read) : items;
    list.innerHTML = shown.length
      ? shown.map(n => `
          <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}" role="button" tabindex="0">
            <div class="notif-icon" style="background:var(--blue-pale);color:var(--blue-primary);"><i class="fa-solid ${esc(n.icon)}"></i></div>
            <div class="notif-info">
              <div class="notif-title">${esc(n.title)}</div>
              <div class="notif-body">${esc(n.body)}</div>
              <div class="notif-time">${App.timeAgo(n.createdAt)}</div>
            </div>
          </div>`).join('')
      : App.emptyState('fa-bell-slash', filter === 'unread' ? "You're all caught up." : 'No notifications yet.');
  }

  async function load() {
    list.innerHTML = App.loading();
    try {
      ({ notifications: items } = await App.api('/api/me/notifications?limit=100'));
      render();
    } catch (err) {
      list.innerHTML = App.emptyState('fa-circle-exclamation', err.message);
    }
  }

  async function open(el) {
    const id = Number(el.dataset.id);
    const item = items.find(n => n.id === id);
    if (item && !item.read) {
      item.read = true;
      App.api(`/api/me/notifications/${id}/read`, {}).then(App.refreshCounts).catch(() => {});
    }
    if (el.dataset.link) window.location.href = el.dataset.link;
    else render();
  }

  list.addEventListener('click', e => { const el = e.target.closest('[data-id]'); if (el) open(el); });
  list.addEventListener('keydown', e => { const el = e.target.closest('[data-id]'); if (el && e.key === 'Enter') open(el); });
  tabs.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { filter = t.dataset.tab; render(); } });
  document.getElementById('markAllBtn').addEventListener('click', async () => {
    try {
      const res = await App.api('/api/me/notifications/read-all', {});
      items.forEach(n => { n.read = true; });
      render();
      App.refreshCounts();
      showToast(res.message, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
  load();
});
