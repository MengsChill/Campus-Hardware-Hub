/* ============================================================
   Campus Hardware Hub – Auth Shared JS (login.html)
   ============================================================ */

/* ── Shared Utilities ─────────────────────────────── */

/**
 * Show a toast notification
 * @param {string} message
 * @param {'default'|'success'|'error'} type
 */
function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show ' + (type !== 'default' ? type : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}

/**
 * Toggle password visibility
 * @param {string} inputId
 * @param {HTMLElement} btn
 */
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

/**
 * Set an error message on a field
 */
function setError(fieldId, msg) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(fieldId + 'Err');
  if (input) input.classList.add('invalid');
  if (input) input.classList.remove('valid');
  if (err)   err.textContent = msg;
}

/**
 * Clear an error on a field
 */
function clearError(fieldId) {
  const input = document.getElementById(fieldId);
  const err   = document.getElementById(fieldId + 'Err');
  if (input) input.classList.remove('invalid');
  if (input) input.classList.add('valid');
  if (err)   err.textContent = '';
}

/* ── Role Switcher ────────────────────────────────── */
let currentRole = 'student';

function switchRole(btn) {
  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  currentRole = btn.dataset.role;

  // Update placeholder labels
  const idLabel    = document.getElementById('idLabel')    || document.getElementById('regIdLabel');
  const deptLabel  = document.getElementById('deptLabel');
  const deptSelect = document.getElementById('department');

  if (idLabel) {
    idLabel.textContent = currentRole === 'student' ? 'Student ID' :
                          currentRole === 'staff'   ? 'Staff ID'   : 'Admin ID';
  }

  const userInput  = document.getElementById('userId') || document.getElementById('regUserId');
  if (userInput) {
    userInput.placeholder = currentRole === 'student' ? 'e.g. S12345678' :
                            currentRole === 'staff'   ? 'e.g. T98765432' : 'e.g. A00001';
  }

  // Adjust department dropdown for staff
  if (deptLabel && deptSelect) {
    if (currentRole === 'staff') {
      deptLabel.textContent = 'Department';
      // Replace optgroups with staff departments
      deptSelect.innerHTML = `
        <option value="" disabled selected>Select your department</option>
        <option value="lab">Laboratory & Equipment</option>
        <option value="eng_dept">Engineering Department</option>
        <option value="cs_dept">Computing Department</option>
        <option value="maintenance">Facilities & Maintenance</option>
        <option value="library">Library Services</option>
        <option value="admin_dept">Administration</option>
        <option value="research">Research & Development</option>
      `;
    } else {
      deptLabel.textContent = 'Course / Programme';
      deptSelect.innerHTML = `
        <option value="" disabled selected>Select your course / department</option>
        <optgroup label="School of Engineering" id="engGroup">
          <option value="civil">Civil Engineering</option>
          <option value="electrical">Electrical Engineering</option>
          <option value="mechanical">Mechanical Engineering</option>
          <option value="computer">Computer Engineering</option>
          <option value="electronic">Electronics Engineering</option>
        </optgroup>
        <optgroup label="School of Computing" id="csGroup">
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

  const userId   = document.getElementById('userId');
  const password = document.getElementById('password');

  // Clear previous errors
  clearError('userId');
  clearError('password');

  // Validate ID
  if (!userId || !userId.value.trim()) {
    setError('userId', 'Please enter your ID.');
    valid = false;
  } else {
    clearError('userId');
  }

  // Validate Password
  if (!password || !password.value) {
    setError('password', 'Please enter your password.');
    valid = false;
  } else if (password.value.length < 6) {
    setError('password', 'Password must be at least 6 characters.');
    valid = false;
  } else {
    clearError('password');
  }

  if (!valid) return;

  // Simulate login
  const btn = document.getElementById('loginBtn');
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }

  setTimeout(() => {
    // ---- Replace this block with real auth logic ----
    const demoAccounts = [
      { id: 'S12345678', password: 'Student@1', role: 'student' },
      { id: 'T98765432', password: 'Staff@123', role: 'staff'   },
      { id: 'A00001',    password: 'Admin@123', role: 'admin'   },
    ];

    const match = demoAccounts.find(
      a => a.id === userId.value.trim() && a.password === password.value && a.role === currentRole
    );

    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }

    if (match) {
      showToast('Sign-in successful! Redirecting…', 'success');
      // Store session info
      sessionStorage.setItem('chh_user', JSON.stringify({ id: match.id, role: match.role }));
      // TODO: Redirect to dashboard
      // setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
    } else {
      setError('password', 'Invalid credentials. Please check your ID and password.');
      showToast('Login failed. Please try again.', 'error');
    }
    // ---- End replace block ----
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
  err.textContent = '';
  email.classList.remove('invalid');
  email.classList.add('valid');

  // Simulate send
  succ.style.display = 'flex';
  showToast('Reset link sent to ' + email.value.trim(), 'success');
}

/* ── Live validation on input ─────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const userId   = document.getElementById('userId');
  const password = document.getElementById('password');

  if (userId)   userId.addEventListener('input',   () => { if (userId.value.trim())   clearError('userId');   });
  if (password) password.addEventListener('input', () => { if (password.value.length >= 6) clearError('password'); });
});

