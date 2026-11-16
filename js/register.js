/* ============================================================
   Campus Hardware Lending System – Register Page JS
   ============================================================ */

let currentRole = 'student';

const STUDENT = {
  domain: '@student.tarc.edu.my',
  deptOptions: `
    <option value="" disabled selected>Select your programme</option>
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
    </optgroup>`,
};

/* ── Account type ─────────────────────────────────── */
function switchRole(btn) {
  currentRole = btn.dataset.role;
  document.querySelectorAll('.role-tab').forEach(tab => {
    tab.classList.toggle('active', tab === btn);
    tab.setAttribute('aria-selected', tab === btn ? 'true' : 'false');
  });
  const isAdmin = currentRole === 'admin';
  document.getElementById('adminCodeBox').hidden = !isAdmin;
  document.getElementById('departmentGroup').hidden = isAdmin;
  document.getElementById('emailLabel').textContent = isAdmin ? 'Work email' : 'University email';
  document.getElementById('email').placeholder = isAdmin ? 'name@admin.com' : 'yourname' + STUDENT.domain;
  document.getElementById('campusIdLabel').textContent = isAdmin ? 'Staff ID' : 'Student ID';
  document.getElementById('campusId').placeholder = isAdmin ? 'e.g. T98765432' : 'e.g. 21WMR12345';
  document.getElementById('fullName').placeholder = isAdmin ? 'Your full name' : 'As shown on your student card';
  document.getElementById('registerSubtitle').textContent = isAdmin
    ? 'Admin accounts need the secret code from the system administrator'
    : 'Register with your university email to rent and lend hardware';
  ['email', 'department', 'secretCode'].forEach(id => clearError(id, false));
  if (isAdmin) document.getElementById('secretCode').focus();
}

function isValidMalaysianPhone(value) {
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return false;

  let national = compact;
  if (compact.startsWith('+60')) national = '0' + compact.slice(3);
  else if (compact.startsWith('60')) national = '0' + compact.slice(2);

  const mobile = /^01(?:[15]\d{8}|[02-46-9]\d{7})$/.test(national);
  const landline = /^0[3-9]\d{7,8}$/.test(national);
  return mobile || landline;
}

/* ── Field Validation ─────────────────────────────── */
const getValue = id => document.getElementById(id).value;

