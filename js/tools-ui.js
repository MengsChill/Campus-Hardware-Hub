/* ============================================================
   Shared listing UI: catalog cards and the listing-detail modal
   (photos, specs, reviews and the booking form → checkout).
   ============================================================ */

function toolTile(tool) {
  const { esc } = App;
  return `
    <button type="button" class="tool-tile" data-tool-id="${tool.id}" aria-label="View ${esc(tool.name)}">
      <div class="tool-media">
        ${App.toolImage(tool.image, { alt: tool.name })}
        ${App.availabilityBadge(tool)}
        ${tool.isMine ? '<span class="mine-tag">Your listing</span>' : ''}
      </div>
      <div class="tool-tile-body">
        <div class="tool-tile-cat">${esc(tool.categoryName)}</div>
        <div class="tool-tile-name">${esc(tool.name)}</div>
        <div class="tool-price"><strong>${App.money(tool.dailyRate)}</strong><span>/day</span><small>Deposit ${App.money(tool.deposit)}</small></div>
        <div class="tool-tile-meta">
          <span><i class="fa-solid fa-location-dot"></i> ${esc(tool.location)}</span>
          <span><i class="fa-solid fa-star-half-stroke"></i> ${esc(tool.conditionName)} · up to ${App.plural(tool.maxDays, 'day')}</span>
        </div>
        <div class="tool-tile-footer">
          <span class="owner-chip" data-user-id="${tool.owner.id}">${App.avatar(tool.owner, 'sm')}<span>${esc(tool.owner.name)}</span></span>
          ${App.stars(tool.rating.average, { count: tool.rating.count, size: 'sm' })}
        </div>
      </div>
    </button>`;
}

function bindToolTiles(root, onChange) {
  root.addEventListener('click', e => {
    const tile = e.target.closest('[data-tool-id]');
    if (tile) openToolDetail(Number(tile.dataset.toolId), { onChange });
  });
}

