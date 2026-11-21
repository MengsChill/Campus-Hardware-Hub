/* ============================================================
   Shared booking UI: booking cards and every workflow action
   (pay, accept, counter-offer, decline, cancel, PIN handover,
   return, inspection, dispute, review, chat, receipt).
   ============================================================ */

function loanCard(loan) {
  const { esc } = App;
  const asLender = loan.viewerRole === 'lender';
  const isAdmin = loan.viewerRole === 'admin';
  const other = asLender ? loan.borrower : loan.owner;
  const a = loan.actions;
  const myTurn = a.accept || a.verifyPin || a.inspect || a.markReturned || a.pay;

  let badge = App.statusBadge(loan.status);
  if (loan.status === 'pending' && !isAdmin) {
    badge = loan.actions.accept
      ? '<span class="badge badge-orange"><i class="fa-solid fa-circle-exclamation"></i> Your response needed</span>'
      : `<span class="badge badge-gray"><i class="fa-solid fa-hourglass-half"></i> Waiting for ${asLender ? 'borrower' : 'lender'}</span>`;
  }

  const buttons = [
    a.pay          && '<button type="button" class="btn-sm primary" data-act="pay"><i class="fa-solid fa-lock"></i> Pay now</button>',
    a.accept       && '<button type="button" class="btn-sm success" data-act="accept"><i class="fa-solid fa-check"></i> Accept handover</button>',
    a.counter      && '<button type="button" class="btn-sm" data-act="counter"><i class="fa-solid fa-arrows-rotate"></i> Propose another time</button>',
    a.verifyPin    && '<button type="button" class="btn-sm primary" data-act="verifyPin"><i class="fa-solid fa-key"></i> Enter borrower’s PIN</button>',
    a.markReturned && '<button type="button" class="btn-sm primary" data-act="markReturned"><i class="fa-solid fa-rotate-left"></i> I have returned it</button>',
    a.inspect      && '<button type="button" class="btn-sm success" data-act="inspect"><i class="fa-solid fa-clipboard-check"></i> Inspect return</button>',
    a.dispute      && !a.inspect && '<button type="button" class="btn-sm danger" data-act="dispute"><i class="fa-solid fa-scale-balanced"></i> File a claim</button>',
    a.review       && '<button type="button" class="btn-sm primary" data-act="review"><i class="fa-solid fa-star"></i> Rate &amp; review</button>',
    loan.dispute   && `<a class="btn-sm" href="disputes.html?id=${loan.dispute.id}"><i class="fa-solid fa-scale-balanced"></i> View dispute</a>`,
    a.chat         && `<button type="button" class="btn-sm" data-act="chat"><i class="fa-solid fa-comments"></i> Chat${loan.unread ? ` <span class="chip-count">${loan.unread}</span>` : ''}</button>`,
    a.receipt      && '<button type="button" class="btn-sm" data-act="receipt"><i class="fa-solid fa-receipt"></i> Receipt</button>',
    '<button type="button" class="btn-sm" data-act="details"><i class="fa-solid fa-file-lines"></i> Details</button>',
    a.decline      && '<button type="button" class="btn-sm danger" data-act="decline"><i class="fa-solid fa-xmark"></i> Decline</button>',
    a.cancel       && '<button type="button" class="btn-sm danger" data-act="cancel"><i class="fa-solid fa-ban"></i> Cancel booking</button>',
    a.void         && '<button type="button" class="btn-sm danger" data-act="void"><i class="fa-solid fa-ban"></i> Void handover</button>',
  ].filter(Boolean).join('');

  const hint = isAdmin ? '' : {
    awaiting_payment: 'Complete the payment so the lender can see your booking.',
    pending: a.accept
      ? (asLender ? 'The borrower has paid. Accept the proposed handover, suggest another time, or decline (full refund).' : 'The lender proposed a different handover. Accept it, counter, or decline for a full refund.')
      : 'Waiting for the other side to respond to the handover proposal.',
    confirmed: asLender ? 'At the meetup, hand over the item and type the borrower’s 4-digit PIN to start the loan.' : 'At the meetup, check the item, then show your PIN to the lender.',
    active: asLender ? 'The borrower has the item. The rental fee has been released to you.' : `Return it by ${App.fmtDate(loan.endDate)} and tap “I have returned it”.`,
    overdue: asLender ? 'The return date has passed. You can file a claim if the borrower refuses to return it.' : 'This item is overdue. Return it now – late returns cost Trust Points.',
    return_pending: asLender ? 'Inspect the item. Confirm to refund the deposit, or report a problem.' : 'You confirmed the return. Waiting for the lender to inspect the item.',
    disputed: 'An admin is reviewing a claim. The deposit stays in escrow until it is decided.',
  }[loan.status];

  const showHandover = ['awaiting_payment', 'pending', 'confirmed'].includes(loan.status);
  return `
    <article class="loan-card ${loan.status === 'overdue' || loan.status === 'disputed' ? 'overdue' : myTurn && !isAdmin ? 'highlight' : ''}" data-loan-id="${loan.id}">
      <div class="thumb">${App.toolImage(loan.tool.image, { small: true, alt: loan.tool.name, category: loan.tool.category })}</div>
      <div>
        <div class="loan-card-head">
          <span class="loan-card-title">${esc(loan.tool.name)}</span>
          ${badge} ${App.daysPill(loan)}
        </div>
        <div class="loan-meta">
          ${isAdmin
            ? `<span>Borrower: <strong data-user-id="${loan.borrower.id}" class="link">${esc(loan.borrower.name)}</strong></span><span>Lender: <strong data-user-id="${loan.owner.id}" class="link">${esc(loan.owner.name)}</strong></span>`
            : `<span class="owner-chip" data-user-id="${other.id}" style="cursor:pointer;">${App.avatar(other, 'sm')} <span>${asLender ? 'Borrower' : 'Lender'}: <strong>${esc(other.name)}</strong></span></span>${App.trustBadge(other.trustPoints)}`}
          <span><i class="fa-solid fa-calendar"></i>${App.fmtDate(loan.startDate)} → <strong>${App.fmtDate(loan.endDate)}</strong></span>
          <span><i class="fa-solid fa-money-bill"></i>${App.money(loan.cost.total)} <span class="muted">(${App.money(loan.cost.rental)} + ${App.money(loan.cost.deposit)} deposit)</span></span>
          <span><i class="fa-solid fa-hashtag"></i>${esc(loan.ref)}</span>
        </div>
        ${App.stageTracker(loan).replace('stage-tracker', 'stage-tracker compact')}
        ${hint ? `<p class="loan-hint"><i class="fa-solid fa-circle-info"></i> ${hint}</p>` : ''}
        ${showHandover && loan.handover.time ? `<div class="handover-box"><i class="fa-solid fa-handshake"></i>
          <div><strong>${App.fmtHandover(loan.handover.time)}</strong><span>${esc(loan.handover.location)}</span></div></div>` : ''}
        ${loan.pin ? `<div class="pin-box" data-pin="${esc(loan.pin)}">
          <div><strong>Your handover PIN</strong><span>Show it to ${esc(loan.owner.name.split(' ')[0])} only after you have checked and received the item.</span></div>
          <div class="pin-digits" aria-live="polite">••••</div>
          <button type="button" class="btn-sm" data-act="togglePin"><i class="fa-solid fa-eye"></i> Show</button>
        </div>` : ''}
        ${loan.pinLocked && loan.status === 'confirmed' ? '<p class="loan-hint" style="color:#B91C1C;"><i class="fa-solid fa-lock"></i> PIN entry is temporarily locked after several wrong attempts.</p>' : ''}
        ${loan.message && ['awaiting_payment', 'pending'].includes(loan.status) ? `<div class="loan-message">“${esc(loan.message)}”</div>` : ''}
        ${loan.ownerNote && !['pending', 'awaiting_payment'].includes(loan.status) ? `<div class="loan-message owner"><strong>Lender note:</strong> ${esc(loan.ownerNote)}</div>` : ''}
        ${loan.cancelReason ? `<div class="loan-message">${esc(loan.cancelReason)}</div>` : ''}
        ${isAdmin ? '' : App.contactHtml(other)}
      </div>
      <div class="loan-actions">${buttons}</div>
    </article>`;
}

