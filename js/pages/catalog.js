/* ============================================================
   Browse Hardware (Module 2 – read, search, filter)
   ============================================================ */

App.ready(async user => {
  const params = new URLSearchParams(location.search);
  const grid = document.getElementById('toolGrid');
  const el = id => document.getElementById(id);
  const search = el('searchInput'), category = el('categoryFilter'), condition = el('conditionFilter');
  const maxRate = el('maxRate'), availability = el('availabilityFilter'), sort = el('sortBy');

  search.value = params.get('q') || '';
  if (user.role === 'student') el('postToolBtn').hidden = false;

  try {
    const meta = await App.api('/api/tools/meta');
    category.insertAdjacentHTML('beforeend', Object.entries(meta.categories).map(([k, v]) => `<option value="${k}">${App.esc(v)}</option>`).join(''));
    condition.insertAdjacentHTML('beforeend', Object.entries(meta.conditions).map(([k, v]) => `<option value="${k}">${App.esc(v)}</option>`).join(''));
    if (params.get('category')) category.value = params.get('category');
  } catch { /* filters still work */ }

  async function load() {
    grid.innerHTML = App.loading('Loading hardware…');
    const query = new URLSearchParams({ q: search.value.trim(), category: category.value, condition: condition.value, availability: availability.value, sort: sort.value });
    if (maxRate.value) query.set('maxRate', maxRate.value);
    try {
      const { tools } = await App.api('/api/tools?' + query);
      el('resultCount').textContent = App.plural(tools.length, 'item');
      const filtered = search.value || category.value || condition.value || maxRate.value || availability.value;
      grid.innerHTML = tools.length ? tools.map(toolTile).join('')
        : `<div class="empty-card" style="grid-column:1/-1;">${App.emptyState('fa-box-open', filtered ? 'No hardware matches your filters.' : 'No hardware has been listed yet.',
            user.role === 'student' ? '<a href="my-tools.html?new=1" class="btn-primary"><i class="fa-solid fa-plus"></i> List your hardware</a>' : '')}</div>`;
    } catch (err) { grid.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  let timer;
  [search, maxRate].forEach(i => i.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); }));
  [category, condition, availability, sort].forEach(i => i.addEventListener('change', load));
  el('clearFilters').addEventListener('click', () => {
    [search, category, condition, maxRate, availability].forEach(i => { i.value = ''; });
    sort.value = 'newest';
    load();
  });
  bindToolTiles(grid, load);
  await load();
  if (params.get('tool')) openToolDetail(Number(params.get('tool')), { onChange: load });
});
