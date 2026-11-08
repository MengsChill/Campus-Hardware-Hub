/* ============================================================
   Campus Hardware Hub – Register Page JS
   ============================================================ */

let currentStep = 1;

/* ── Step Navigation ──────────────────────────────── */
function nextStep(toStep) {
  if (!validateStep(currentStep)) return;
  goToStep(toStep);
}
function prevStep(toStep) {
  goToStep(toStep);
}
function goToStep(toStep) {
  document.getElementById('formStep' + currentStep).classList.remove('active');
  document.getElementById('formStep' + toStep).classList.add('active');
  updateProgress(toStep);
  currentStep = toStep;
}
function updateProgress(step) {
  for (let i = 1; i <= 3; i++) {
    const dot      = document.getElementById('step-dot-' + i);
    const lineBefore = dot ? dot.previousElementSibling : null;
    if (!dot) continue;
    dot.classList.remove('active', 'done');
    if (i < step)  dot.classList.add('done');
    if (i === step) dot.classList.add('active');
    if (lineBefore && lineBefore.classList.contains('step-line')) {
      i <= step ? lineBefore.classList.add('done') : lineBefore.classList.remove('done');
    }
  }
}

/* ── Validation per Step ──────────────────────────── */
function validateStep(step) {
  if (step === 1) return validateStep1();
  if (step === 2) return validateStep2();
  if (step === 3) return validateStep3();
  return true;
}

function validateStep1() {
  let valid = true;

  // Full Name
  const fullName = document.getElementById('fullName');
  if (!fullName.value.trim() || fullName.value.trim().length < 3) {
    setError('fullName', 'Please enter your full name (min. 3 characters).');
    valid = false;
  } else {
    clearError('fullName');
  }

  // Email
  const email = document.getElementById('email');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.value.trim()) {
    setError('email', 'Email address is required.');
    valid = false;
  } else if (!emailRegex.test(email.value.trim())) {
    setError('email', 'Please enter a valid email address.');
    valid = false;
  } else if (currentRole === 'student' && !email.value.trim().toLowerCase().endsWith('@student.tarc.edu.my')) {
    setError('email', 'Students must use a @student.tarc.edu.my email.');
    valid = false;
  } else {
    clearError('email');
  }

  // Phone
  const phone = document.getElementById('phone');
  const phoneRegex = /^[0-9\-\+\s]{8,15}$/;
  if (!phone.value.trim()) {
    setError('phone', 'Phone number is required.');
    valid = false;
  } else if (!phoneRegex.test(phone.value.trim())) {
    setError('phone', 'Please enter a valid phone number (8–15 digits).');
    valid = false;
  } else {
    clearError('phone');
  }

  return valid;
}

function validateStep2() {
  let valid = true;

  const userId = document.getElementById('regUserId');
  if (!userId.value.trim() || userId.value.trim().length < 4) {
    setError('regUserId', 'Please enter a valid ID.');
    valid = false;
  } else {
    clearError('regUserId');
  }

  const dept = document.getElementById('department');
  if (!dept.value) {
    setError('department', 'Please select your course or department.');
    valid = false;
  } else {
    clearError('department');
  }

  return valid;
}

function validateStep3() {
  let valid = true;

  const pw  = document.getElementById('newPassword');
  const cpw = document.getElementById('confirmPassword');

  // Check all password requirements
  const checks = getPasswordChecks(pw.value);

  if (!pw.value) {
    setError('newPassword', 'Password is required.');
    valid = false;
  } else if (!checks.len) {
    setError('newPassword', 'Password must be between 6 and 8 characters.');
    valid = false;
  } else if (!checks.upper || !checks.num || !checks.special) {
    setError('newPassword', 'Password does not meet all requirements below.');
    valid = false;
  } else {
    clearError('newPassword');
  }

  if (!cpw.value) {
    setError('confirmPassword', 'Please confirm your password.');
    valid = false;
  } else if (cpw.value !== pw.value) {
    setError('confirmPassword', 'Passwords do not match.');
    valid = false;
  } else {
    clearError('confirmPassword');
  }

  const terms    = document.getElementById('agreeTerms');
  const termsErr = document.getElementById('termsErr');
  if (!terms.checked) {
    if (termsErr) termsErr.textContent = 'You must agree to the Terms of Use to continue.';
    valid = false;
  } else {
    if (termsErr) termsErr.textContent = '';
  }

  return valid;
}

