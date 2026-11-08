/* ============================================================
   Campus Hardware Hub – Auth Shared JS
   ============================================================ */

/* ── Allowed email domains ────────────────────────── */
const ALLOWED_DOMAINS = ['@student.tarc.edu.my', '@admin.com'];

function isAllowedEmail(email) {
  return ALLOWED_DOMAINS.some(domain => email.trim().toLowerCase().endsWith(domain));
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
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
}

function setError(fieldId, msg) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(fieldId + 'Err');
  if (input) { input.classList.add('invalid'); input.classList.remove('valid'); }
  if (err)   err.textContent = msg;
}

function clearError(fieldId) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(fieldId + 'Err');
  if (input) { input.classList.remove('invalid'); input.classList.add('valid'); }
  if (err)   err.textContent = '';
}

/* ── Role Switcher (register page only) ───────────── */
let currentRole = 'student';

function switchRole(btn) {
  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  currentRole = btn.dataset.role;

  const idLabel   = document.getElementById('regIdLabel');
  const emailHint = document.getElementById('emailHint');
  const deptLabel = document.getElementById('deptLabel');
  const deptSelect= document.getElementById('department');
  const emailInput= document.getElementById('email');
  const userInput = document.getElementById('regUserId');

  if (idLabel) {
    idLabel.textContent = currentRole === 'student' ? 'Student ID' : 'Staff ID';
  }
  if (userInput) {
    userInput.placeholder = currentRole === 'student' ? 'e.g. 21WMR12345' : 'e.g. T98765432';
  }
  if (emailHint) {
    emailHint.textContent = currentRole === 'student' ? '(@student.tarc.edu.my)' : '(@staff.tarc.edu.my)';
  }
  if (emailInput) {
    emailInput.placeholder = currentRole === 'student'
      ? 'yourname@student.tarc.edu.my'
      : 'yourname@staff.tarc.edu.my';
  }

  // Adjust department dropdown for staff
  if (deptLabel && deptSelect) {
    if (currentRole === 'staff') {
      deptLabel.textContent = 'Department';
      deptSelect.innerHTML = `
        <option value="" disabled selected>Select your department</option>
        <option value="lab">Laboratory &amp; Equipment</option>
        <option value="eng_dept">Engineering Department</option>
        <option value="cs_dept">Computing Department</option>
        <option value="maintenance">Facilities &amp; Maintenance</option>
        <option value="library">Library Services</option>
        <option value="admin_dept">Administration</option>
        <option value="research">Research &amp; Development</option>
      `;
    } else {
      deptLabel.textContent = 'Course / Programme';
      deptSelect.innerHTML = `
        <option value="" disabled selected>Select your course / department</option>
        <optgroup label="School of Engineering">
          <option value="civil">Civil Engineering</option>
          <option value="electrical">Electrical Engineering</option>
          <option value="mechanical">Mechanical Engineering</option>
          <option value="computer">Computer Engineering</option>
          <option value="electronic">Electronics Engineering</option>
        </optgroup>
        <optgroup label="School of Computing">
          <option value="cs">Computer Science</option>
          <option value="it">Information Technology</option>
          <option value="se">Software Engineering</option>
          <option value="ds">Data Science</option>
          <option value="cyber">Cybersecurity</option>
        </optgroup>
        <optgroup label="School of Design">
          <option value="id">Industrial Design</option>
          <option value="arch">Architecture</option>
        </optgroup>
      `;
    }
  }
}

/* ── LOGIN FORM ───────────────────────────────────── */
function handleLogin(e) {
  e.preventDefault();
  let valid = true;

  const emailInput = document.getElementById('userEmail');
  const pwInput    = document.getElementById('password');
  const email      = emailInput ? emailInput.value.trim() : '';
  const password   = pwInput    ? pwInput.value           : '';

  // Clear previous errors
  clearError('userEmail');
  clearError('password');

  // ── Validate Email ──────────────────────────────
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email) {
    setError('userEmail', 'Please enter your email address.');
    valid = false;
  } else if (!emailRegex.test(email)) {
    setError('userEmail', 'Please enter a valid email address.');
    valid = false;
  } else if (!isAllowedEmail(email)) {
    setError('userEmail', 'Only @student.tarc.edu.my or @admin.com emails are allowed.');
    valid = false;
  } else {
    clearError('userEmail');
  }

  // ── Validate Password ───────────────────────────
  if (!password) {
    setError('password', 'Please enter your password.');
    valid = false;
  } else if (password.length < 6) {
    setError('password', 'Password must be at least 6 characters.');
    valid = false;
  } else {
    clearError('password');
  }

  if (!valid) return;

  // Simulate login with loading state
  const btn = document.getElementById('loginBtn');
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }

  setTimeout(() => {
    // ---- Demo accounts – replace with real auth later ----
    const demoAccounts = [
      { email: 'ahmad@student.tarc.edu.my', password: 'Student@1' },
      { email: 'sara@student.tarc.edu.my',  password: 'Student@1' },
      { email: 'admin@admin.com',            password: 'Admin@123' },
    ];

    const match = demoAccounts.find(
      a => a.email === email.toLowerCase() && a.password === password
    );

    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }

    if (match) {
      const role = email.endsWith('@admin.com') ? 'admin' : 'student';
      sessionStorage.setItem('chh_user', JSON.stringify({ email, role }));
      showToast('Sign-in successful! Redirecting…', 'success');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
    } else {
      setError('password', 'Incorrect email or password. Please try again.');
      showToast('Login failed. Please check your credentials.', 'error');
    }
  }, 1200);
}

/* ── FORGOT PASSWORD MODAL ────────────────────────── */
function showForgotModal() {
  const m = document.getElementById('forgotModal');
  if (m) m.classList.add('open');
}
function hideForgotModal() {
  const m = document.getElementById('forgotModal');
  if (m) m.classList.remove('open');
  const s = document.getElementById('resetSuccess');
  if (s) s.style.display = 'none';
  const inp = document.getElementById('resetEmail');
  if (inp) { inp.value = ''; inp.classList.remove('invalid', 'valid'); }
  const err = document.getElementById('resetEmailErr');
  if (err) err.textContent = '';
}
function closeForgotModal(e) {
  if (e.target === e.currentTarget) hideForgotModal();
}

function sendReset() {
  const email = document.getElementById('resetEmail');
  const err   = document.getElementById('resetEmailErr');
  const succ  = document.getElementById('resetSuccess');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email.value.trim()) {
    err.textContent = 'Please enter your email address.';
    email.classList.add('invalid');
    return;
  }
  if (!emailRegex.test(email.value.trim())) {
    err.textContent = 'Please enter a valid email address.';
    email.classList.add('invalid');
    return;
  }
  if (!isAllowedEmail(email.value.trim())) {
    err.textContent = 'Only campus email addresses are allowed.';
    email.classList.add('invalid');
    return;
  }
  err.textContent = '';
  email.classList.remove('invalid');
  email.classList.add('valid');
  succ.style.display = 'flex';
  showToast('Reset link sent to ' + email.value.trim(), 'success');
}

/* ── Live validation on login inputs ──────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.getElementById('userEmail');
  const pwInput    = document.getElementById('password');

  if (emailInput) {
    emailInput.addEventListener('input', () => {
      const val = emailInput.value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (val && emailRegex.test(val) && isAllowedEmail(val)) {
        clearError('userEmail');
      }
    });
  }

  if (pwInput) {
    pwInput.addEventListener('input', () => {
      if (pwInput.value.length >= 6) clearError('password');
    });
  }
});
