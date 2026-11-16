/* ============================================================
   Campus Hardware Lending System – Auth Shared JS
   Talks to the Express API in server.js (cookies are HttpOnly,
   so the browser never stores passwords or session tokens).
   ============================================================ */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_DOMAINS = ['@student.tarc.edu.my', '@admin.com'];

function isAllowedEmail(email) {
  return ALLOWED_DOMAINS.some(domain => email.trim().toLowerCase().endsWith(domain));
}

/* ── API helper ───────────────────────────────────── */
async function apiRequest(url, data, method) {
  const verb = method || (data ? 'POST' : 'GET');
  let res;
  try {
    res = await fetch(url, {
      method: verb,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: verb === 'GET' ? undefined : JSON.stringify(data || {}),
    });
  } catch {
    throw new Error('Cannot reach the server. Make sure it is running with "npm run dev".');
  }
  let body = {};
  try { body = await res.json(); } catch { /* empty or non-JSON response */ }
  return { ok: res.ok, status: res.status, data: body };
}

/* ── Shared Utilities ─────────────────────────────── */
function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show ' + (type !== 'default' ? type : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon  = btn.querySelector('i');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  icon.classList.replace(show ? 'fa-eye' : 'fa-eye-slash', show ? 'fa-eye-slash' : 'fa-eye');
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function setError(fieldId, msg) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(fieldId + 'Err');
  if (input) { input.classList.add('invalid'); input.classList.remove('valid'); input.setAttribute('aria-invalid', 'true'); }
  if (err)   err.textContent = msg;
}

function clearError(fieldId, markValid = true) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(fieldId + 'Err');
  if (input) {
    input.classList.remove('invalid');
    input.classList.toggle('valid', markValid);
    input.removeAttribute('aria-invalid');
  }
  if (err) err.textContent = '';
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
}

function showAlert(id, message, type = 'error') {
  const box = document.getElementById(id);
  if (!box) return;
  if (!message) { box.hidden = true; return; }
  const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'warning' ? 'fa-lock' : 'fa-circle-check';
  box.className = 'form-alert ' + type;
  box.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
  box.querySelector('span').textContent = message;
  box.hidden = false;
}

/* ── Password feedback (strength bar + checklist) ─── */
const PASSWORD_REQUIREMENTS = [
  ['length',   'At least 10 characters'],
  ['upper',    'One uppercase letter (A–Z)'],
  ['lower',    'One lowercase letter (a–z)'],
  ['number',   'One number (0–9)'],
  ['special',  'One special character (!@#$…)'],
  ['personal', 'Does not contain your name or email'],
  ['common',   'Not a commonly used password'],
];

function renderRequirementList(listEl) {
  listEl.innerHTML = PASSWORD_REQUIREMENTS.map(([key, text]) => `
    <li class="req-item" data-req="${key}">
      <span class="req-icon"><i class="fa-solid fa-circle" aria-hidden="true"></i></span>
      <span>${text}</span>
    </li>`).join('');
}

/**
 * Wire live password feedback to an input.
 * @param {object} els  - { input, list, wrap, fill, label }
 * @param {Function} getContext - returns { email, fullName } for personal-info checks
 */
function bindPasswordFeedback(els, getContext) {
  if (!els.input || !els.list) return;
  renderRequirementList(els.list);

  const update = () => {
    const value  = els.input.value;
    const checks = PasswordRules.getChecks(value, getContext());
    const typing = value.length > 0;

    els.list.querySelectorAll('.req-item').forEach(item => {
      const met  = checks[item.dataset.req];
      const icon = item.querySelector('i');
      item.classList.toggle('met', typing && met);
      item.classList.toggle('unmet', typing && !met);
      icon.className = 'fa-solid ' + (!typing ? 'fa-circle' : met ? 'fa-check' : 'fa-xmark');
    });

    if (!els.wrap) return;
    els.wrap.hidden = !typing;
    if (!typing) return;

    const met = Object.values(checks).filter(Boolean).length;
    const all = met === PASSWORD_REQUIREMENTS.length;
    const level = all && value.length >= 14 ? 4
                : all ? 3
                : met >= 5 ? 2
                : met >= 3 ? 1 : 0;
    const levels = [
      { pct: '20%',  color: '#EF4444', text: 'Very weak' },
      { pct: '40%',  color: '#F97316', text: 'Weak' },
      { pct: '60%',  color: '#F59E0B', text: 'Fair' },
      { pct: '80%',  color: '#1976D2', text: 'Strong' },
      { pct: '100%', color: '#16A34A', text: 'Very strong' },
    ];
    const lvl = levels[level];
    els.fill.style.width      = lvl.pct;
    els.fill.style.background = lvl.color;
    els.label.textContent     = lvl.text;
    els.label.style.color     = lvl.color;
  };

  els.input.addEventListener('input', update);
  update();
  return update;
}

