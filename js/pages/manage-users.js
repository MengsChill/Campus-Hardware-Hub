/* ============================================================
   Admin – Manage Users (flag review, suspend, roles, Trust Points)
   ============================================================ */

App.ready(async () => {
  const { esc } = App;
  const body = document.getElementById('usersBody');
  const search = document.getElementById('searchInput');
  const role = document.getElementById('roleFilter');
  const status = document.getElementById('statusFilter');
  const flaggedOnly = document.getElementById('flaggedOnly');
  let users = [];
  if (new URLSearchParams(location.search).get('filter') === 'flagged') flaggedOnly.checked = true;

  function row(u) {
    const statusBadge = { active: 'badge-green', suspended: 'badge-red', deactivated: 'badge-gray' }[u.status];
    const actions = u.isSelf ? '<span class="muted">This is you</span>' : `
      <div class="btn-row">
        <button type="button" class="btn-sm" data-act="view"><i class="fa-solid fa-id-badge"></i> Profile</button>
        ${u.flagged && u.status === 'active' ? '<button type="button" class="btn-sm primary" data-act="review"><i class="fa-solid fa-flag"></i> Review flag</button>' : ''}
        ${u.status === 'active'
          ? '<button type="button" class="btn-sm danger" data-act="suspend"><i class="fa-solid fa-user-slash"></i> Suspend</button>'
          : `<button type="button" class="btn-sm success" data-act="activate"><i class="fa-solid fa-user-check"></i> ${u.status === 'deactivated' ? 'Restore' : 'Reactivate'}</button>`}
        ${u.role === 'student'
          ? '<button type="button" class="btn-sm" data-act="promote"><i class="fa-solid fa-user-shield"></i> Make admin</button>'
          : '<button type="button" class="btn-sm" data-act="demote"><i class="fa-solid fa-user-graduate"></i> Make student</button>'}
      </div>`;
    return `
      <tr data-id="${u.id}" class="${u.flagged && u.status === 'active' ? 'row-flagged' : ''}">
        <td><div class="owner-chip">${App.avatar(u)}<div class="cell-stack"><span class="tool-name">${esc(u.fullName)} ${u.flagged && u.status === 'active' ? '<i class="fa-solid fa-flag" style="color:#DC2626;" title="Flagged"></i>' : ''}</span><small>${esc(u.email)}</small></div></div></td>
        <td>${u.role === 'admin' ? '<span class="badge badge-purple">Admin</span>' : '<span class="badge badge-blue">Student</span>'}</td>
        <td><span class="badge ${statusBadge}">${esc(u.status)}</span></td>
        <td>${u.role === 'student' ? App.trustBadge(u.trustPoints) : '<span class="muted">—</span>'}</td>
        <td>${u.rating != null ? App.stars(u.rating, { size: 'sm' }) : '<span class="muted">—</span>'}</td>
        <td>${u.activeLoans}${u.overdue ? ` <span class="badge badge-red">${u.overdue} overdue</span>` : ''}${u.violations ? ` <span class="badge badge-orange">${u.violations} violation${u.violations === 1 ? '' : 's'}</span>` : ''}</td>
        <td class="date-cell">${App.fmtDate(u.createdAt)}</td>
        <td>${actions}</td>
      </tr>`;
  }

  async function load() {
    body.innerHTML = `<tr><td colspan="8">${App.loading()}</td></tr>`;
    const query = new URLSearchParams({ q: search.value.trim(), role: role.value, status: status.value });
    if (flaggedOnly.checked) query.set('filter', 'flagged');
    try {
      ({ users } = await App.api('/api/admin/users?' + query));
      document.getElementById('resultCount').textContent = App.plural(users.length, 'user');
      body.innerHTML = users.length ? users.map(row).join('') : `<tr><td colspan="8">${App.emptyState('fa-users-slash', flaggedOnly.checked ? 'No flagged accounts. Everyone is in good standing.' : 'No users match these filters.')}</td></tr>`;
    } catch (err) { body.innerHTML = `<tr><td colspan="8">${App.emptyState('fa-circle-exclamation', err.message)}</td></tr>`; }
  }

  async function reviewFlag(user) {
    const m = App.modal({ title: 'Review flagged account', icon: 'fa-flag', size: 'lg', body: App.loading() });
    let p;
    try { ({ profile: p } = await App.api(`/api/users/${user.id}`)); } catch (err) { m.body.innerHTML = App.emptyState('fa-circle-exclamation', err.message); return; }
    m.body.innerHTML = `
      <div class="notice danger" style="margin-bottom:14px;"><i class="fa-solid fa-flag"></i><div><strong>${esc(p.fullName)} has ${p.trustPoints} Trust Points</strong>The system flagged this account automatically because it dropped below the threshold. Decide whether to suspend it.</div></div>
      <div class="mini-stats">
        <div><strong>${p.completed}</strong><span>Completed bookings</span></div>
        <div><strong>${p.rating.average ?? '—'}</strong><span>Average rating</span></div>
        <div><strong>${user.violations}</strong><span>Confirmed violations</span></div>
      </div>
      <h4 class="section-title">Trust Point history</h4>
      ${App.trustHistoryTable(p.trustHistory)}
      <div class="form-group" style="margin-top:16px;margin-bottom:0;"><label for="flagNote">Decision note</label>
        <textarea id="flagNote" class="form-control" rows="2" maxlength="300" placeholder="e.g. Penalties were from one incident; warned the student."></textarea>
        <span class="error-msg" id="flagNoteErr"></span></div>`;
    const foot = document.createElement('div');
    foot.className = 'app-modal-footer';
    foot.innerHTML = `<button type="button" class="btn-secondary" data-flag="clear"><i class="fa-solid fa-check"></i> Keep active (clear flag)</button>
                      <button type="button" class="btn-primary btn-danger" data-flag="suspend"><i class="fa-solid fa-user-slash"></i> Suspend account</button>`;
    m.el.querySelector('.app-modal').appendChild(foot);
    foot.querySelectorAll('[data-flag]').forEach(btn => btn.addEventListener('click', async () => {
      App.clearFieldErrors(m.el);
      try {
        const res = await App.api(`/api/admin/users/${user.id}/flag-review`, { action: btn.dataset.flag, note: m.el.querySelector('#flagNote').value.trim() });
        showToast(res.message, 'success');
        m.close();
        App.refreshCounts();
        load();
      } catch (err) { if (!App.showFieldErrors(err, { note: 'flagNote' })) showToast(err.message, 'error'); }
    }));
  }

  const ACTIONS = {
    suspend:  u => ({ url: 'status', body: { status: 'suspended' }, title: 'Suspend user', danger: true, confirmText: 'Suspend',
                      message: `Suspend ${u.fullName}? They will be signed out immediately and cannot sign in. Their listings are hidden from the catalog.` }),
    activate: u => ({ url: 'status', body: { status: 'active' }, title: 'Reactivate user', confirmText: 'Reactivate',
                      message: `Reactivate ${u.fullName}? They will be able to sign in again.` }),
    promote:  u => ({ url: 'role', body: { role: 'admin' }, title: 'Grant admin access', confirmText: 'Make Admin',
                      message: `Give ${u.fullName} admin access? Admins moderate listings, users and disputes, but cannot rent or lend.` }),
    demote:   u => ({ url: 'role', body: { role: 'student' }, title: 'Remove admin access', danger: true, confirmText: 'Make Student',
                      message: `Remove admin access from ${u.fullName}?` }),
  };

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const user = users.find(u => u.id === Number(btn.closest('[data-id]').dataset.id));
    if (btn.dataset.act === 'view') return App.showUserProfile(user.id);
    if (btn.dataset.act === 'review') return reviewFlag(user);
    const action = ACTIONS[btn.dataset.act](user);
    if (!await App.confirm(action)) return;
    try {
      const res = await App.api(`/api/admin/users/${user.id}/${action.url}`, action.body);
      showToast(res.message, 'success');
      App.refreshCounts();
      load();
    } catch (err) { showToast(err.message, 'error'); }
  });

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  [role, status, flaggedOnly].forEach(el => el.addEventListener('change', load));
  load();
});