const VALIDATORS = {
  fullName() {
    const v = getValue('fullName').trim();
    if (!v) return 'Please enter your full name.';
    if (v.length < 3) return 'Full name must be at least 3 characters.';
    if (!/^[\p{L}][\p{L} .'@/-]*$/u.test(v)) return 'Full name can only contain letters, spaces and . \' - / @';
    return '';
  },
  email() {
    const v = getValue('email').trim().toLowerCase();
    if (!v) return 'Please enter your email.';
    if (!EMAIL_REGEX.test(v)) return 'Please enter a valid email address.';
    if (currentRole === 'student' && !v.endsWith(STUDENT.domain)) return `Students must use their university email (${STUDENT.domain}).`;
    return '';
  },
  phone() {
    const v = getValue('phone');
    if (!v.trim()) return 'Please enter your phone number.';
    if (!isValidMalaysianPhone(v)) return 'Enter a valid Malaysian number, e.g. 011-12345678.';
    return '';
  },
  campusId() {
    const v = getValue('campusId').trim();
    if (!v) return `Please enter your ${currentRole === 'admin' ? 'Staff ID' : 'Student ID'}.`;
    if (!/^[A-Za-z0-9]{4,15}$/.test(v)) return 'ID must be 4–15 letters or numbers, no spaces.';
    return '';
  },
  department() {
    if (currentRole === 'admin') return '';
    return getValue('department') ? '' : 'Please select your programme.';
  },
  newPassword() {
    const v = getValue('newPassword');
    if (!v) return 'Please create a password.';
    const result = PasswordRules.validate(v, passwordContext());
    return result.valid ? '' : result.errors[0];
  },
  whatsapp() {
    const v = getValue('whatsapp');
    if (!v.trim()) return '';                       // optional – defaults to the phone number
    return isValidMalaysianPhone(v) ? '' : 'Enter a valid WhatsApp number, e.g. 011-12345678.';
  },
  secretCode() {
    if (currentRole !== 'admin') return '';
    return getValue('secretCode').trim() ? '' : 'Enter the admin secret code.';
  },
  confirmPassword() {
    const v = getValue('confirmPassword');
    if (!v) return 'Please confirm your password.';
    if (v !== getValue('newPassword')) return 'Passwords do not match.';
    return '';
  },
  agreeTerms() {
    return document.getElementById('agreeTerms').checked ? '' : 'You must agree to the Terms of Use to continue.';
  },
};

function passwordContext() {
  return { email: getValue('email').trim(), fullName: getValue('fullName').trim() };
}

function validateField(id) {
  const error = VALIDATORS[id]();
  if (error) setError(id, error);
  else clearError(id);
  return !error;
}

function validateAll() {
  const invalid = Object.keys(VALIDATORS).filter(id => !validateField(id));
  if (invalid.length) document.getElementById(invalid[0]).focus();
  return invalid.length === 0;
}

/* ── Register Submit ──────────────────────────────── */
async function handleRegister(e) {
  e.preventDefault();
  showAlert('registerAlert', '');
  if (!validateAll()) {
    showAlert('registerAlert', 'Please fix the highlighted fields before continuing.', 'error');
    return;
  }

  const btn = document.getElementById('registerBtn');
  setLoading(btn, true);
  try {
    const { ok, data } = await apiRequest('/api/auth/register', {
      role:       currentRole,
      secretCode: currentRole === 'admin' ? getValue('secretCode').trim() : undefined,
      whatsapp:   getValue('whatsapp').trim(),
      fullName:   getValue('fullName').trim(),
      email:      getValue('email').trim().toLowerCase(),
      phone:      getValue('phone').trim(),
      campusId:   getValue('campusId').trim(),
      department: getValue('department'),
      password:   getValue('newPassword'),
    });

    if (!ok) {
      // Map server field names onto the form's input ids.
      const fieldMap = { password: 'newPassword' };
      const fields = data.fields || {};
      Object.entries(fields).forEach(([name, msg]) => setError(fieldMap[name] || name, msg));
      const first = Object.keys(fields)[0];
      if (first) document.getElementById(fieldMap[first] || first)?.focus();
      showAlert('registerAlert', data.error || 'Unable to create your account. Please try again.', 'error');
      return;
    }

    ['newPassword', 'confirmPassword'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('successModal').classList.add('open');
  } catch (error) {
    showAlert('registerAlert', error.message, 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* ── Live Validation ──────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('department').innerHTML = STUDENT.deptOptions;

  const refreshPassword = bindPasswordFeedback({
    input: document.getElementById('newPassword'),
    list:  document.getElementById('pwRequirements'),
    wrap:  document.getElementById('strengthWrap'),
    fill:  document.getElementById('strengthFill'),
    label: document.getElementById('strengthLabel'),
  }, passwordContext);

  // Validate on blur; once a field shows an error, re-check it while typing.
  document.getElementById('sameAsPhone').addEventListener('click', () => {
    document.getElementById('whatsapp').value = getValue('phone');
    validateField('whatsapp');
  });

  ['fullName', 'email', 'phone', 'whatsapp', 'campusId', 'newPassword', 'confirmPassword'].forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('blur', () => { if (input.value) validateField(id); });
    input.addEventListener('input', () => { if (input.classList.contains('invalid')) validateField(id); });
  });

  // Name/email feed the "doesn't contain personal info" password rule.
  ['fullName', 'email'].forEach(id => document.getElementById(id).addEventListener('input', refreshPassword));

  document.getElementById('newPassword').addEventListener('input', () => {
    if (getValue('confirmPassword')) validateField('confirmPassword');
  });
  document.getElementById('department').addEventListener('change', () => validateField('department'));
  document.getElementById('agreeTerms').addEventListener('change', () => validateField('agreeTerms'));
  document.getElementById('fullName').focus();
});
