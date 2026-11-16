/* ============================================================
   Lending Requests – bookings for the hardware you listed (lender side)
   ============================================================ */

App.ready(async () => {
  const list = document.getElementById('requestList');
  const tabs = document.getElementById('requestTabs');
  let loans = [];
  let current = new URLSearchParams(location.search).get('tab') || 'action';

  const GROUPS = {
    action: { label: 'Needs action', statuses: ['pending', 'confirmed', 'return_pending'], empty: 'No bookings need your attention right now.' },
    active: { label: 'On loan',      statuses: ['active', 'overdue', 'disputed'],          empty: 'None of your hardware is out on loan.' },
    closed: { label: 'Closed',       statuses: ['completed', 'cancelled', 'declined', 'voided'], empty: 'No closed bookings yet.' },
  };

  function render() {
    tabs.innerHTML = Object.entries(GROUPS).map(([key, g]) => {
      const n = loans.filter(l => g.statuses.includes(l.status)).length;
      return `<button type="button" class="tab ${key === current ? 'active' : ''}" data-tab="${key}">${g.label} <span class="tab-count">${n}</span></button>`;
    }).join('');
    const shown = loans.filter(l => GROUPS[current].statuses.includes(l.status));
    list.innerHTML = shown.length
      ? shown.map(loanCard).join('')
      : `<div class="empty-card">${App.emptyState('fa-inbox', GROUPS[current].empty,
          current === 'action' ? '<a href="my-tools.html" class="btn-primary"><i class="fa-solid fa-toolbox"></i> Manage My Listings</a>' : '')}</div>`;
  }

  async function load() {
    list.innerHTML = App.loading('Loading bookings…');
    try {
      const { loans: data } = await App.api('/api/loans?as=owner');
      loans = data.filter(l => l.status !== 'awaiting_payment');   // unpaid bookings are not shown to lenders
      render();
    } catch (err) { list.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  tabs.addEventListener('click', e => { const tab = e.target.closest('[data-tab]'); if (tab) { current = tab.dataset.tab; render(); } });
  bindLoanActions(list, () => loans, load);
  load();
});
