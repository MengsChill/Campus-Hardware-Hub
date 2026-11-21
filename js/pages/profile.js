/* ============================================================
   My Profile (Module 1) – details, Trust Points, password, deactivate
   ============================================================ */

const PROGRAMMES = {
  civil: 'Civil Engineering', electrical: 'Electrical Engineering', mechanical: 'Mechanical Engineering',
  computer: 'Computer Engineering', electronic: 'Electronics Engineering', cs: 'Computer Science',
  it: 'Information Technology', se: 'Software Engineering', ds: 'Data Science', cyber: 'Cybersecurity',
  id: 'Industrial Design', arch: 'Architecture',
};

App.ready(async user => {
  const { esc } = App;
  const isStudent = user.role === 'student';
  let profile;

  async function loadProfile() {
    profile = await App.api('/api/me/profile');
    renderCard();
    renderTrust();
  }
  try { await loadProfile(); } catch (err) { showToast(err.message, 'error'); return; }

  function renderCard() {
    const u = profile.user, s = profile.stats;
    document.getElementById('profileName').textContent = u.fullName;
    document.getElementById('profileEmail').textContent = u.email;
    document.getElementById('profileRole').innerHTML = u.role === 'admin'
      ? '<span class="badge badge-purple"><i class="fa-solid fa-user-shield"></i> Administrator</span>'
      : `<span class="badge badge-blue"><i class="fa-solid fa-graduation-cap"></i> Student</span> ${App.trustBadge(u.trustPoints)}`;
    document.getElementById('profileSince').innerHTML = `Member since ${App.fmtDate(u.createdAt)}${isStudent ? `<br>${App.stars(profile.rating.average, { count: profile.rating.count, size: 'sm' })}` : ''}`;
    document.getElementById('profileStats').innerHTML = isStudent ? `
      <div><strong>${s.activeBookings}</strong><span>Active bookings</span></div>
      <div><strong>${s.listings}</strong><span>Listings</span></div>
      <div><strong>${s.timesBorrowed}</strong><span>Times borrowed</span></div>
      <div><strong>${App.money(s.earnings)}</strong><span>Earned lending</span></div>` : '';
  }

  function renderTrust() {
    const panel = document.getElementById('trustPanel');
    if (!isStudent) { panel.hidden = true; return; }
    const u = profile.user, r = profile.trustRules;
    const pct = Math.max(0, Math.min(100, u.trustPoints / 1.5));
    panel.innerHTML = `
      <div class="card-header"><h3>Trust Points</h3></div>
      <div class="trust-meter">
        <div class="trust-score ${u.trustPoints < r.flagBelow ? 'bad' : u.trustPoints < 80 ? 'warn' : 'good'}">${u.trustPoints}</div>
        <div style="flex:1;">
          <div class="bar-track" style="height:10px;border-radius:999px;position:relative;">
            <div class="bar-fill" style="width:${pct}%;border-radius:999px;background:${u.trustPoints < r.flagBelow ? '#DC2626' : u.trustPoints < 80 ? '#D97706' : '#16A34A'};"></div>
            <span class="trust-threshold" style="left:${r.flagBelow / 1.5}%;" title="Accounts below ${r.flagBelow} are flagged"></span>
          </div>
          <p class="field-hint" style="margin-top:6px;">Everyone starts with ${r.start}. Below ${r.flagBelow}, your account is flagged for admin review.</p>
        </div>
      </div>
      ${u.flagged ? `<div class="notice danger" style="margin:12px 0;"><i class="fa-solid fa-flag"></i><div><strong>Your account is under review</strong>Your Trust Points are below ${r.flagBelow}. An admin will review your account.</div></div>` : ''}
      <div class="trust-rules">
        <div><strong>Earn</strong><span>+${r.onTime} on-time return · +${r.ratingBonus[5]} for 5★ · +${r.ratingBonus[4]} for 4★</span></div>
        <div><strong>Lose</strong><span>−${r.penalty.late_return} late · −${r.penalty.damage} damage · −${r.penalty.lost} lost · −${r.penalty.not_returned} not returned</span></div>
      </div>
      <h4 class="section-title">History</h4>
      ${App.trustHistoryTable(profile.trustHistory)}
      <h4 class="section-title">Reviews you received</h4>
      <div id="myReviews">${App.loading()}</div>`;
    App.api(`/api/reviews?userId=${u.id}`).then(({ reviews }) => {
      document.getElementById('myReviews').innerHTML = App.reviewList(reviews, 'No reviews yet. Complete a booking to get rated.');
    }).catch(() => {});
  }

  // Avatar: saves as soon as a photo is picked or removed.
  const avatarBox = App.uploader(document.getElementById('avatarUpload'), {
    current: profile.user.avatar, round: true, maxDim: 400, title: 'Add photo',
    onChange: async data => {
      try {
        const res = data ? await App.api('/api/me/avatar', { image: data }) : await App.api('/api/me/avatar', {}, 'DELETE');
        App.updateUser(res.user);
        avatarBox.setCurrent(res.user.avatar);
        showToast(res.message, 'success');
      } catch (err) { showToast(err.message, 'error'); }
    },
  });

  // Personal details
  const form = document.getElementById('profileForm');
  const f = id => form.querySelector(id);
  f('#pName').value = profile.user.fullName;
  f('#pPhone').value = profile.user.phone || '';
  f('#pWhatsapp').value = profile.user.whatsapp || '';
  f('#pEmail').value = profile.user.email;
  f('#pCampusId').value = profile.user.campusId || '—';
  const dept = f('#pDepartment');
  if (isStudent) dept.innerHTML = Object.entries(PROGRAMMES).map(([k, v]) => `<option value="${k}" ${k === profile.user.department ? 'selected' : ''}>${esc(v)}</option>`).join('');
  else { dept.innerHTML = '<option>Administration</option>'; dept.disabled = true; }
  f('#sameAsPhone').addEventListener('click', () => { f('#pWhatsapp').value = f('#pPhone').value; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    App.clearFieldErrors(form);
    await App.withLoading(form.querySelector('[type=submit]'), async () => {
      try {
        const res = await App.api('/api/me/profile', { fullName: f('#pName').value.trim(), phone: f('#pPhone').value.trim(), whatsapp: f('#pWhatsapp').value.trim(), department: dept.value }, 'PUT');
        App.updateUser(res.user);
        profile.user = res.user;
        renderCard();
        showToast(res.message, 'success');
      } catch (err) {
        if (!App.showFieldErrors(err, { fullName: 'pName', phone: 'pPhone', whatsapp: 'pWhatsapp', department: 'pDepartment' })) showToast(err.message, 'error');
      }
    });
  });

  // Password
  const pwForm = document.getElementById('passwordForm');
  bindPasswordFeedback({
    input: document.getElementById('newPassword'), list: document.getElementById('pwRequirements'),
    wrap: document.getElementById('strengthWrap'), fill: document.getElementById('strengthFill'), label: document.getElementById('strengthLabel'),
  }, () => ({ email: profile.user.email, fullName: f('#pName').value }));
  bindCapsLockWarnings();

  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    App.clearFieldErrors(pwForm);
    const current = pwForm.querySelector('#currentPassword').value;
    const next = pwForm.querySelector('#newPassword').value;
    let ok = true;
    if (!current) { setError('currentPassword', 'Enter your current password.'); ok = false; }
    const check = PasswordRules.validate(next, { email: profile.user.email, fullName: profile.user.fullName });
    if (!check.valid) { setError('newPassword', check.errors[0]); ok = false; }
    if (next !== pwForm.querySelector('#confirmNewPassword').value) { setError('confirmNewPassword', 'Passwords do not match.'); ok = false; }
    if (!ok) return;
    await App.withLoading(pwForm.querySelector('[type=submit]'), async () => {
      try {
        const res = await App.api('/api/me/password', { currentPassword: current, newPassword: next });
        pwForm.reset();
        document.getElementById('newPassword').dispatchEvent(new Event('input'));
        showToast(res.message, 'success');
      } catch (err) { if (!App.showFieldErrors(err)) showToast(err.message, 'error'); }
    });
  });

  // Deactivate account
  document.getElementById('deactivateBtn').addEventListener('click', async () => {
    let blockers = [];
    try { ({ blockers } = await App.api('/api/me/deactivation-check')); } catch { /* server re-checks */ }
    const m = App.modal({
      title: 'Deactivate account', icon: 'fa-user-slash',
      body: blockers.length
        ? `<div class="notice warning"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>You can't deactivate yet</strong>${esc(blockers.join(' and '))}. Finish or cancel them first.</div></div>`
        : `<p style="font-size:14px;color:var(--gray-700);margin-bottom:14px;">Your listings will be removed and you will be signed out. You will not be able to sign in again unless an admin restores your account.</p>
           <div class="form-group" style="margin-bottom:0;"><label for="deactivatePassword">Confirm with your password</label>
             <input type="password" id="deactivatePassword" class="form-control" autocomplete="current-password" /><span class="error-msg" id="deactivatePasswordErr"></span></div>`,
      footer: blockers.length ? '<button type="button" class="btn-secondary" data-close>Close</button>'
        : '<button type="button" class="btn-secondary" data-close>Cancel</button><button type="button" class="btn-primary btn-danger" id="deactivateOk">Deactivate</button>',
    });
    m.el.querySelector('#deactivateOk')?.addEventListener('click', async e => {
      await App.withLoading(e.currentTarget, async () => {
        try {
          await App.api('/api/me/deactivate', { password: m.el.querySelector('#deactivatePassword').value });
          window.location.replace('login.html?deactivated=1');
        } catch (err) { if (!App.showFieldErrors(err)) showToast(err.message, 'error'); }
      });
    });
  });
});
