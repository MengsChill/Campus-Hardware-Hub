/* ============================================================
   My Bookings – hardware you are renting (borrower side)
   ============================================================ */

App.ready(async () => {
  const list = document.getElementById('loanList');
  const tabs = document.getElementById('loanTabs');
  const summary = document.getElementById('loanSummary');
  let loans = [];
  let current = 'all';

  const GROUPS = {
    all:       { label: 'All current', statuses: ['awaiting_payment', 'pending', 'confirmed', 'active', 'overdue', 'return_pending', 'disputed'] },
    unpaid:    { label: 'Unpaid',      statuses: ['awaiting_payment'] },
    pending:   { label: 'Awaiting lender', statuses: ['pending'] },
    confirmed: { label: 'To pick up',  statuses: ['confirmed'] },
    active:    { label: 'On loan',     statuses: ['active', 'overdue'] },
    returning: { label: 'Returned',    statuses: ['return_pending', 'disputed'] },
  };

  function render() {
    tabs.innerHTML = Object.entries(GROUPS).map(([key, g]) => {
      const n = loans.filter(l => g.statuses.includes(l.status)).length;
      return `<button type="button" class="tab ${key === current ? 'active' : ''}" data-tab="${key}">${g.label} <span class="tab-count">${n}</span></button>`;
    }).join('');
    const shown = loans.filter(l => GROUPS[current].statuses.includes(l.status));
    list.innerHTML = shown.length
      ? shown.map(loanCard).join('')
      : `<div class="empty-card">${App.emptyState('fa-calendar-check', current === 'all' ? "You don't have any bookings in progress." : 'Nothing in this list.',
          '<a href="catalog.html" class="btn-primary"><i class="fa-solid fa-magnifying-glass"></i> Browse Hardware</a>')}</div>`;
  }

  async function load() {
    list.innerHTML = App.loading('Loading your bookings…');
    try {
      const [{ loans: data }, eligibility] = await Promise.all([App.api('/api/loans?as=borrower&status=open'), App.api('/api/loans/eligibility')]);
      loans = data;
      const committed = loans.filter(l => ['confirmed', 'active', 'overdue', 'return_pending', 'disputed'].includes(l.status)).length;
      summary.innerHTML = eligibility.blocked
        ? `<div class="notice danger"><i class="fa-solid fa-circle-exclamation"></i><div><strong>Booking is paused</strong>${App.esc(eligibility.blocked)}</div></div>`
        : `<div class="notice info"><i class="fa-solid fa-circle-info"></i><div><strong>${committed} of 3 active bookings used</strong>At pickup, show the lender your 4-digit PIN only after you have checked the item. Return on time to earn +2 Trust Points.</div></div>`;
      render();
    } catch (err) { list.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  tabs.addEventListener('click', e => { const tab = e.target.closest('[data-tab]'); if (tab) { current = tab.dataset.tab; render(); } });
  bindLoanActions(list, () => loans, load);
  load();
});