async function openToolDetail(toolId, { onChange } = {}) {
  const { esc } = App;
  const user = App.user;
  const m = App.modal({ title: 'Hardware details', icon: 'fa-toolbox', size: 'lg', body: App.loading() });

  let tool, eligibility = null;
  const load = async () => {
    [{ tool }, eligibility] = await Promise.all([
      App.api(`/api/tools/${toolId}`),
      user.role === 'student' ? App.api('/api/loans/eligibility') : Promise.resolve(null),
    ]);
  };
  try { await load(); } catch (err) { m.body.innerHTML = App.emptyState('fa-circle-exclamation', err.message); return; }

  const maxDays = Math.min(tool.maxDays, eligibility?.maxLoanDays || 14);
  const notice = (type, icon, html) => `<div class="notice ${type}"><i class="fa-solid ${icon}"></i><div>${html}</div></div>`;
  const booked = tool.bookedRanges.length
    ? `<p class="field-hint" style="margin-bottom:10px;"><i class="fa-solid fa-calendar-xmark"></i> Already booked: ${tool.bookedRanges.map(r => `${App.fmtDate(r.start)} → ${App.fmtDate(r.end)}`).join(', ')}</p>` : '';

  let panel;
  if (user.role === 'admin') {
    panel = notice('info', 'fa-user-shield', '<strong>Admin view</strong>Admins moderate listings and cannot book hardware.') +
      (tool.status !== 'removed' ? `<button type="button" class="btn-secondary btn-full" id="adminRemoveTool" style="margin-top:12px;color:#DC2626;"><i class="fa-solid fa-ban"></i> Remove this listing</button>` : '');
  } else if (tool.isMine) {
    panel = notice('info', 'fa-circle-info', '<strong>This is your listing</strong>Edit it or manage bookings from <a href="my-tools.html" style="font-weight:700;text-decoration:underline;">My Listings</a>.');
  } else if (tool.availability === 'removed') {
    panel = notice('danger', 'fa-ban', '<strong>Removed</strong>This listing is no longer offered.');
  } else if (tool.availability === 'maintenance') {
    panel = notice('warning', 'fa-wrench', '<strong>Under maintenance</strong>The lender is servicing this item. Check back later.');
  } else if (tool.myBooking) {
    panel = notice('info', 'fa-hourglass-half', `<strong>You already booked this item</strong>${esc(App.statusLabel(tool.myBooking.status))} · ${App.fmtDate(tool.myBooking.startDate)} → ${App.fmtDate(tool.myBooking.endDate)}. <a href="${tool.myBooking.status === 'awaiting_payment' ? `checkout.html?booking=${tool.myBooking.id}` : 'my-loans.html'}" style="font-weight:700;text-decoration:underline;">${tool.myBooking.status === 'awaiting_payment' ? 'Complete payment' : 'View in My Bookings'}</a>`);
  } else if (eligibility?.blocked) {
    panel = notice('danger', 'fa-circle-exclamation', `<strong>You can't book right now</strong>${esc(eligibility.blocked)}`);
  } else {
    const start = App.addDays(App.todayStr(), 1);
    panel = `
      <form id="bookForm" novalidate>
        <h4><i class="fa-solid fa-calendar-plus" style="color:var(--blue-primary);"></i> Book this item</h4>
        ${booked}
        <div class="form-grid">
          <div class="form-group">
            <label for="bkStart">Pick-up date</label>
            <input type="date" id="bkStart" class="form-control" min="${App.todayStr()}" max="${App.addDays(App.todayStr(), eligibility.maxStartAheadDays)}" value="${start}" />
            <span class="error-msg" id="bkStartErr"></span>
          </div>
          <div class="form-group">
            <label for="bkEnd">Return date</label>
            <input type="date" id="bkEnd" class="form-control" />
            <span class="error-msg" id="bkEndErr"></span>
          </div>
          <div class="form-group">
            <label for="bkTime">Proposed handover time</label>
            <input type="datetime-local" id="bkTime" class="form-control" step="900" />
            <span class="error-msg" id="bkTimeErr"></span>
          </div>
          <div class="form-group">
            <label for="bkPlace">Handover place</label>
            <input id="bkPlace" class="form-control" maxlength="120" value="${esc(tool.location)}" />
            <span class="error-msg" id="bkPlaceErr"></span>
          </div>
        </div>
        <div class="form-group">
          <label for="bkMessage">Message to ${esc(tool.owner.name.split(' ')[0])} <span class="char-count" id="bkCount">0/500</span></label>
          <textarea id="bkMessage" class="form-control" rows="2" maxlength="500" placeholder="What will you use it for?"></textarea>
          <span class="error-msg" id="bkMessageErr"></span>
        </div>
        <div id="bkCost"></div>
        <button type="submit" class="btn-primary btn-full" id="bkSubmit" style="margin-top:12px;"><span class="btn-text">Continue to Payment</span> <i class="fa-solid fa-lock btn-icon"></i></button>
        <p class="field-hint" style="text-align:center;margin-top:8px;"><i class="fa-solid fa-shield-halved"></i> Your payment is held in escrow. Full refund if the lender declines or either side cancels before handover.</p>
      </form>`;
  }

  m.body.innerHTML = `
    <div class="detail-layout">
      <div>
        ${App.gallery(tool.photos, tool.name)}
        <h4 class="section-title">Reviews of this item ${App.stars(tool.rating.average, { count: tool.rating.count, size: 'sm' })}</h4>
        <div id="toolReviews">${App.reviewList(tool.reviews, 'No reviews for this item yet.')}</div>
      </div>
      <div>
        <div class="tool-tile-cat">${esc(tool.categoryName)}</div>
        <div class="detail-title">${esc(tool.name)}</div>
        <div class="btn-row" style="margin-bottom:12px;">${App.availabilityBadge(tool)}</div>
        <div class="tool-price lg"><strong>${App.money(tool.dailyRate)}</strong><span>/day</span><small>Security deposit ${App.money(tool.deposit)} (refundable)</small></div>
        <p class="detail-desc">${esc(tool.description)}</p>
        ${tool.specs ? `<h4 class="section-title" style="margin-top:0;">Specifications</h4><ul class="spec-list">${tool.specs.split('\n').filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        <dl class="info-list">
          <dt><i class="fa-solid fa-user"></i> Lender</dt><dd><span class="owner-chip" data-user-id="${tool.owner.id}" style="cursor:pointer;">${App.avatar(tool.owner, 'sm')}<span>${esc(tool.owner.name)}</span></span> ${App.trustBadge(tool.owner.trustPoints)}</dd>
          <dt><i class="fa-solid fa-star"></i> Lender rating</dt><dd>${App.stars(tool.owner.rating.average, { count: tool.owner.rating.count, size: 'sm' })}</dd>
          <dt><i class="fa-solid fa-star-half-stroke"></i> Condition</dt><dd>${esc(tool.conditionName)}</dd>
          <dt><i class="fa-solid fa-location-dot"></i> Pick-up</dt><dd>${esc(tool.location)}</dd>
          <dt><i class="fa-solid fa-calendar-days"></i> Max rental</dt><dd>${App.plural(tool.maxDays, 'day')}</dd>
          ${tool.removedReason ? `<dt><i class="fa-solid fa-ban"></i> Removed</dt><dd>${esc(tool.removedReason)}</dd>` : ''}
        </dl>
        <div class="request-panel">${panel}</div>
      </div>
    </div>`;

  App.bindReviewModeration(m.el.querySelector('#toolReviews'), async () => {
    await load();
    m.el.querySelector('#toolReviews').innerHTML = App.reviewList(tool.reviews, 'No reviews for this item yet.');
  });
  m.el.querySelector('#adminRemoveTool')?.addEventListener('click', async () => {
    if (await removeToolAsAdmin(tool)) { m.close(); onChange?.(); }
  });

  const form = m.el.querySelector('#bookForm');
  if (!form) return;
  const startEl = form.querySelector('#bkStart');
  const endEl = form.querySelector('#bkEnd');
  const timeEl = form.querySelector('#bkTime');
  const message = form.querySelector('#bkMessage');

  const sync = () => {
    if (!startEl.value) return;
    endEl.min = App.addDays(startEl.value, 1);
    endEl.max = App.addDays(startEl.value, maxDays);
    if (!endEl.value || endEl.value < endEl.min || endEl.value > endEl.max) endEl.value = App.addDays(startEl.value, Math.min(3, maxDays));
    timeEl.min = `${App.addDays(startEl.value, -1)}T00:00`;
    timeEl.max = `${startEl.value}T23:59`;
    if (!timeEl.value || timeEl.value.slice(0, 10) !== startEl.value && timeEl.value.slice(0, 10) !== App.addDays(startEl.value, -1)) timeEl.value = `${startEl.value}T10:00`;
    const days = App.daysBetween(startEl.value, endEl.value);
    const rental = tool.dailyRate * days;
    form.querySelector('#bkCost').innerHTML = days > 0 ? App.costTable({
      days, timestamps: {}, cost: { dailyRate: tool.dailyRate, rental, deposit: tool.deposit, total: rental + tool.deposit },
    }) : '';
  };
  [startEl, endEl].forEach(el => el.addEventListener('change', sync));
  message.addEventListener('input', () => { form.querySelector('#bkCount').textContent = `${message.value.length}/500`; });
  sync();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    App.clearFieldErrors(form);
    if (message.value.trim().length < 5) { setError('bkMessage', 'Tell the lender briefly what you need it for.'); message.focus(); return; }
    await App.withLoading(form.querySelector('#bkSubmit'), async () => {
      try {
        const res = await App.api('/api/loans', {
          toolId: tool.id, startDate: startEl.value, endDate: endEl.value,
          handoverTime: timeEl.value, handoverLocation: form.querySelector('#bkPlace').value.trim(), message: message.value.trim(),
        });
        window.location.href = `checkout.html?booking=${res.loan.id}`;
      } catch (err) {
        if (!App.showFieldErrors(err, { startDate: 'bkStart', endDate: 'bkEnd', handoverTime: 'bkTime', handoverLocation: 'bkPlace', message: 'bkMessage' })) showToast(err.message, 'error');
      }
    });
  });
}

async function removeToolAsAdmin(tool) {
  const reason = await App.confirm({
    title: 'Remove listing', danger: true, confirmText: 'Remove Listing',
    message: `Remove "${tool.name}" posted by ${tool.owner.name}? Unconfirmed bookings will be declined and refunded, and the owner will be notified.`,
    input: { label: 'Reason shown to the owner', placeholder: 'e.g. Item not allowed on campus / misleading description', required: true, minLength: 5 },
  });
  if (!reason) return false;
  try {
    const res = await App.api(`/api/tools/${tool.id}`, { reason }, 'DELETE');
    showToast(res.message, 'success');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}
