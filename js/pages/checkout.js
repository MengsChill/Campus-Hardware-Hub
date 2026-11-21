/* ============================================================
   Checkout – simulated online payment gateway (Module 3)
   No real money moves: test cards / test banks only.
   ============================================================ */

App.ready(async () => {
  const { esc } = App;
  const root = document.getElementById('checkout');
  const id = Number(new URLSearchParams(location.search).get('booking'));
  if (!id) { root.innerHTML = App.emptyState('fa-circle-exclamation', 'No booking selected.', '<a href="my-loans.html" class="btn-primary">My Bookings</a>'); return; }

  let loan, options;
  try {
    [{ loan }, options] = await Promise.all([App.api(`/api/loans/${id}`), App.api('/api/loans/payment/options')]);
  } catch (err) { root.innerHTML = App.emptyState('fa-circle-exclamation', err.message); return; }

  if (loan.viewerRole !== 'borrower') { root.innerHTML = App.emptyState('fa-lock', 'Only the borrower can pay for this booking.'); return; }
  if (loan.status !== 'awaiting_payment') { renderDone(loan.status === 'cancelled' ? null : loan); return; }

  const deadline = new Date(new Date(loan.timestamps.created.replace(' ', 'T') + 'Z').getTime() + options.windowMinutes * 60000);
  const testCards = Object.entries(options.testCards);

  root.innerHTML = `
    <div class="checkout-grid">
      <section class="dash-card">
        <div class="card-header"><h3>Order summary</h3><span class="loan-ref">${esc(loan.ref)}</span></div>
        <div class="checkout-item">
          <div class="thumb lg">${App.toolImage(loan.tool.image, { small: true, category: loan.tool.category })}</div>
          <div><strong>${esc(loan.tool.name)}</strong><span>from ${esc(loan.owner.name)}</span></div>
        </div>
        <dl class="info-list" style="margin:14px 0;">
          <dt><i class="fa-solid fa-calendar"></i> Rental</dt><dd>${App.fmtDate(loan.startDate)} → ${App.fmtDate(loan.endDate)} (${App.plural(loan.days, 'day')})</dd>
          <dt><i class="fa-solid fa-handshake"></i> Handover</dt><dd>${App.fmtHandover(loan.handover.time)} · ${esc(loan.handover.location)}</dd>
        </dl>
        ${App.costTable(loan)}
        <ul class="escrow-steps">
          <li><i class="fa-solid fa-lock"></i><div><strong>Held in escrow</strong>Your ${App.money(loan.cost.total)} is held by the system, not paid to the lender yet.</div></li>
          <li><i class="fa-solid fa-key"></i><div><strong>Released at handover</strong>The ${App.money(loan.cost.rental)} rental fee goes to the lender only when they verify your 4-digit PIN.</div></li>
          <li><i class="fa-solid fa-rotate-left"></i><div><strong>Deposit refunded</strong>Your ${App.money(loan.cost.deposit)} deposit comes back after the return is inspected.</div></li>
          <li><i class="fa-solid fa-shield-halved"></i><div><strong>Full refund</strong>If the lender declines, or either side cancels before handover.</div></li>
        </ul>
      </section>

      <section class="dash-card pay-card">
        <div class="pay-head">
          <div><i class="fa-solid fa-shield-halved"></i> <strong>CHLS Pay</strong> demo checkout</div>
          <span class="badge badge-orange"><i class="fa-solid fa-flask"></i> Simulation</span>
        </div>
        <div class="notice warning" style="margin-bottom:16px;"><i class="fa-solid fa-triangle-exclamation"></i>
          <div><strong>Demo payment gateway</strong>No real money is charged. Do not enter real card details – use a test card below.</div></div>
        <p class="pay-timer" id="payTimer"></p>

        <div class="tabs" role="tablist" style="margin-bottom:16px;">
          <button type="button" class="tab active" data-method="card"><i class="fa-regular fa-credit-card"></i> Card</button>
          <button type="button" class="tab" data-method="fpx"><i class="fa-solid fa-building-columns"></i> Online banking</button>
        </div>

        <form id="payForm" novalidate>
          <div data-panel="card">
            <div class="form-group"><label for="cardName">Name on card</label>
              <input id="cardName" class="form-control" autocomplete="off" value="${esc(App.user.fullName)}" /><span class="error-msg" id="cardNameErr"></span></div>
            <div class="form-group"><label for="cardNumber">Card number</label>
              <input id="cardNumber" class="form-control" inputmode="numeric" autocomplete="off" maxlength="19" placeholder="4242 4242 4242 4242" /><span class="error-msg" id="cardNumberErr"></span></div>
            <div class="form-grid">
              <div class="form-group"><label for="cardExpiry">Expiry</label>
                <input id="cardExpiry" class="form-control" inputmode="numeric" autocomplete="off" maxlength="5" placeholder="MM/YY" /><span class="error-msg" id="cardExpiryErr"></span></div>
              <div class="form-group"><label for="cardCvc">CVC</label>
                <input id="cardCvc" class="form-control" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="123" /><span class="error-msg" id="cardCvcErr"></span></div>
            </div>
            <div class="test-cards">
              <span>Test cards:</span>
              ${testCards.map(([num, result]) => `<button type="button" class="btn-sm ${result === 'declined' ? 'danger' : ''}" data-card="${num}">${num.replace(/(\d{4})/g, '$1 ').trim()} · ${result}</button>`).join('')}
            </div>
          </div>
          <div data-panel="fpx" hidden>
            <div class="form-group"><label>Choose your bank <span class="muted">(test banks)</span></label>
              <div class="bank-grid">${options.banks.map((b, i) => `<label class="choice"><input type="radio" name="bank" value="${esc(b)}" ${i === 0 ? 'checked' : ''} /> <i class="fa-solid fa-building-columns"></i> ${esc(b)}</label>`).join('')}</div>
              <span class="error-msg" id="bankErr"></span></div>
          </div>
          <button type="submit" class="btn-primary btn-full" id="payBtn" style="margin-top:10px;padding:14px;"><span class="btn-text"><i class="fa-solid fa-lock"></i> Pay ${App.money(loan.cost.total)}</span></button>
          <button type="button" class="link-btn" id="cancelBooking">Cancel this booking</button>
        </form>
      </section>
    </div>`;

  // Countdown for the payment window
  const timerEl = root.querySelector('#payTimer');
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    timerEl.innerHTML = left
      ? `<i class="fa-regular fa-clock"></i> Complete payment within <strong>${m}:${String(s).padStart(2, '0')}</strong> or the booking is released.`
      : '<i class="fa-solid fa-circle-exclamation"></i> The payment window has expired. Please book again.';
    if (!left) root.querySelector('#payBtn').disabled = true;
  };
  tick();
  setInterval(tick, 1000);

  let method = 'card';
  root.querySelectorAll('[data-method]').forEach(tab => tab.addEventListener('click', () => {
    method = tab.dataset.method;
    root.querySelectorAll('[data-method]').forEach(t => t.classList.toggle('active', t === tab));
    root.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== method; });
  }));

  const number = root.querySelector('#cardNumber');
  const expiry = root.querySelector('#cardExpiry');
  number.addEventListener('input', () => { number.value = number.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '); });
  expiry.addEventListener('input', () => {
    const d = expiry.value.replace(/\D/g, '').slice(0, 4);
    expiry.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  });
  root.querySelector('#cardCvc').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
  root.querySelectorAll('[data-card]').forEach(btn => btn.addEventListener('click', () => {
    number.value = btn.dataset.card.replace(/(\d{4})(?=\d)/g, '$1 ');
    const exp = new Date(); exp.setFullYear(exp.getFullYear() + 3);
    expiry.value = `${String(exp.getMonth() + 1).padStart(2, '0')}/${String(exp.getFullYear()).slice(2)}`;
    root.querySelector('#cardCvc').value = '123';
  }));

  root.querySelector('#payForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    App.clearFieldErrors(form);
    const body = method === 'card'
      ? { method, card: { name: root.querySelector('#cardName').value, number: number.value, expiry: expiry.value, cvc: root.querySelector('#cardCvc').value } }
      : { method, bank: (root.querySelector('input[name=bank]:checked') || {}).value };
    await App.withLoading(root.querySelector('#payBtn'), async () => {
      await new Promise(r => setTimeout(r, 900));   // feels like a gateway round-trip
      try {
        const res = await App.api(`/api/loans/${loan.id}/pay`, body);
        renderDone(res.loan, res.reference);
      } catch (err) {
        if (!App.showFieldErrors(err)) showToast(err.message, 'error');
      }
    });
  });

  root.querySelector('#cancelBooking').addEventListener('click', async () => {
    if (!await App.confirm({ title: 'Cancel booking', danger: true, confirmText: 'Cancel Booking', message: 'Cancel this booking? Nothing has been charged yet.' })) return;
    try { await App.api(`/api/loans/${loan.id}/cancel`, {}); window.location.href = 'my-loans.html'; }
    catch (err) { showToast(err.message, 'error'); }
  });

  function renderDone(paid, reference) {
    App.refreshCounts();
    root.innerHTML = paid ? `
      <div class="dash-card pay-success">
        <div class="success-circle"><i class="fa-solid fa-check"></i></div>
        <h2>Payment successful</h2>
        <p>${App.money(paid.cost.total)} is held in escrow. ${esc(paid.owner.name)} has been notified and will accept your handover proposal or suggest another time.</p>
        ${reference ? `<p class="loan-ref">Receipt ${esc(reference)}</p>` : ''}
        <div class="btn-row" style="justify-content:center;margin-top:16px;">
          <button type="button" class="btn-secondary" id="viewReceipt"><i class="fa-solid fa-receipt"></i> View receipt</button>
          <a href="my-loans.html" class="btn-primary"><i class="fa-solid fa-calendar-check"></i> Go to My Bookings</a>
        </div>
      </div>` : App.emptyState('fa-ban', 'This booking was cancelled or the payment window expired.', '<a href="catalog.html" class="btn-primary">Browse Hardware</a>');
    root.querySelector('#viewReceipt')?.addEventListener('click', () => App.showReceipt(paid.id));
  }
});
