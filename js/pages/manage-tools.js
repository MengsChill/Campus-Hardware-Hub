/* ============================================================
   Admin – Manage Tools (moderate posts)
   ============================================================ */

App.ready(async () => {
  const { esc } = App;
  const body = document.getElementById('toolsBody');
  const search = document.getElementById('searchInput');
  const status = document.getElementById('statusFilter');
  const category = document.getElementById('categoryFilter');
  let tools = [];

  try {
    const meta = await App.api('/api/tools/meta');
    category.insertAdjacentHTML('beforeend', Object.entries(meta.categories).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
  } catch { /* optional */ }

  function row(tool) {
    return `
      <tr data-id="${tool.id}">
        <td><div class="tool-cell"><div class="thumb">${App.toolImage(tool.image, { small: true, category: tool.category })}</div>
          <div class="cell-stack"><span class="tool-name">${esc(tool.name)}</span><small>${esc(tool.categoryName)}</small></div></div></td>
        <td><div class="owner-chip" data-user-id="${tool.owner.id}" style="cursor:pointer;">${App.avatar(tool.owner, 'sm')}<span>${esc(tool.owner.name)}</span></div></td>
        <td>${App.availabilityBadge(tool)}${tool.removedReason ? `<div class="muted" style="margin-top:4px;white-space:normal;max-width:220px;">${esc(tool.removedReason)}</div>` : ''}</td>
        <td>${App.money(tool.dailyRate)}<div class="muted">dep. ${App.money(tool.deposit)}</div></td>
        <td>${App.stars(tool.rating.average, { count: tool.rating.count, size: 'sm' })}</td>
        <td class="date-cell">${App.fmtDate(tool.createdAt)}</td>
        <td><div class="btn-row">
          <button type="button" class="btn-sm" data-act="view"><i class="fa-solid fa-eye"></i> View</button>
          ${tool.status !== 'removed' ? `<button type="button" class="btn-sm danger" data-act="remove"><i class="fa-solid fa-ban"></i> Remove</button>` : ''}
        </div></td>
      </tr>`;
  }

  async function load() {
    body.innerHTML = `<tr><td colspan="7">${App.loading()}</td></tr>`;
    const query = new URLSearchParams({ scope: 'all', q: search.value.trim(), status: status.value, category: category.value });
    try {
      ({ tools } = await App.api('/api/tools?' + query));
      document.getElementById('resultCount').textContent = App.plural(tools.length, 'tool');
      body.innerHTML = tools.length ? tools.map(row).join('') : `<tr><td colspan="7">${App.emptyState('fa-box-open', 'No tools match these filters.')}</td></tr>`;
    } catch (err) {
      body.innerHTML = `<tr><td colspan="7">${App.emptyState('fa-circle-exclamation', err.message)}</td></tr>`;
    }
  }

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tool = tools.find(t => t.id === Number(btn.closest('[data-id]').dataset.id));
    if (btn.dataset.act === 'view') openToolDetail(tool.id, { onChange: load });
    if (btn.dataset.act === 'remove' && await removeToolAsAdmin(tool)) load();
  });

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  [status, category].forEach(el => el.addEventListener('change', load));
  load();
});
