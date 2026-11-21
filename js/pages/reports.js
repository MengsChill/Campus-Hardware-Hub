/* ============================================================
   Admin – Reports
   ============================================================ */

App.ready(async () => {
  const { esc } = App;
  let data;
  try { data = await App.api('/api/admin/reports'); }
  catch (err) { document.getElementById('reportBody').innerHTML = App.emptyState('fa-circle-exclamation', err.message); return; }
  const t = data.totals, f = data.finance;

  document.getElementById('reportDate').textContent = `Generated ${App.fmtDateTime(new Date())}`;

  const stat = (color, icon, value, label, detail) => `
    <div class="stat-card ${color}">
      <div class="stat-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="stat-body"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
      <div class="stat-trend">${detail}</div>
    </div>`;
  document.getElementById('reportStats').innerHTML = [
    stat('blue',   'fa-users',               t.students, 'Students',        `${t.flagged} flagged · ${t.suspended} suspended · avg ${t.avgTrust} TP`),
    stat('green',  'fa-toolbox',             t.listings, 'Active listings', `${t.bookings} paid bookings · ${t.completed} completed`),
    stat('orange', 'fa-hand-holding',        t.active,   'Bookings in progress', `${t.overdue} overdue`),
    stat('red',    'fa-scale-balanced',      t.openDisputes, 'Open disputes', `${data.disputes.filter(d => d.status !== 'open').reduce((n, d) => n + d.n, 0)} decided`),
  ].join('');

  // Escrow & payments (simulated gateway)
  const fin = [
    ['Collected from borrowers', f.collected, 'fa-arrow-down', 'in'],
    ['Rental fees released to lenders', f.feesReleased, 'fa-key', 'out'],
    ['Refunded to borrowers', f.refunded, 'fa-rotate-left', 'out'],
    ['Deposit deductions to lenders', f.deductions, 'fa-scale-balanced', 'out'],
  ];
  document.getElementById('financePanel').innerHTML = `
    <ul class="ledger finance">${fin.map(([label, amount, icon, dir]) => `
      <li class="${dir === 'in' ? 'payment' : 'refund'}"><div><strong><i class="fa-solid ${icon}"></i> ${label}</strong></div><span>${dir === 'in' ? '+' : '−'}${App.money(amount)}</span></li>`).join('')}
      <li class="held"><div><strong><i class="fa-solid fa-lock"></i> Currently held in escrow</strong><small>Paid but not yet released or refunded</small></div><span>${App.money(f.held)}</span></li>
    </ul>`;

  // Bookings per month (single series → no legend; the card title names it)
  const maxMonth = Math.max(1, ...data.monthly.map(m => m.count));
  const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-MY', { month: 'short', year: '2-digit' });
  document.getElementById('monthlyChart').innerHTML = `
    <div class="column-chart">${data.monthly.map(m => `
      <div class="column"><span class="column-value">${m.count}</span>
        <div class="column-bar" style="height:${(m.count / maxMonth) * 85}%" tabindex="0" data-tip="${esc(monthName(m.month))}: ${App.plural(m.count, 'booking')}"></div></div>`).join('')}
    </div>
    <div class="column-labels">${data.monthly.map(m => `<span>${esc(monthName(m.month))}</span>`).join('')}</div>`;

  const maxCat = Math.max(1, ...data.byCategory.map(c => c.count));
  document.getElementById('categoryChart').innerHTML = `<div class="bar-list">${data.byCategory.sort((a, b) => b.count - a.count).map(c => `
    <div class="bar-row"><span class="bar-label" title="${esc(c.category)}">${esc(c.category)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(c.count / maxCat) * 100}%" tabindex="0" data-tip="${esc(c.category)}: ${App.plural(c.count, 'booking')}"></div></div>
      <span class="bar-value">${c.count}</span></div>`).join('')}</div>`;

  const rank = (items, render) => items.length ? `<ol class="rank-list">${items.map((it, i) => `<li><span class="rank-num">${i + 1}</span>${render(it)}</li>`).join('')}</ol>`
    : App.emptyState('fa-chart-simple', 'No data yet.');
  document.getElementById('topTools').innerHTML = rank(data.topTools, it =>
    `<div class="cell-stack"><strong>${esc(it.name)}</strong><small>by ${esc(it.owner)}</small></div><span class="rank-value">${App.plural(it.n, 'booking')}</span>`);
  document.getElementById('lowestTrust').innerHTML = rank(data.lowestTrust, it =>
    `<strong class="link" data-user-id="${it.id}">${esc(it.name)}</strong><span class="rank-value">${App.trustBadge(it.n)}</span>`);

  document.getElementById('overdueBody').innerHTML = data.overdue.length ? data.overdue.map(l => `
    <tr data-loan-id="${l.id}">
      <td><div class="tool-cell"><div class="thumb">${App.toolImage(l.tool.image, { small: true, category: l.tool.category })}</div><div class="cell-stack"><span class="tool-name">${esc(l.tool.name)}</span><small>${esc(l.ref)}</small></div></div></td>
      <td><span class="link" data-user-id="${l.borrower.id}">${esc(l.borrower.name)}</span><div class="muted">${esc(l.borrower.phone || '')}</div></td>
      <td>${esc(l.owner.name)}</td>
      <td class="date-cell"><strong>${App.fmtDate(l.endDate)}</strong></td>
      <td>${App.daysPill(l)}</td>
      <td><button type="button" class="btn-sm" data-act="details"><i class="fa-solid fa-file-lines"></i> Details</button></td>
    </tr>`).join('') : `<tr><td colspan="6">${App.emptyState('fa-circle-check', 'No overdue items. Everything is on time.')}</td></tr>`;

  document.getElementById('reportBody').addEventListener('click', e => {
    const tr = e.target.closest('[data-loan-id]');
    if (tr && e.target.closest('[data-act="details"]')) App.showLoanDetail(Number(tr.dataset.loanId));
  });
  document.getElementById('printBtn').addEventListener('click', () => window.print());
});