/* ── Caps Lock warning ────────────────────────────── */
function bindCapsLockWarnings() {
  document.querySelectorAll('.caps-warning').forEach(warning => {
    const input = document.getElementById(warning.dataset.for);
    if (!input) return;
    const check = e => { if (e.getModifierState) warning.hidden = !e.getModifierState('CapsLock'); };
    input.addEventListener('keydown', check);
    input.addEventListener('keyup', check);
    input.addEventListener('blur', () => { warning.hidden = true; });
  });
}

/* ── LOGIN FORM ───────────────────────────────────── */
function validateLoginEmail(email) {
  if (!email) return 'Please enter your email address.';
  if (!EMAIL_REGEX.test(email)) return 'Please enter a valid email address.';
  return '';
}

async function handleLogin(e) {
  e.preventDefault();
  showAlert('loginAlert', '');

  const emailInput = document.getElementById('userEmail');
  const pwInput    = document.getElementById('password');
  const email      = emailInput.value.trim();
  const password   = pwInput.value;
  let valid = true;

  const emailError = validateLoginEmail(email);
  if (emailError) { setError('userEmail', emailError); valid = false; }
  else clearError('userEmail', false);

  if (!password) { setError('password', 'Please enter your password.'); valid = false; }
  else clearError('password', false);

  if (!valid) {
    (emailError ? emailInput : pwInput).focus();
    return;
  }

  const btn = document.getElementById('loginBtn');
  setLoading(btn, true);
  try {
    const remember = document.getElementById('rememberMe').checked;
    const { ok, status, data } = await apiRequest('/api/auth/login', { email, password, remember });

    if (ok) {
      try {
        if (remember) localStorage.setItem('chh_remembered_email', email.toLowerCase());
        else localStorage.removeItem('chh_remembered_email');
      } catch { /* storage unavailable */ }
      showToast('Signed in. Opening your dashboard…', 'success');
      window.location.href = 'dashboard.html';
      return;
    }

    pwInput.value = '';
    pwInput.focus();
    if (status === 423) {
      showAlert('loginAlert', data.error, 'warning');
    } else {
      showAlert('loginAlert', data.error || 'Unable to sign in. Please try again.', 'error');
      pwInput.classList.add('invalid');
    }
  } catch (error) {
    showAlert('loginAlert', error.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* ── FORGOT PASSWORD MODAL ────────────────────────── */
let resetEmailValue = '';

function showForgotModal() {
  const m = document.getElementById('forgotModal');
  if (!m) return;
  const loginEmail = document.getElementById('userEmail')?.value.trim();
  const resetEmail = document.getElementById('resetEmail');
  if (loginEmail && resetEmail && !resetEmail.value) resetEmail.value = loginEmail;
  goToResetStep(1);
  m.classList.add('open');
  setTimeout(() => resetEmail?.focus(), 50);
}

function hideForgotModal() {
  const m = document.getElementById('forgotModal');
  if (!m) return;
  m.classList.remove('open');
  ['resetEmail', 'resetCode', 'resetPassword', 'resetConfirm'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
    clearError(id, false);
  });
  document.getElementById('resetPassword')?.dispatchEvent(new Event('input'));
  goToResetStep(1);
}

function closeForgotModal(e) {
  if (e.target === e.currentTarget) hideForgotModal();
}

function goToResetStep(step) {
  document.getElementById('resetStep1')?.classList.toggle('active', step === 1);
  document.getElementById('resetStep2')?.classList.toggle('active', step === 2);
}

async function requestResetCode(e) {
  e.preventDefault();
  const input = document.getElementById('resetEmail');
  const email = input.value.trim();
  const error = validateLoginEmail(email);
  if (error) { setError('resetEmail', error); input.focus(); return; }
  clearError('resetEmail', false);

  const btn = document.getElementById('resetRequestBtn');
  setLoading(btn, true);
  try {
    const { ok, data } = await apiRequest('/api/auth/forgot', { email });
    if (!ok) { setError('resetEmail', data.error || 'Unable to send a code right now.'); return; }

    resetEmailValue = email;
    document.getElementById('resetSentText').textContent =
      `If an account exists for ${email}, a 6-digit code has been sent. It expires in 15 minutes.`;
    const devBox = document.getElementById('devCodeBox');
    if (data.devCode) {
      document.getElementById('devCode').textContent = data.devCode;
      devBox.hidden = false;
    } else {
      devBox.hidden = true;
    }
    goToResetStep(2);
    document.getElementById('resetCode').focus();
  } catch (err) {
    setError('resetEmail', err.message);
  } finally {
    setLoading(btn, false);
  }
}

async function submitNewPassword(e) {
  e.preventDefault();
  const code     = document.getElementById('resetCode').value.trim();
  const password = document.getElementById('resetPassword').value;
  const confirm  = document.getElementById('resetConfirm').value;
  let valid = true;

  if (!/^\d{6}$/.test(code)) { setError('resetCode', 'Enter the 6-digit code.'); valid = false; }
  else clearError('resetCode', false);

  const result = PasswordRules.validate(password, { email: resetEmailValue });
  if (!result.valid) { setError('resetPassword', result.errors[0]); valid = false; }
  else clearError('resetPassword');

  if (!confirm) { setError('resetConfirm', 'Please confirm your new password.'); valid = false; }
  else if (confirm !== password) { setError('resetConfirm', 'Passwords do not match.'); valid = false; }
  else clearError('resetConfirm');

  if (!valid) return;

  const btn = document.getElementById('resetSubmitBtn');
  setLoading(btn, true);
  try {
    const { ok, data } = await apiRequest('/api/auth/reset', { email: resetEmailValue, code, password });
    if (!ok) {
      if (data.fields?.code) setError('resetCode', data.fields.code);
      if (data.fields?.password) setError('resetPassword', data.fields.password);
      if (!data.fields) showToast(data.error || 'Unable to reset password.', 'error');
      return;
    }
    const email = resetEmailValue;
    hideForgotModal();
    document.getElementById('userEmail').value = email;
    document.getElementById('password').focus();
    showAlert('loginAlert', data.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* ── Page setup ───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindCapsLockWarnings();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('forgotModal')?.classList.contains('open')) hideForgotModal();
  });

  const emailInput = document.getElementById('userEmail');
  const pwInput    = document.getElementById('password');
  if (!emailInput || !pwInput) return;   // not the login page

  try {
    const rememberedEmail = localStorage.getItem('chh_remembered_email');
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
      document.getElementById('rememberMe').checked = true;
      pwInput.focus();
    } else {
      emailInput.focus();
    }
  } catch { emailInput.focus(); }

  emailInput.addEventListener('input', () => {
    if (!validateLoginEmail(emailInput.value.trim())) clearError('userEmail', false);
  });
  pwInput.addEventListener('input', () => {
    if (pwInput.value) clearError('password', false);
  });

  // Reset modal password feedback
  bindPasswordFeedback({
    input: document.getElementById('resetPassword'),
    list:  document.getElementById('resetRequirements'),
    wrap:  document.getElementById('resetStrengthWrap'),
    fill:  document.getElementById('resetStrengthFill'),
    label: document.getElementById('resetStrengthLabel'),
  }, () => ({ email: resetEmailValue }));

  const resetCode = document.getElementById('resetCode');
  resetCode?.addEventListener('input', () => {
    resetCode.value = resetCode.value.replace(/\D/g, '').slice(0, 6);
  });

  // Session expired / logged out notices passed from other pages
  const params = new URLSearchParams(window.location.search);
  if (params.get('registered')) showAlert('loginAlert', 'Account created successfully. Please sign in.', 'success');
  if (params.get('loggedout'))  showAlert('loginAlert', 'You have been signed out.', 'success');
  if (params.get('expired'))    showAlert('loginAlert', 'Your session has expired. Please sign in again.', 'warning');
  if (params.get('deactivated')) showAlert('loginAlert', 'Your account has been deactivated. Contact the system admin if you want it restored.', 'success');
});
