/* ============================================================
   Disputes (Module 5) – students see their own cases,
   admins see every case and make decisions.
   ============================================================ */

const DISPUTE_STATUS = {
  open:      ['badge-orange', 'Open – awaiting admin'],
  resolved:  ['badge-blue',   'Resolved'],
  dismissed: ['badge-gray',   'Dismissed'],
  settled:   ['badge-green',  'Settled'],
};
const disputeBadge = s => `<span class="badge ${DISPUTE_STATUS[s][0]}">${DISPUTE_STATUS[s][1]}</span>`;
const DISPUTE_EVENTS = { filed: 'Claim filed', statement: 'Statement added', resolved: 'Resolved by admin', dismissed: 'Dismissed by admin', settled: 'Closed as settled' };

App.ready(async user => {
  const { esc } = App;
  const isAdmin = user.role === 'admin';
  const list = document.getElementById('disputeList');
  const tabs = document.getElementById('disputeTabs');
  let disputes = [];
  let filter = 'open';

  function card(d) {
    const myRole = d.viewerRole;
    return `
      <article class="loan-card ${d.status === 'open' ? 'overdue' : ''}" data-dispute-id="${d.id}">
        <div class="dispute-icon"><i class="fa-solid ${d.type === 'damage' ? 'fa-hammer' : d.type === 'lost' ? 'fa-magnifying-glass' : 'fa-clock'}"></i></div>
        <div>
          <div class="loan-card-head"><span class="loan-card-title">${esc(d.typeName)}</span>${disputeBadge(d.status)}</div>
          <div class="loan-meta">
            <span><i class="fa-solid fa-toolbox"></i>${esc(d.tool.name)}</span>
            <span>Lender: <strong data-user-id="${d.owner.id}" class="link">${esc(d.owner.name)}</strong></span>
            <span>Borrower: <strong data-user-id="${d.borrower.id}" class="link">${esc(d.borrower.name)}</strong> ${App.trustBadge(d.borrower.trustPoints)}</span>
            <span><i class="fa-solid fa-money-bill"></i>Claim ${App.money(d.claimAmount)} of ${App.money(d.loan.deposit)}</span>
            <span><i class="fa-solid fa-hashtag"></i>${esc(d.ref)} · ${esc(d.loan.ref)}</span>
          </div>
          <p class="loan-hint">${esc(d.description.length > 180 ? d.description.slice(0, 180) + '…' : d.description)}</p>
          ${d.decision ? `<div class="loan-message owner"><strong>Decision:</strong> ${App.money(d.decision.deduction)} to the lender${d.decision.penaltyPoints ? ` · −${d.decision.penaltyPoints} Trust Points` : ''} – ${esc(d.decision.note)}</div>` : ''}
          ${!isAdmin && d.status === 'open' ? `<p class="loan-hint"><i class="fa-solid fa-circle-info"></i> ${myRole === 'borrower' ? 'Add your side of the story and any photos as evidence.' : 'An admin will review the evidence. You can add more details.'}</p>` : ''}
        </div>
        <div class="loan-actions">
          <button type="button" class="btn-sm ${isAdmin && d.status === 'open' ? 'primary' : ''}" data-open><i class="fa-solid ${isAdmin && d.status === 'open' ? 'fa-gavel' : 'fa-folder-open'}"></i> ${isAdmin && d.status === 'open' ? 'Review & decide' : 'View case'}</button>
        </div>
      </article>`;
  }

  function render() {
    const groups = { open: disputes.filter(d => d.status === 'open'), closed: disputes.filter(d => d.status !== 'open'), all: disputes };
    tabs.innerHTML = [['open', 'Open'], ['closed', 'Decided'], ['all', 'All']].map(([k, l]) =>
      `<button type="button" class="tab ${k === filter ? 'active' : ''}" data-tab="${k}">${l} <span class="tab-count">${groups[k].length}</span></button>`).join('');
    list.innerHTML = groups[filter].length ? groups[filter].map(card).join('')
      : `<div class="empty-card">${App.emptyState('fa-scale-balanced', filter === 'open' ? 'No open disputes.' : 'No disputes here.')}</div>`;
  }

  async function load() {
    list.innerHTML = App.loading();
    try { ({ disputes } = await App.api('/api/disputes')); render(); }
    catch (err) { list.innerHTML = App.emptyState('fa-circle-exclamation', err.message); }
  }

  async function openCase(id) {
    const m = App.modal({ title: 'Dispute case', icon: 'fa-scale-balanced', size: 'lg', body: App.loading() });
    let statementPhotos;
    const draw = async () => {
      let d;
      try { ({ dispute: d } = await App.api(`/api/disputes/${id}`)); } catch (err) { m.body.innerHTML = App.emptyState('fa-circle-exclamation', err.message); return; }
      const penalty = d.penaltyRules[d.type];
      m.body.innerHTML = `
        <div class="detail-layout">
          <div>
            <span class="loan-ref">${esc(d.ref)} · booking ${esc(d.loan.ref)}</span>
            <div class="detail-title">${esc(d.typeName)}</div>
            <div class="btn-row" style="margin-bottom:12px;">${disputeBadge(d.status)}</div>
            <dl class="info-list">
              <dt><i class="fa-solid fa-toolbox"></i> Item</dt><dd>${esc(d.tool.name)}</dd>
              <dt><i class="fa-solid fa-user-tie"></i> Lender</dt><dd>${esc(d.owner.name)}</dd>
              <dt><i class="fa-solid fa-user"></i> Borrower</dt><dd>${esc(d.borrower.name)} ${App.trustBadge(d.borrower.trustPoints)}</dd>
              <dt><i class="fa-solid fa-calendar"></i> Rental</dt><dd>${App.fmtDate(d.loan.startDate)} → ${App.fmtDate(d.loan.endDate)}</dd>
              <dt><i class="fa-solid fa-money-bill"></i> Claim</dt><dd>${App.money(d.claimAmount)} <span class="muted">of ${App.money(d.loan.deposit)} deposit</span></dd>
              <dt><i class="fa-solid fa-lock"></i> In escrow</dt><dd>${App.money(d.heldDeposit)}</dd>
            </dl>
            <h4 class="section-title">Lender's claim</h4>
            <div class="loan-message">${esc(d.description)}</div>
            <h4 class="section-title">Evidence photos (${d.evidence.length})</h4>
            ${d.evidence.length ? `<div class="evidence-grid">${d.evidence.map(e => `<a href="${esc(e.url)}" target="_blank" rel="noopener" title="Uploaded by ${esc(e.by)}"><img src="${esc(e.url)}" alt="Evidence from ${esc(e.by)}" /><span>${esc(e.by)}</span></a>`).join('')}</div>` : '<p class="muted" style="font-size:13px;">No photos attached.</p>'}
            ${d.returnPhoto ? `<h4 class="section-title">Borrower's condition photo at return</h4><div class="photo-frame"><img src="${esc(d.returnPhoto)}" alt="Return condition photo" /></div>${d.returnNote ? `<div class="loan-message">${esc(d.returnNote)}</div>` : ''}` : ''}
          </div>
          <div>
            <h4 class="section-title" style="margin-top:0;">Statements</h4>
            ${d.statements.length ? `<ul class="statement-list">${d.statements.map(s => `<li class="${s.side.toLowerCase()}">
              <div class="statement-head"><strong>${esc(s.by)}</strong><span class="badge ${s.side === 'Lender' ? 'badge-blue' : 'badge-purple'}">${s.side}</span><span class="muted">${App.fmtDateTime(s.createdAt)}</span></div>
              <p>${esc(s.body)}</p></li>`).join('')}</ul>` : '<p class="muted" style="font-size:13px;">No statements yet.</p>'}
            ${d.canAddStatement ? `
              <form id="statementForm" class="statement-form">
                <label for="stBody">${d.viewerRole === 'borrower' ? 'Your side of the story' : 'Add more details'}</label>
                <textarea id="stBody" class="form-control" rows="3" maxlength="1500" placeholder="Explain what happened…"></textarea>
                <span class="error-msg" id="statementErr"></span>
                <div id="stPhotos" style="margin-top:8px;"></div>
                <button type="submit" class="btn-primary" style="margin-top:10px;"><span class="btn-text">Submit statement</span></button>
              </form>` : ''}
            ${d.decision ? `<h4 class="section-title">Decision</h4>
              <div class="notice ${d.status === 'dismissed' ? 'info' : 'success'}"><i class="fa-solid fa-gavel"></i><div>
                <strong>${DISPUTE_STATUS[d.status][1]} by ${esc(d.decision.by || 'admin')} · ${App.fmtDate(d.decision.at)}</strong>
                ${App.money(d.decision.deduction)} paid to the lender from the deposit${d.decision.penaltyPoints ? `, −${d.decision.penaltyPoints} Trust Points for the borrower` : ', no Trust Point penalty'}.<br>${esc(d.decision.note)}</div></div>` : ''}
            ${isAdmin && d.status === 'open' ? `
              <h4 class="section-title">Admin decision</h4>
              <form id="decisionForm" class="decision-form">
                <div class="form-group"><label for="decDeduction">Deduct from deposit (RM)</label>
                  <input id="decDeduction" type="number" class="form-control" min="0" max="${d.heldDeposit / 100}" step="0.01" value="${(Math.min(d.claimAmount, d.heldDeposit) / 100).toFixed(2)}" />
                  <span class="field-hint">Between RM 0 and ${App.money(d.heldDeposit)}. The rest is refunded to the borrower.</span>
                  <span class="error-msg" id="decDeductionErr"></span></div>
                <label class="checkbox-label" style="margin-bottom:12px;align-items:flex-start;"><input type="checkbox" id="decViolation" /><span class="checkmark" style="margin-top:2px;"></span><span>Violation confirmed – deduct <strong>${penalty} Trust Points</strong> from ${esc(d.borrower.name)} (${d.borrower.trustPoints} → ${d.borrower.trustPoints - penalty})</span></label>
                <div class="form-group"><label for="decNote">Decision note (shown to both parties)</label>
                  <textarea id="decNote" class="form-control" rows="2" maxlength="500" placeholder="e.g. Photos show damage that was not present at handover."></textarea>
                  <span class="error-msg" id="decNoteErr"></span></div>
                <div class="btn-row">
                  <button type="button" class="btn-primary" data-decide="resolve"><i class="fa-solid fa-gavel"></i> Resolve</button>
                  <button type="button" class="btn-secondary" data-decide="settle"><i class="fa-solid fa-handshake"></i> Close as settled</button>
                  <button type="button" class="btn-secondary" style="color:#DC2626;" data-decide="dismiss"><i class="fa-solid fa-ban"></i> Dismiss claim</button>
                </div>
                <p class="field-hint" style="margin-top:8px;"><strong>Resolve</strong>: your decision, penalty applies if ticked. <strong>Settled</strong>: both parties agreed, no penalty. <strong>Dismiss</strong>: invalid claim, full deposit refunded.</p>
              </form>` : ''}
            <h4 class="section-title">Case history</h4>
            <ul class="timeline">${d.history.map(h => `<li class="${['resolved', 'dismissed', 'settled'].includes(h.action) ? 'good' : h.action === 'filed' ? 'bad' : ''}">
              <div class="tl-title">${esc(DISPUTE_EVENTS[h.action] || h.action)}</div>
              <div class="tl-time">${App.fmtDateTime(h.createdAt)} · ${esc(h.actor || 'System')}</div>${h.note ? `<div class="tl-note">${esc(h.note)}</div>` : ''}</li>`).join('')}</ul>
          </div>
        </div>`;

      const stForm = m.el.querySelector('#statementForm');
      if (stForm) {
        statementPhotos = App.photoManager(m.el.querySelector('#stPhotos'), { max: 4, title: 'Add photo', maxDim: 1400 });
        stForm.addEventListener('submit', async e => {
          e.preventDefault();
          await App.withLoading(stForm.querySelector('button[type=submit]'), async () => {
            try {
              const res = await App.api(`/api/disputes/${id}/statements`, { body: stForm.querySelector('#stBody').value.trim(), evidence: statementPhotos.value().map(p => p.data) });
              showToast(res.message, 'success');
              draw();
            } catch (err) { if (!App.showFieldErrors(err)) showToast(err.message, 'error'); }
          });
        });
      }

      m.el.querySelectorAll('[data-decide]').forEach(btn => btn.addEventListener('click', async () => {
        const action = btn.dataset.decide;
        const form = m.el.querySelector('#decisionForm');
        App.clearFieldErrors(form);
        const body = {
          note: form.querySelector('#decNote').value.trim(),
          deduction: action === 'dismiss' ? 0 : Number(form.querySelector('#decDeduction').value),
          violation: action === 'resolve' && form.querySelector('#decViolation').checked,
        };
        const summary = action === 'dismiss'
          ? `Dismiss this claim? The full ${App.money(d.heldDeposit)} deposit is refunded to ${d.borrower.name}.`
          : `${App.money(body.deduction * 100)} goes to ${d.owner.name} and ${App.money(d.heldDeposit - body.deduction * 100)} is refunded to ${d.borrower.name}.${body.violation ? ` ${penalty} Trust Points will be deducted.` : ''}`;
        if (!await App.confirm({ title: 'Confirm decision', icon: 'fa-gavel', confirmText: 'Confirm', message: summary })) return;
        try {
          const res = await App.api(`/api/disputes/${id}/${action}`, body);
          showToast(res.message, 'success');
          App.refreshCounts();
          draw();
          load();
        } catch (err) { if (!App.showFieldErrors(err, { deduction: 'decDeduction', note: 'decNote' })) showToast(err.message, 'error'); }
      }));
    };
    draw();
  }

  tabs.addEventListener('click', e => { const t = e.target.closest('[data-tab]'); if (t) { filter = t.dataset.tab; render(); } });
  list.addEventListener('click', e => {
    if (e.target.closest('[data-user-id]')) return;
    const card = e.target.closest('[data-dispute-id]');
    if (card) openCase(Number(card.dataset.disputeId));
  });
  await load();
  const deep = new URLSearchParams(location.search).get('id');
  if (deep) openCase(Number(deep));
});