/** Wire the action buttons of every booking card inside root. */
function bindLoanActions(root, getLoans, reload) {
  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('[data-loan-id]');
    if (!btn || !card) return;
    const loan = getLoans().find(l => l.id === Number(card.dataset.loanId));
    if (!loan) return;
    const act = LOAN_ACTIONS[btn.dataset.act];
    if (act && await act(loan, btn)) {
      App.refreshCounts();
      reload();
    }
  });
}

async function postLoanAction(loan, action, body = {}) {
  try {
    const res = await App.api(`/api/loans/${loan.id}/${action}`, body);
    showToast(res.message, 'success');
    return true;
  } catch (err) {
    if (err.fields) return err;              // caller shows field errors
    showToast(err.message, 'error');
    return err.status === 409;               // state changed elsewhere → refresh
  }
}

/** Modal with a form; resolves true when the submit handler succeeds. */
function formModal({ title, icon, body, submitText, danger, onSubmit }) {
  return new Promise(resolve => {
    let done = false;
    const m = App.modal({
      title, icon, body,
      footer: `<button type="button" class="btn-secondary" data-close>Cancel</button>
               <button type="button" class="btn-primary ${danger ? 'btn-danger' : ''}" id="fmSubmit"><span class="btn-text">${submitText}</span></button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    m.el.querySelector('#fmSubmit').addEventListener('click', async e => {
      App.clearFieldErrors(m.el);
      await App.withLoading(e.currentTarget, async () => {
        const ok = await onSubmit(m.el);
        if (ok === true) { done = true; m.close(); resolve(true); }
      });
    });
  });
}

const LOAN_ACTIONS = {
  details: loan => { App.showLoanDetail(loan.id); return false; },
  receipt: loan => { App.showReceipt(loan.id); return false; },
  chat:    loan => { App.openChat(loan.id, `Chat · ${loan.tool.name}`); return false; },
  pay:     loan => { window.location.href = `checkout.html?booking=${loan.id}`; return false; },

  togglePin(loan, btn) {
    const box = btn.closest('.pin-box');
    const digits = box.querySelector('.pin-digits');
    const showing = digits.textContent !== '••••';
    digits.textContent = showing ? '••••' : box.dataset.pin;
    btn.innerHTML = showing ? '<i class="fa-solid fa-eye"></i> Show' : '<i class="fa-solid fa-eye-slash"></i> Hide';
    return false;
  },

  async accept(loan) {
    const ok = await App.confirm({
      title: 'Accept handover', icon: 'fa-circle-check', confirmText: 'Accept & Confirm Booking',
      message: `Meet ${loan.viewerRole === 'lender' ? loan.borrower.name : loan.owner.name} on ${App.fmtHandover(loan.handover.time)} at ${loan.handover.location}? The booking will be confirmed and the borrower receives a 4-digit handover PIN.`,
    });
    return ok ? postLoanAction(loan, 'accept') : false;
  },

  counter(loan) {
    const min = `${App.addDays(loan.startDate, -1)}T00:00`;
    const max = `${loan.startDate}T23:59`;
    return formModal({
      title: 'Propose another handover', icon: 'fa-arrows-rotate', submitText: 'Send Counter-offer',
      body: `
        <p style="font-size:13.5px;color:var(--gray-700);margin-bottom:14px;">Current proposal: <strong>${App.fmtHandover(loan.handover.time)}</strong> at ${App.esc(loan.handover.location)}. The handover must be on ${App.fmtDate(loan.startDate)} or the day before.</p>
        <div class="form-grid">
          <div class="form-group"><label for="coTime">New time</label>
            <input type="datetime-local" id="coTime" class="form-control" min="${min}" max="${max}" step="900" value="${(loan.handover.time || '').replace(' ', 'T')}" />
            <span class="error-msg" id="coTimeErr"></span></div>
          <div class="form-group"><label for="coPlace">New place</label>
            <input id="coPlace" class="form-control" maxlength="120" value="${App.esc(loan.handover.location || '')}" />
            <span class="error-msg" id="coPlaceErr"></span></div>
        </div>
        <div class="form-group" style="margin-bottom:0;"><label for="coMsg">Message <span class="muted">(optional)</span></label>
          <textarea id="coMsg" class="form-control" rows="2" maxlength="300" placeholder="e.g. I have class until 3pm, can we meet at 4?"></textarea></div>`,
      onSubmit: async el => {
        const res = await postLoanAction(loan, 'counter', {
          handoverTime: el.querySelector('#coTime').value, handoverLocation: el.querySelector('#coPlace').value.trim(), message: el.querySelector('#coMsg').value.trim(),
        });
        if (res instanceof Error) { App.showFieldErrors(res, { handoverTime: 'coTime', handoverLocation: 'coPlace' }); return false; }
        return res;
      },
    });
  },

  async decline(loan) {
    const note = await App.confirm({
      title: 'Decline booking', danger: true, confirmText: 'Decline & Refund',
      message: `Decline this booking for ${loan.tool.name}? The borrower gets a full refund of ${App.money(loan.cost.escrow)}.`,
      input: { label: 'Reason', placeholder: 'e.g. I need it myself that week.' },
    });
    if (note === null) return false;
    return postLoanAction(loan, 'decline', { note: note === true ? '' : note });
  },

  async cancel(loan) {
    const reason = await App.confirm({
      title: 'Cancel booking', danger: true, confirmText: 'Cancel Booking',
      message: loan.cost.escrow ? `Cancel this booking? ${App.money(loan.cost.escrow)} will be fully refunded to the borrower and the booking stays in the history.` : 'Cancel this booking?',
      input: { label: 'Reason', placeholder: 'e.g. Plans changed' },
    });
    if (reason === null) return false;
    return postLoanAction(loan, 'cancel', { reason: reason === true ? '' : reason });
  },

  async void(loan) {
    const reason = await App.confirm({
      title: 'Void handover', danger: true, confirmText: 'Void & Refund',
      message: `Void the handover for ${loan.tool.name}? Use this when the meetup did not take place. The borrower is refunded in full and the record stays in the history.`,
      input: { label: 'Reason', placeholder: 'e.g. Neither party showed up', required: true, minLength: 5 },
    });
    if (!reason) return false;
    try { showToast((await App.api(`/api/loans/${loan.id}/void`, { reason })).message, 'success'); return true; }
    catch (err) { showToast(err.message, 'error'); return false; }
  },

  verifyPin(loan) {
    return formModal({
      title: 'Verify handover PIN', icon: 'fa-key', submitText: 'Verify & Start Loan',
      body: `
        <p style="font-size:13.5px;color:var(--gray-700);margin-bottom:6px;">Hand <strong>${App.esc(loan.tool.name)}</strong> to ${App.esc(loan.borrower.name)}, then ask for the 4-digit PIN shown in their account and type it here.</p>
        <p class="field-hint" style="margin-bottom:18px;">Verifying the PIN starts the loan and releases the ${App.money(loan.cost.rental)} rental fee to you. The ${App.money(loan.cost.deposit)} deposit stays in escrow until the return.</p>
        <div class="pin-inputs" id="pinInputs">${[0, 1, 2, 3].map(i => `<input type="text" inputmode="numeric" maxlength="1" aria-label="PIN digit ${i + 1}" />`).join('')}</div>
        <span class="error-msg" id="pinErr" style="text-align:center;"></span>`,
      onSubmit: async el => {
        const pin = [...el.querySelectorAll('#pinInputs input')].map(i => i.value).join('');
        if (!/^\d{4}$/.test(pin)) { el.querySelector('#pinErr').textContent = 'Enter all 4 digits.'; return false; }
        try {
          showToast((await App.api(`/api/loans/${loan.id}/verify-pin`, { pin })).message, 'success');
          return true;
        } catch (err) {
          el.querySelector('#pinErr').textContent = err.message;
          el.querySelectorAll('#pinInputs input').forEach(i => { i.value = ''; i.classList.add('invalid'); });
          el.querySelector('#pinInputs input').focus();
          return false;
        }
      },
    });
  },

  markReturned(loan) {
    let photo;
    const promise = formModal({
      title: 'Return item', icon: 'fa-rotate-left', submitText: 'Confirm Return',
      body: `
        <p style="font-size:13.5px;color:var(--gray-700);margin-bottom:14px;">Hand <strong>${App.esc(loan.tool.name)}</strong> back to ${App.esc(loan.owner.name)}, then upload a photo showing its condition. This is your evidence if there is a dispute.</p>
        <div class="form-group"><label>Condition photo <span style="color:var(--danger);">*</span></label><div id="returnPhoto"></div><span class="error-msg" id="returnPhotoErr"></span></div>
        <div class="form-group" style="margin-bottom:0;"><label for="returnNote">Note to the lender <span class="muted">(optional)</span></label>
          <textarea id="returnNote" class="form-control" rows="2" maxlength="300" placeholder="e.g. Returned at the library foyer, batteries charged."></textarea></div>`,
      onSubmit: async el => {
        if (!photo.data()) { photo.markInvalid(); el.querySelector('#returnPhotoErr').textContent = 'A condition photo is required.'; return false; }
        return postLoanAction(loan, 'return', { photo: photo.data(), note: el.querySelector('#returnNote').value.trim() });
      },
    });
    photo = App.uploader([...document.querySelectorAll('#returnPhoto')].pop(), { title: 'Upload condition photo', hint: 'A clear photo of the item as you return it', maxDim: 1400 });
    return promise;
  },

  async inspect(loan) {
    let detail;
    try { ({ loan: detail } = await App.api(`/api/loans/${loan.id}`)); } catch (err) { showToast(err.message, 'error'); return false; }
    return new Promise(resolve => {
      let done = false;
      const m = App.modal({
        title: 'Inspect returned item', icon: 'fa-clipboard-check',
        body: `
          <p style="font-size:13.5px;color:var(--gray-700);margin-bottom:12px;">${App.esc(detail.borrower.name)} returned <strong>${App.esc(detail.tool.name)}</strong> ${App.timeAgo(detail.timestamps.returned)}. Compare the item with their photo.</p>
          ${detail.returnPhoto ? `<div class="photo-frame"><img src="${App.esc(detail.returnPhoto)}" alt="Condition photo from borrower" /></div>` : ''}
          ${detail.returnNote ? `<div class="loan-message"><strong>Borrower:</strong> ${App.esc(detail.returnNote)}</div>` : ''}
          <div class="form-group" style="margin-top:14px;margin-bottom:0;"><label for="inspectNote">Note <span class="muted">(optional)</span></label>
            <textarea id="inspectNote" class="form-control" rows="2" maxlength="300" placeholder="Anything to record about this return"></textarea></div>`,
        footer: `
          <button type="button" class="btn-secondary" style="color:#DC2626;" id="inspectProblem"><i class="fa-solid fa-scale-balanced"></i> Report a problem</button>
          <button type="button" class="btn-primary" id="inspectOk"><span class="btn-text">All good – refund ${App.money(detail.cost.deposit)} deposit</span></button>`,
        onClose: () => { if (!done) resolve(false); },
      });
      m.el.querySelector('#inspectOk').addEventListener('click', async e => {
        await App.withLoading(e.currentTarget, async () => {
          const ok = await postLoanAction(loan, 'inspect', { note: m.el.querySelector('#inspectNote').value.trim() });
          if (ok === true) { done = true; m.close(); resolve(true); }
        });
      });
      m.el.querySelector('#inspectProblem').addEventListener('click', async () => {
        done = true;
        m.close();
        resolve(await LOAN_ACTIONS.dispute(loan));
      });
    });
  },

  dispute(loan) {
    const returned = loan.status === 'return_pending';
    const types = returned
      ? [['damage', 'Damaged hardware'], ['lost', 'Missing parts / lost item']]
      : [['not_returned', 'Refuses to return the overdue item'], ['lost', 'Borrower says the item is lost']];
    let evidence;
    const promise = formModal({
      title: 'File a claim', icon: 'fa-scale-balanced', submitText: 'File Claim', danger: true,
      body: `
        <div class="notice info" style="margin-bottom:14px;"><i class="fa-solid fa-circle-info"></i><div>An admin reviews the evidence and decides how much of the <strong>${App.money(loan.cost.deposit)}</strong> deposit goes to you. Confirmed violations also cost the borrower Trust Points.</div></div>
        <div class="form-group"><label>Claim type</label>
          <div class="choice-group">${types.map(([v, l], i) => `<label class="choice danger"><input type="radio" name="dType" value="${v}" ${i === 0 ? 'checked' : ''} /> ${l}</label>`).join('')}</div>
          <span class="error-msg" id="typeErr"></span></div>
        <div class="form-group"><label for="dDesc">What happened?</label>
          <textarea id="dDesc" class="form-control" rows="4" maxlength="1500" placeholder="Describe the problem, when you noticed it, and any repair quote."></textarea>
          <span class="error-msg" id="dDescErr"></span></div>
        <div class="form-group"><label for="dClaim">Amount to claim from the deposit (RM)</label>
          <input id="dClaim" type="number" class="form-control" min="0" max="${loan.cost.deposit / 100}" step="0.01" value="${(loan.cost.deposit / 100).toFixed(2)}" />
          <span class="error-msg" id="dClaimErr"></span></div>
        <div class="form-group" style="margin-bottom:0;"><label>Evidence photos <span class="muted">(required for damage, up to 4)</span></label>
          <div id="dEvidence"></div><span class="error-msg" id="dEvidenceErr"></span></div>`,
      onSubmit: async el => {
        const type = el.querySelector('input[name=dType]:checked').value;
        try {
          const res = await App.api('/api/disputes', {
            loanId: loan.id, type, description: el.querySelector('#dDesc').value.trim(),
            claimAmount: Number(el.querySelector('#dClaim').value), evidence: evidence.value().map(p => p.data),
          });
          showToast(res.message, 'success');
          return true;
        } catch (err) {
          if (!App.showFieldErrors(err, { description: 'dDesc', claimAmount: 'dClaim', evidence: 'dEvidence', type: 'type' })) showToast(err.message, 'error');
          return false;
        }
      },
    });
    evidence = App.photoManager([...document.querySelectorAll('#dEvidence')].pop(), { max: 4, title: 'Add evidence', maxDim: 1400 });
    return promise;
  },

  async review(loan) {
    let detail;
    try { ({ loan: detail } = await App.api(`/api/loans/${loan.id}`)); } catch (err) { showToast(err.message, 'error'); return false; }
    const asBorrower = loan.viewerRole === 'borrower';
    const other = asBorrower ? loan.owner : loan.borrower;
    const mine = type => detail.myReviews.find(r => r.targetType === type);
    const section = (type, label) => {
      const r = mine(type);
      return `
        <div class="review-form" data-type="${type}">
          <label>${label}</label>
          <div class="star-input" role="radiogroup" aria-label="${App.esc(label)}">${[1, 2, 3, 4, 5].map(n => `
            <button type="button" data-star="${n}" class="${r && n <= r.rating ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}"><i class="fa-solid fa-star"></i></button>`).join('')}</div>
          <textarea class="form-control" rows="2" maxlength="600" placeholder="Written feedback (optional)">${App.esc(r?.comment || '')}</textarea>
          ${r ? `<p class="field-hint">You can edit this review until ${App.fmtDate(App.addDays(r.createdAt.slice(0, 10), 7))}.</p>` : ''}
        </div>`;
    };
    return formModal({
      title: 'Rate & review', icon: 'fa-star', submitText: 'Save Review',
      body: `
        <p class="field-hint" style="margin-bottom:14px;">Ratings for people affect their Trust Points (5★ +3, 4★ +1; 2★ or lower sends a reputation warning). Written comments do not change Trust Points.</p>
        ${section('user', `How was ${other.name} as a ${asBorrower ? 'lender' : 'borrower'}?`)}
        ${asBorrower ? section('tool', `How was the item (${loan.tool.name})?`) : ''}`,
      onSubmit: async el => {
        const forms = [...el.querySelectorAll('.review-form')];
        const payloads = forms.map(f => ({ targetType: f.dataset.type, rating: f.querySelectorAll('.star-input .on').length, comment: f.querySelector('textarea').value.trim() }))
          .filter(p => p.rating > 0);
        if (!payloads.length) { showToast('Choose at least one star rating.', 'error'); return false; }
        try {
          for (const p of payloads) await App.api('/api/reviews', { loanId: loan.id, ...p });
          showToast('Thanks – your review has been saved.', 'success');
          return true;
        } catch (err) { showToast(err.message, 'error'); return false; }
      },
    });
  },
};

// Star pickers and PIN boxes inside any modal.
document.addEventListener('click', e => {
  const star = e.target.closest('[data-star]');
  if (!star) return;
  const n = Number(star.dataset.star);
  star.parentElement.querySelectorAll('[data-star]').forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= n));
});
document.addEventListener('input', e => {
  if (!e.target.closest('.pin-inputs')) return;
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 1);
  e.target.classList.remove('invalid');
  if (e.target.value) e.target.nextElementSibling?.focus();
});
document.addEventListener('keydown', e => {
  if (e.target.closest('.pin-inputs') && e.key === 'Backspace' && !e.target.value) e.target.previousElementSibling?.focus();
});
document.addEventListener('paste', e => {
  const box = e.target.closest('.pin-inputs');
  if (!box) return;
  const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return;
  e.preventDefault();
  box.querySelectorAll('input').forEach((input, i) => { input.value = digits[i] || ''; });
});
