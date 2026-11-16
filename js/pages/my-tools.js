/* ============================================================
   My Listings (Module 2) – add, edit, maintenance status, remove
   ============================================================ */

App.ready(async () => {
  const { esc } = App;
  const list = document.getElementById('myToolsList');
  let meta = { categories: {}, conditions: {}, maxLoanDays: 14, maxDailyRate: 200, maxDeposit: 2000, maxPhotos: 5 };
  let tools = [];

  try { meta = await App.api('/api/tools/meta'); } catch { /* defaults above */ }

  function card(tool) {
    const onLoan = tool.availability === 'on_loan';
    return `
      <article class="loan-card ${tool.availability === 'available' ? 'highlight' : ''}" data-id="${tool.id}">
        <div class="thumb">${App.toolImage(tool.image, { small: true, alt: tool.name })}</div>
        <div>
          <div class="loan-card-head">
            <span class="loan-card-title">${esc(tool.name)}</span>
            ${App.availabilityBadge(tool)}
            ${tool.pendingCount ? `<a href="requests.html" class="badge badge-orange"><i class="fa-solid fa-inbox"></i> ${App.plural(tool.pendingCount, 'request')}</a>` : ''}
          </div>
          <div class="loan-meta">
            <span><i class="fa-solid fa-money-bill"></i><strong>${App.money(tool.dailyRate)}</strong>/day · deposit ${App.money(tool.deposit)}</span>
            <span><i class="fa-solid fa-tag"></i>${esc(tool.categoryName)}</span>
            <span><i class="fa-solid fa-star-half-stroke"></i>${esc(tool.conditionName)}</span>
            <span><i class="fa-solid fa-location-dot"></i>${esc(tool.location)}</span>
            <span><i class="fa-solid fa-rotate"></i>Rented ${App.plural(tool.timesBorrowed, 'time')}</span>
            ${App.stars(tool.rating.average, { count: tool.rating.count, size: 'sm' })}
          </div>
          <p style="font-size:13px;color:var(--gray-500);">${esc(tool.description.length > 160 ? tool.description.slice(0, 160) + '…' : tool.description)}</p>
          ${!tool.image ? '<p class="field-hint" style="color:#B45309;"><i class="fa-solid fa-camera"></i> Add photos so borrowers can see the item.</p>' : ''}
        </div>
        <div class="loan-actions">
          <button type="button" class="btn-sm primary" data-act="edit"><i class="fa-solid fa-pen"></i> Edit</button>
          ${tool.status === 'maintenance'
            ? '<button type="button" class="btn-sm success" data-act="available"><i class="fa-solid fa-circle-check"></i> Mark available</button>'
            : `<button type="button" class="btn-sm" data-act="maintenance" ${onLoan ? 'disabled title="Item is on loan"' : ''}><i class="fa-solid fa-wrench"></i> Under maintenance</button>`}
          <button type="button" class="btn-sm danger" data-act="remove" ${onLoan ? 'disabled title="Cannot remove while on loan"' : ''}><i class="fa-solid fa-trash"></i> Remove</button>
        </div>
      </article>`;
  }

  async function load() {
    list.innerHTML = App.loading('Loading your listings…');
    try {
      ({ tools } = await App.api('/api/tools?scope=mine'));
      document.getElementById('toolCount').textContent = App.plural(tools.length, 'listing');
      list.innerHTML = tools.length ? tools.map(card).join('')
        : `<div class="empty-card">${App.emptyState('fa-toolbox', "You haven't listed any hardware yet. Rent out tools you own and earn from them.",
            '<button type="button" class="btn-primary" data-new-tool><i class="fa-solid fa-plus"></i> Add Your First Listing</button>')}</div>`;
    } catch (err) { list.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  async function openForm(summary = null) {
    let tool = null;
    if (summary) {
      try { ({ tool } = await App.api(`/api/tools/${summary.id}`)); } catch (err) { showToast(err.message, 'error'); return; }
    }
    const options = (obj, selected) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const rm = sen => (sen / 100).toFixed(2);

    const m = App.modal({
      title: tool ? 'Edit listing' : 'Add a listing', icon: tool ? 'fa-pen' : 'fa-plus', size: 'lg',
      body: `
        <form id="toolForm" novalidate>
          <div class="form-group">
            <label>Photos <span class="muted">(up to ${meta.maxPhotos}; the first one is the cover)</span></label>
            <div id="toolPhotos"></div>
            <p class="field-hint">Clear photos of the actual item build trust. Images are resized automatically.</p>
          </div>
          <div class="form-grid">
            <div class="form-group span-2"><label for="tName">Hardware name</label>
              <input id="tName" class="form-control" maxlength="80" placeholder="e.g. Digital Multimeter UT33D" value="${esc(tool?.name || '')}" /><span class="error-msg" id="tNameErr"></span></div>
            <div class="form-group"><label for="tCategory">Category</label>
              <select id="tCategory" class="form-control"><option value="" disabled ${tool ? '' : 'selected'}>Select…</option>${options(meta.categories, tool?.category)}</select><span class="error-msg" id="tCategoryErr"></span></div>
            <div class="form-group"><label for="tCondition">Condition</label>
              <select id="tCondition" class="form-control"><option value="" disabled ${tool ? '' : 'selected'}>Select…</option>${options(meta.conditions, tool?.condition)}</select><span class="error-msg" id="tConditionErr"></span></div>
            <div class="form-group"><label for="tRate">Daily rental rate (RM)</label>
              <input id="tRate" type="number" class="form-control" min="0" max="${meta.maxDailyRate}" step="0.50" value="${tool ? rm(tool.dailyRate) : ''}" placeholder="e.g. 5.00" /><span class="error-msg" id="tRateErr"></span></div>
            <div class="form-group"><label for="tDeposit">Security deposit (RM)</label>
              <input id="tDeposit" type="number" class="form-control" min="0" max="${meta.maxDeposit}" step="1" value="${tool ? rm(tool.deposit) : ''}" placeholder="e.g. 50.00" />
              <span class="field-hint">Refunded to the borrower after a clean return.</span><span class="error-msg" id="tDepositErr"></span></div>
            <div class="form-group span-2"><label for="tDescription">Description <span class="char-count" id="tDescCount">0/1000</span></label>
              <textarea id="tDescription" class="form-control" rows="3" maxlength="1000" placeholder="What's included, accessories, anything borrowers should know…">${esc(tool?.description || '')}</textarea><span class="error-msg" id="tDescriptionErr"></span></div>
            <div class="form-group span-2"><label for="tSpecs">Specifications <span class="muted">(one per line)</span></label>
              <textarea id="tSpecs" class="form-control" rows="3" maxlength="1000" placeholder="e.g. Voltage range 0–600V&#10;Battery: 9V included">${esc(tool?.specs || '')}</textarea></div>
            <div class="form-group"><label for="tLocation">Pick-up location</label>
              <input id="tLocation" class="form-control" maxlength="100" placeholder="e.g. Block A, Engineering Lab 2" value="${esc(tool?.location || '')}" /><span class="error-msg" id="tLocationErr"></span></div>
            <div class="form-group"><label for="tMaxDays">Max rental period</label>
              <select id="tMaxDays" class="form-control">${Array.from({ length: meta.maxLoanDays }, (_, i) => i + 1)
                .map(d => `<option value="${d}" ${d === (tool?.maxDays || 7) ? 'selected' : ''}>${App.plural(d, 'day')}</option>`).join('')}</select></div>
          </div>
          <div id="tPreview"></div>
        </form>`,
      footer: `<button type="button" class="btn-secondary" data-close>Cancel</button>
               <button type="submit" form="toolForm" class="btn-primary" id="tSubmit"><span class="btn-text">${tool ? 'Save Changes' : 'Publish Listing'}</span></button>`,
    });

    const photos = App.photoManager(m.el.querySelector('#toolPhotos'), { photos: tool?.photos || [], max: meta.maxPhotos, title: 'Add photo' });
    const desc = m.el.querySelector('#tDescription');
    const count = () => { m.el.querySelector('#tDescCount').textContent = `${desc.value.length}/1000`; };
    desc.addEventListener('input', count);
    count();
    const preview = () => {
      const rate = Number(m.el.querySelector('#tRate').value) || 0;
      const dep = Number(m.el.querySelector('#tDeposit').value) || 0;
      m.el.querySelector('#tPreview').innerHTML = rate || dep
        ? `<p class="field-hint"><i class="fa-solid fa-calculator"></i> A 3-day booking would cost the borrower <strong>RM ${(rate * 3).toFixed(2)}</strong> rental + <strong>RM ${dep.toFixed(2)}</strong> deposit. You receive the rental fee when you verify the handover PIN.</p>` : '';
    };
    m.el.querySelectorAll('#tRate, #tDeposit').forEach(el => el.addEventListener('input', preview));
    preview();

    m.el.querySelector('#toolForm').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget;
      App.clearFieldErrors(form);
      const payload = {
        name: form.querySelector('#tName').value.trim(), category: form.querySelector('#tCategory').value,
        condition: form.querySelector('#tCondition').value, description: desc.value.trim(), specs: form.querySelector('#tSpecs').value.trim(),
        location: form.querySelector('#tLocation').value.trim(), maxDays: Number(form.querySelector('#tMaxDays').value),
        dailyRate: form.querySelector('#tRate').value, deposit: form.querySelector('#tDeposit').value, photos: photos.value(),
      };
      await App.withLoading(m.el.querySelector('#tSubmit'), async () => {
        try {
          const res = tool ? await App.api(`/api/tools/${tool.id}`, payload, 'PUT') : await App.api('/api/tools', payload);
          m.close();
          showToast(tool ? res.message : `"${res.tool.name}" is now listed in the catalog.`, 'success');
          load();
        } catch (err) {
          const idMap = { name: 'tName', category: 'tCategory', condition: 'tCondition', description: 'tDescription', location: 'tLocation', maxDays: 'tMaxDays', dailyRate: 'tRate', deposit: 'tDeposit' };
          if (!App.showFieldErrors(err, idMap)) showToast(err.message, 'error');
        }
      });
    });
  }

  async function removeTool(tool) {
    return new Promise(resolve => {
      let done = false;
      const m = App.modal({
        title: 'Remove listing', icon: 'fa-trash',
        body: `
          <p style="font-size:14px;color:var(--gray-700);margin-bottom:14px;">Remove "<strong>${esc(tool.name)}</strong>" from the catalog? Unconfirmed bookings will be declined and refunded. Past bookings stay in the history.</p>
          <div class="form-group"><label>Reason</label>
            <div class="choice-group" style="flex-wrap:wrap;">
              ${[['no_longer_offered', 'No longer offered'], ['broken', 'Broken'], ['scrapped', 'Scrapped'], ['other', 'Other']].map(([v, l], i) =>
                `<label class="choice" style="flex:1 1 40%;"><input type="radio" name="rmReason" value="${v}" ${i === 0 ? 'checked' : ''} /> ${l}</label>`).join('')}
            </div></div>
          <div class="form-group" style="margin-bottom:0;"><label for="rmNote">Note <span class="muted">(optional)</span></label>
            <input id="rmNote" class="form-control" maxlength="200" /></div>`,
        footer: `<button type="button" class="btn-secondary" data-close>Cancel</button><button type="button" class="btn-primary btn-danger" id="rmOk">Remove Listing</button>`,
        onClose: () => { if (!done) resolve(false); },
      });
      m.el.querySelector('#rmOk').addEventListener('click', async () => {
        try {
          const res = await App.api(`/api/tools/${tool.id}`, { reasonCode: m.el.querySelector('input[name=rmReason]:checked').value, reason: m.el.querySelector('#rmNote').value.trim() }, 'DELETE');
          showToast(res.message, 'success');
          done = true; m.close(); resolve(true);
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }

  list.addEventListener('click', async e => {
    if (e.target.closest('[data-new-tool]')) return openForm();
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tool = tools.find(t => t.id === Number(btn.closest('[data-id]').dataset.id));
    if (btn.dataset.act === 'edit') return openForm(tool);
    if (btn.dataset.act === 'remove') { if (await removeTool(tool)) { App.refreshCounts(); load(); } return; }
    if (['maintenance', 'available'].includes(btn.dataset.act)) {
      try {
        const res = await App.api(`/api/tools/${tool.id}/status`, { status: btn.dataset.act });
        showToast(res.message, 'success');
        load();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });

  document.getElementById('newToolBtn').addEventListener('click', () => openForm());
  await load();
  if (new URLSearchParams(location.search).get('new')) openForm();
});
