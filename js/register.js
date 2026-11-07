/* ============================================================
   Campus Hardware Hub – Register Page JS (register.js)
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
  // Hide current, show target
  document.getElementById('formStep' + currentStep).classList.remove('active');
  document.getElementById('formStep' + toStep).classList.add('active');

  // Update progress dots
  updateProgress(toStep);
  currentStep = toStep;
}

function updateProgress(step) {
  for (let i = 1; i <= 3; i++) {
    const dot      = document.getElementById('step-dot-' + i);
    const lineBefore = dot ? dot.previousElementSibling : null;

    if (!dot) continue;
    dot.classList.remove('active', 'done');

    if (i < step)  { dot.classList.add('done'); }
    if (i === step){ dot.classList.add('active'); }

    // Color the connecting lines
    if (lineBefore && lineBefore.classList.contains('step-line')) {
      if (i <= step) {
        lineBefore.classList.add('done');
      } else {
        lineBefore.classList.remove('done');
      }
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
  if (!fullName.value.trim()) {
    setError('fullName', 'Full name is required.');
    valid = false;
  } else if (fullName.value.trim().length < 3) {
    setError('fullName', 'Please enter your full name.');
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
    setError('phone', 'Please enter a valid phone number.');
    valid = false;
  } else {
    clearError('phone');
  }

  return valid;
}

function validateStep2() {
  let valid = true;

  // ID
  const userId = document.getElementById('regUserId');
  if (!userId.value.trim()) {
    setError('regUserId', 'ID is required.');
    valid = false;
  } else if (userId.value.trim().length < 4) {
    setError('regUserId', 'Please enter a valid ID.');
    valid = false;
  } else {
    clearError('regUserId');
  }

  // Department / Course
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
  const terms = document.getElementById('agreeTerms');

  // Password
  if (!pw.value) {
    setError('newPassword', 'Password is required.');
    valid = false;
  } else if (pw.value.length < 8) {
    setError('newPassword', 'Password must be at least 8 characters.');
    valid = false;
  } else {
    clearError('newPassword');
  }

  // Confirm Password
  if (!cpw.value) {
    setError('confirmPassword', 'Please confirm your password.');
    valid = false;
  } else if (cpw.value !== pw.value) {
    setError('confirmPassword', 'Passwords do not match.');
    valid = false;
  } else {
    clearError('confirmPassword');
  }

  // Terms
  const termsErr = document.getElementById('termsErr');
  if (!terms.checked) {
    if (termsErr) termsErr.textContent = 'You must agree to the Terms of Use to continue.';
    valid = false;
  } else {
    if (termsErr) termsErr.textContent = '';
  }

  return valid;
}

/* ── Password Strength Checker ────────────────────── */
function checkStrength(val) {
  const wrap  = document.getElementById('strengthWrap');
  const fill  = document.getElementById('strengthFill');
  const label = document.getElementById('strengthLabel');

  // Requirements
  const hasLen     = val.length >= 8;
  const hasUpper   = /[A-Z]/.test(val);
  const hasNum     = /[0-9]/.test(val);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(val);

  updateReq('req-len',     hasLen);
  updateReq('req-upper',   hasUpper);
  updateReq('req-num',     hasNum);
  updateReq('req-special', hasSpecial);

  if (!val) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const score = [hasLen, hasUpper, hasNum, hasSpecial].filter(Boolean).length;
  const levels = [
    { pct: '20%',  color: '#EF4444', text: 'Very Weak' },
    { pct: '40%',  color: '#F97316', text: 'Weak'      },
    { pct: '60%',  color: '#F59E0B', text: 'Fair'      },
    { pct: '80%',  color: '#84CC16', text: 'Good'      },
    { pct: '100%', color: '#22C55E', text: 'Strong'    },
  ];
  const lvl = levels[score - 1] || levels[0];
  fill.style.width      = lvl.pct;
  fill.style.background = lvl.color;
  label.textContent     = lvl.text;
  label.style.color     = lvl.color;
}

function updateReq(id, met) {
  const el = document.getElementById(id);
  if (!el) return;
  if (met) {
    el.classList.add('met');
  } else {
    el.classList.remove('met');
  }
}

/* ── Register Submit ──────────────────────────────── */
function handleRegister(e) {
  e.preventDefault();
  if (!validateStep3()) return;

  const btn = document.getElementById('registerBtn');
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }

  // Simulate API call
  setTimeout(() => {
    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }

    // Collect form data (for demo)
    const formData = {
      role:       currentRole,
      fullName:   document.getElementById('fullName').value.trim(),
      email:      document.getElementById('email').value.trim(),
      phone:      document.getElementById('phone').value.trim(),
      userId:     document.getElementById('regUserId').value.trim(),
      department: document.getElementById('department').value,
    };
    console.log('[CHH] New Account Registration:', formData);

    // Show success modal
    const modal = document.getElementById('successModal');
    if (modal) modal.classList.add('open');
  }, 1500);
}

/* ── Live Validation on Input ─────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const liveFields = {
    fullName:    () => document.getElementById('fullName').value.trim().length >= 3,
    email:       () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(document.getElementById('email').value.trim()),
    phone:       () => /^[0-9\-\+\s]{8,15}$/.test(document.getElementById('phone').value.trim()),
    regUserId:   () => document.getElementById('regUserId').value.trim().length >= 4,
    confirmPassword: () => {
      const a = document.getElementById('newPassword');
      const b = document.getElementById('confirmPassword');
      return a && b && b.value && a.value === b.value;
    },
  };

  Object.keys(liveFields).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (liveFields[id]()) clearError(id);
    });
  });

  // Department
  const dept = document.getElementById('department');
  if (dept) dept.addEventListener('change', () => { if (dept.value) clearError('department'); });

  // Confirm PW match in real time
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
});

