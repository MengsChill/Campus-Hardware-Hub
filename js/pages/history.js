/* ============================================================
   History & Reviews – finished bookings on both sides
   ============================================================ */

App.ready(async () => {
  const list = document.getElementById('historyList');
  const tabs = document.getElementById('historyTabs');
  const data = { borrowed: [], lent: [] };
  let current = 'borrowed';

  function render() {
    tabs.querySelectorAll('[data-tab]').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === current);
      t.querySelector('.tab-count').textContent = data[t.dataset.tab].length;
    });
    const loans = data[current];
    list.innerHTML = loans.length ? loans.map(loanCard).join('')
      : `<div class="empty-card">${App.emptyState('fa-clock-rotate-left', current === 'borrowed' ? 'No finished bookings as a borrower yet.' : 'No finished bookings as a lender yet.')}</div>`;
  }

  async function load() {
    list.innerHTML = App.loading();
    try {
      const [borrowed, lent] = await Promise.all([App.api('/api/loans?as=borrower&status=history'), App.api('/api/loans?as=owner&status=history')]);
      data.borrowed = borrowed.loans;
      data.lent = lent.loans;
      render();
    } catch (err) { list.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  tabs.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { current = t.dataset.tab; render(); } });
  bindLoanActions(list, () => data[current], load);
  load();
});
