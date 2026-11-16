/* ============================================================
   Campus Hardware Lending System – Dashboard (live data)
   ============================================================ */

const ACTIVITY_VERBS = {
  requested:        'booked',
  paid:             'paid for',
  counter_offer:    'proposed a new handover for',
  confirmed:        'confirmed the booking of',
  declined:         'declined the booking of',
  cancelled:        'cancelled the booking of',
  voided:           'voided the handover of',
  handed_over:      'verified the PIN and handed over',
  return_submitted: 'returned',
  inspected:        'inspected',
  completed:        'completed the booking of',
  disputed:         'filed a claim on',
};

App.ready(async user => {
  const { esc } = App;
  let data;
  try {
    data = await App.api('/api/me/dashboard');
  } catch (err) {
    document.getElementById('dashBody').innerHTML = App.emptyState('fa-circle-exclamation', err.message);
    return;
  }
  const isAdmin = data.role === 'admin';
  const firstName = user.fullName.split(/\s+/)[0];

  /* Welcome banner */
  document.getElementById('welcomeName').textContent = firstName;
  document.getElementById('dashboardDate').textContent = new Intl.DateTimeFormat('en-MY', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());
  document.getElementById('welcomeMessage').textContent = isAdmin
    ? 'Monitor listings, bookings, disputes and Trust Points across the campus.'
    : 'Rent hardware from fellow students, or earn by lending out the ones you own.';
  document.getElementById('welcomeActions').innerHTML = isAdmin
    ? `<a href="reports.html" class="btn-primary banner-btn"><i class="fa-solid fa-chart-column"></i> View Reports</a>
       <a href="disputes.html" class="btn-primary banner-btn ghost"><i class="fa-solid fa-scale-balanced"></i> Disputes</a>`
    : `<a href="catalog.html" class="btn-primary banner-btn"><i class="fa-solid fa-magnifying-glass"></i> Browse Hardware</a>
       <a href="my-tools.html?new=1" class="btn-primary banner-btn ghost"><i class="fa-solid fa-plus"></i> List Hardware</a>`;

  if (data.flagged) {
    document.getElementById('dashNotice').insertAdjacentHTML('beforeend',
      `<div class="notice danger"><i class="fa-solid fa-flag"></i><div><strong>Your account is under review</strong>Your Trust Points fell below 50. Return items on time and avoid disputes to rebuild your standing. <a href="profile.html" style="font-weight:700;text-decoration:underline;">See history</a></div></div>`);
  }
  if (data.blocked) {
    document.getElementById('dashNotice').insertAdjacentHTML('beforeend',
      `<div class="notice danger"><i class="fa-solid fa-circle-exclamation"></i><div><strong>Borrowing is paused</strong>${esc(data.blocked)} <a href="my-loans.html" style="font-weight:700;text-decoration:underline;">Go to My Bookings</a></div></div>`);
  }

  /* Stats */
  const s = data.stats;
  const stat = (color, icon, value, label, detail, href) => `
    <a href="${href}" class="stat-card ${color}">
      <div class="stat-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="stat-body"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
      <div class="stat-trend">${detail}</div>
    </a>`;
  document.getElementById('statsGrid').innerHTML = isAdmin ? [
    stat('blue',   'fa-users',           s.students, 'Active students',  `${s.flagged} flagged for review`,            'manage-users.html?filter=flagged'),
    stat('orange', 'fa-hand-holding',    s.active,   'Bookings in progress', `${s.overdue} overdue`,                    'bookings.html'),
    stat('red',    'fa-scale-balanced',  s.disputes, 'Open disputes',    'Waiting for your decision',                  'disputes.html'),
    stat('green',  'fa-lock',            App.money(s.escrow), 'Held in escrow', 'Payments not yet released or refunded', 'reports.html'),
  ].join('') : [
    stat(s.trustPoints < 50 ? 'red' : 'green', 'fa-shield-heart', s.trustPoints, 'Trust Points', s.trustPoints < 50 ? 'Below 50 – account flagged' : 'Keep returning on time', 'profile.html'),
    stat('blue',   'fa-calendar-check',  `${s.borrowing}<small style="font-size:14px;color:var(--gray-400);"> / 3</small>`, 'Active bookings', s.overdue ? `${s.overdue} overdue!` : 'Hardware you are renting', 'my-loans.html'),
    stat('orange', 'fa-inbox',           s.incoming, 'Needs your action', 'Requests, handovers & returns', 'requests.html'),
    stat('green',  'fa-toolbox',         s.listings, 'My listings',      `${App.money(s.earnings)} earned so far`, 'my-tools.html'),
  ].join('');

  /* Main card + side card */
  const actionItem = (loan, href, line) => `
    <a href="${href}" class="action-item">
      <div class="thumb">${App.toolImage(loan.tool.image, { small: true })}</div>
      <div class="action-item-text"><strong>${esc(loan.tool.name)}</strong>${line}</div>
      ${App.statusBadge(loan.status, true)}
    </a>`;

  if (isAdmin) {
    document.getElementById('mainCardTitle').innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Recent bookings';
    document.getElementById('mainCardLink').href = 'bookings.html';
    document.getElementById('mainCardBody').innerHTML = data.recentLoans.length ? `
      <div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Item</th><th>Borrower</th><th>Lender</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${data.recentLoans.map(l => `
          <tr>
            <td><div class="tool-cell"><div class="thumb">${App.toolImage(l.tool.image, { small: true })}</div><span class="tool-name">${esc(l.tool.name)}</span></div></td>
            <td>${esc(l.borrower.name)}</td><td>${esc(l.owner.name)}</td>
            <td>${App.money(l.cost.total)}</td><td>${App.statusBadge(l.status, true)}</td>
          </tr>`).join('')}</tbody>
      </table></div>` : App.emptyState('fa-box-open', 'No bookings yet.');

    document.getElementById('sideCardTitle').innerHTML = '<i class="fa-solid fa-flag"></i> Flagged accounts';
    document.getElementById('sideCardBody').innerHTML = (data.flaggedUsers.length
      ? `<div class="action-list">${data.flaggedUsers.map(u => `<a href="manage-users.html?filter=flagged" class="action-item">${App.avatar(u)}
          <div class="action-item-text"><strong>${esc(u.name)}</strong>Needs review</div>${App.trustBadge(u.trustPoints)}</a>`).join('')}</div>`
      : App.emptyState('fa-circle-check', 'No flagged accounts.')) + `
      <div class="quick-actions" style="margin-top:18px;">
        <a href="manage-users.html" class="quick-action-btn blue"><div class="qa-icon"><i class="fa-solid fa-users"></i></div><span>Manage Users</span></a>
        <a href="manage-tools.html" class="quick-action-btn green"><div class="qa-icon"><i class="fa-solid fa-screwdriver-wrench"></i></div><span>Moderate Posts</span></a>
      </div>`;
  } else {
    document.getElementById('mainCardTitle').innerHTML = '<i class="fa-solid fa-calendar-check"></i> My bookings';
    document.getElementById('mainCardLink').href = 'my-loans.html';
    document.getElementById('mainCardBody').innerHTML = data.myLoans.length
      ? `<div class="action-list">${data.myLoans.map(l => actionItem(l, 'my-loans.html',
          `From ${esc(l.owner.name)} · ${App.fmtDate(l.startDate)} → ${App.fmtDate(l.endDate)} ${App.daysPill(l)}${l.pin ? ' · <strong>PIN ready</strong>' : ''}`)).join('')}</div>`
      : App.emptyState('fa-calendar-check', "You don't have any bookings in progress.", '<a href="catalog.html" class="btn-primary"><i class="fa-solid fa-magnifying-glass"></i> Find Hardware</a>');

    document.getElementById('sideCardTitle').innerHTML = '<i class="fa-solid fa-inbox"></i> Needs your action';
    const dueSoon = data.dueSoon.length ? `
      <div class="card-header" style="margin-top:20px;padding-top:18px;border-top:1px solid var(--gray-100);"><h3><i class="fa-solid fa-calendar-xmark"></i> Due soon</h3></div>
      <div class="action-list">${data.dueSoon.map(l => actionItem(l, 'my-loans.html', `Return to ${esc(l.owner.name)} · ${App.daysPill(l)}`)).join('')}</div>` : '';
    document.getElementById('sideCardBody').innerHTML = (data.incoming.length
      ? `<div class="action-list">${data.incoming.map(l => actionItem(l, 'requests.html', `${esc(l.borrower.name)} · ${App.fmtDate(l.startDate)} → ${App.fmtDate(l.endDate)}`)).join('')}</div>`
      : App.emptyState('fa-mug-hot', 'Nothing to do. Bookings for your hardware will show up here.')) + dueSoon;
  }

  /* Latest tools */
  const tools = document.getElementById('latestTools');
  document.getElementById('latestToolsTitle').innerHTML = isAdmin
    ? '<i class="fa-solid fa-toolbox"></i> Recently listed hardware'
    : '<i class="fa-solid fa-toolbox"></i> Available to rent';
  tools.innerHTML = data.latestTools.length
    ? data.latestTools.map(toolTile).join('')
    : `<div style="grid-column:1/-1;">${App.emptyState('fa-box-open', 'No hardware available right now.',
        isAdmin ? '' : '<a href="my-tools.html?new=1" class="btn-primary"><i class="fa-solid fa-plus"></i> List Hardware</a>')}</div>`;
  bindToolTiles(tools, () => location.reload());

  /* Notifications */
  document.getElementById('notifList').innerHTML = data.notifications.length
    ? data.notifications.map(n => `
        <a href="${esc(n.link || 'notifications.html')}" class="notif-item ${n.read ? '' : 'unread'}">
          <div class="notif-icon" style="background:var(--blue-pale);color:var(--blue-primary);"><i class="fa-solid ${esc(n.icon)}"></i></div>
          <div class="notif-info"><div class="notif-title">${esc(n.title)}</div><div class="notif-body">${esc(n.body)}</div><div class="notif-time">${App.timeAgo(n.createdAt)}</div></div>
        </a>`).join('')
    : App.emptyState('fa-bell-slash', 'No notifications yet.');

  /* Activity */
  document.getElementById('activityFeed').innerHTML = data.activity.length
    ? data.activity.map(a => {
        const who = a.actor === user.fullName ? 'You' : (a.actor || 'System');
        return `<div class="activity-item"><div class="activity-dot"></div><div class="activity-info">
          <div class="act-text"><strong>${esc(who)}</strong> ${ACTIVITY_VERBS[a.action] || esc(a.action)} <strong>${esc(a.tool)}</strong></div>
          <div class="act-time">${App.fmtDateTime(a.createdAt)}</div></div></div>`;
      }).join('')
    : App.emptyState('fa-timeline', 'No activity yet.');
});
