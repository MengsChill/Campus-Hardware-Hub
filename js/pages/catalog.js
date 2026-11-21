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

  const PAGE_SIZE = 24;
  let shown = 0;
  let total = 0;
  let requestId = 0;

  function currentQuery() {
    const query = new URLSearchParams({ q: search.value.trim(), category: category.value, condition: condition.value, availability: availability.value, sort: sort.value, limit: PAGE_SIZE });
    if (maxRate.value) query.set('maxRate', maxRate.value);
    return query;
  }

  async function load() {
    const id = ++requestId;
    grid.innerHTML = App.loading('Loading hardware…');
    el('loadMoreWrap').hidden = true;
    try {
      const { tools, total: count } = await App.api('/api/tools?' + currentQuery());
      if (id !== requestId) return;               // a newer search has started
      total = count;
      shown = tools.length;
      el('resultCount').textContent = App.plural(total, 'item');
      const filtered = search.value || category.value || condition.value || maxRate.value || availability.value;
      grid.innerHTML = tools.length ? tools.map(toolTile).join('')
        : `<div class="empty-card" style="grid-column:1/-1;">${App.emptyState('fa-box-open', filtered ? 'No hardware matches your filters.' : 'No hardware has been listed yet.',
            user.role === 'student' ? '<a href="my-tools.html?new=1" class="btn-primary"><i class="fa-solid fa-plus"></i> List your hardware</a>' : '')}</div>`;
      el('loadMoreWrap').hidden = shown >= total;
    } catch (err) { grid.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  el('loadMoreBtn').addEventListener('click', e => App.withLoading(e.currentTarget, async () => {
    const id = requestId;
    const query = currentQuery();
    query.set('offset', shown);
    try {
      const { tools, total: count } = await App.api('/api/tools?' + query);
      if (id !== requestId) return;
      total = count;
      shown += tools.length;
      grid.insertAdjacentHTML('beforeend', tools.map(toolTile).join(''));
      el('loadMoreWrap').hidden = shown >= total || !tools.length;
    } catch (err) { showToast(err.message, 'error'); }
  }));

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