/* ── Password Checks ──────────────────────────────── */
function getPasswordChecks(val) {
  return {
    len:     val.length >= 6 && val.length <= 8,
    upper:   /[A-Z]/.test(val),
    num:     /[0-9]/.test(val),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(val),
  };
}

/* ── Password Strength + Live Requirements ────────── */
function checkStrength(val) {
  const wrap  = document.getElementById('strengthWrap');
  const fill  = document.getElementById('strengthFill');
  const label = document.getElementById('strengthLabel');
  const checks = getPasswordChecks(val);

  // Update requirement tick boxes
  updateReq('req-len',     checks.len,     val.length > 0);
  updateReq('req-upper',   checks.upper,   val.length > 0);
  updateReq('req-num',     checks.num,     val.length > 0);
  updateReq('req-special', checks.special, val.length > 0);

  // Hide strength bar when empty
  if (!val) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const score = Object.values(checks).filter(Boolean).length;
  const levels = [
    { pct: '20%',  color: '#EF4444', text: 'Very Weak' },
    { pct: '45%',  color: '#F97316', text: 'Weak'      },
    { pct: '65%',  color: '#F59E0B', text: 'Fair'      },
    { pct: '85%',  color: '#84CC16', text: 'Good'      },
    { pct: '100%', color: '#22C55E', text: 'Strong'    },
  ];
  const lvl = levels[score - 1] || levels[0];
  fill.style.width      = lvl.pct;
  fill.style.background = lvl.color;
  label.textContent     = lvl.text;
  label.style.color     = lvl.color;
}

/**
 * Update a single requirement item
 * @param {string}  id      - element id
 * @param {boolean} met     - whether the requirement is satisfied
 * @param {boolean} typing  - whether the user has started typing
 */
function updateReq(id, met, typing) {
  const el   = document.getElementById(id);
  const icon = el ? el.querySelector('.req-icon i') : null;
  if (!el || !icon) return;

  el.classList.remove('met', 'unmet');

  if (!typing) {
    // User hasn't typed yet — neutral/gray state
    icon.className = 'fa-solid fa-circle-xmark';
    return;
  }

  if (met) {
    el.classList.add('met');
    icon.className = 'fa-solid fa-circle-check';
  } else {
    el.classList.add('unmet');
    icon.className = 'fa-solid fa-circle-xmark';
  }
}

/* ── Register Submit ──────────────────────────────── */
function handleRegister(e) {
  e.preventDefault();
  if (!validateStep3()) return;

  const btn = document.getElementById('registerBtn');
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }

  setTimeout(() => {
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }

    const formData = {
      role:       currentRole,
      fullName:   document.getElementById('fullName').value.trim(),
      email:      document.getElementById('email').value.trim(),
      phone:      document.getElementById('phone').value.trim(),
      userId:     document.getElementById('regUserId').value.trim(),
      department: document.getElementById('department').value,
    };
    console.log('[CHH] New Account Registration:', formData);

    const modal = document.getElementById('successModal');
    if (modal) modal.classList.add('open');
  }, 1500);
}

/* ── Live Validation on Input ─────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Full name
  const fullName = document.getElementById('fullName');
  if (fullName) fullName.addEventListener('input', () => {
    if (fullName.value.trim().length >= 3) clearError('fullName');
  });

  // Email
  const email = document.getElementById('email');
  if (email) email.addEventListener('input', () => {
    const v = email.value.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) clearError('email');
  });

  // Phone
  const phone = document.getElementById('phone');
  if (phone) phone.addEventListener('input', () => {
    if (/^[0-9\-\+\s]{8,15}$/.test(phone.value.trim())) clearError('phone');
  });

  // User ID
  const uid = document.getElementById('regUserId');
  if (uid) uid.addEventListener('input', () => {
    if (uid.value.trim().length >= 4) clearError('regUserId');
  });

  // Department
  const dept = document.getElementById('department');
  if (dept) dept.addEventListener('change', () => {
    if (dept.value) clearError('department');
  });

  // Confirm password real-time match
  const cpw = document.getElementById('confirmPassword');
  if (cpw) {
    cpw.addEventListener('input', () => {
      const pw = document.getElementById('newPassword');
      if (pw && cpw.value && pw.value === cpw.value) {
        clearError('confirmPassword');
      } else if (cpw.value) {
        setError('confirmPassword', 'Passwords do not match.');
      }
    });
  }

  // Terms checkbox
  const terms = document.getElementById('agreeTerms');
  if (terms) terms.addEventListener('change', () => {
    const termsErr = document.getElementById('termsErr');
    if (terms.checked && termsErr) termsErr.textContent = '';
  });
});
