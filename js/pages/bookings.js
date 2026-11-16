/* ============================================================
   Admin – All Bookings (oversight, void meetups that never happened)
   ============================================================ */

App.ready(async () => {
  const list = document.getElementById('bookingList');
  const status = document.getElementById('statusFilter');
  const search = document.getElementById('searchInput');
  let loans = [];

  async function load() {
    list.innerHTML = App.loading();
    const query = new URLSearchParams({ as: 'all', status: status.value, q: search.value.trim() });
    try {
      ({ loans } = await App.api('/api/loans?' + query));
      document.getElementById('resultCount').textContent = App.plural(loans.length, 'booking');
      list.innerHTML = loans.length ? loans.map(loanCard).join('') : `<div class="empty-card">${App.emptyState('fa-calendar-xmark', 'No bookings match these filters.')}</div>`;
    } catch (err) { list.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  status.addEventListener('change', load);
  bindLoanActions(list, () => loans, load);
  load();
});
