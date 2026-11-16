/* ============================================================
   Campus Hardware Lending System – Shared Password Rules
   Loaded by the browser (window.PasswordRules) and by server.js
   (require) so both sides enforce exactly the same policy.
   ============================================================ */

(function (root) {
  const MIN_LENGTH = 10;
  const MAX_LENGTH = 128;

  // Small list of the most common leaked passwords (lowercase).
  const COMMON_PASSWORDS = [
    'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
    '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwerty123',
    'qwertyuiop', 'abc123', 'abcd1234', '111111', '000000', 'iloveyou',
    'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'admin@123',
    'letmein', 'monkey', 'dragon', 'football', 'baseball', 'sunshine',
    'princess', 'superman', 'trustno1', 'starwars', 'whatever', 'master',
    'changeme', 'student', 'student123', 'student@123', 'campus123',
    'tarc1234', 'tarumt123', 'malaysia123', 'hardware123', 'computer1',
  ];

  function getChecks(password, context) {
    const pw = password || '';
    const lower = pw.toLowerCase();
    const ctx = context || {};

    // Personal info: email username and each name part with 3+ letters.
    const personal = [];
    if (ctx.email) {
      const local = String(ctx.email).split('@')[0].toLowerCase();
      if (local.length >= 3) personal.push(local);
    }
    if (ctx.fullName) {
      String(ctx.fullName).toLowerCase().split(/\s+/)
        .filter(part => part.length >= 3)
        .forEach(part => personal.push(part));
    }

    // Strip trailing digits/symbols so "Password123!" is still caught.
    const core = lower.replace(/[^a-z]+$/, '');

    return {
      length:   pw.length >= MIN_LENGTH && pw.length <= MAX_LENGTH,
      upper:    /[A-Z]/.test(pw),
      lower:    /[a-z]/.test(pw),
      number:   /[0-9]/.test(pw),
      special:  /[^A-Za-z0-9\s]/.test(pw),
      personal: pw.length > 0 && !personal.some(part => lower.includes(part)),
      common:   pw.length > 0 && !COMMON_PASSWORDS.includes(lower) && !COMMON_PASSWORDS.includes(core),
    };
  }

  function validate(password, context) {
    const checks = getChecks(password, context);
    const messages = {
      length:   `Password must be ${MIN_LENGTH}–${MAX_LENGTH} characters long.`,
      upper:    'Password needs at least one uppercase letter.',
      lower:    'Password needs at least one lowercase letter.',
      number:   'Password needs at least one number.',
      special:  'Password needs at least one special character.',
      personal: 'Password must not contain your name or email username.',
      common:   'This password is too common. Choose something less predictable.',
    };
    const failed = Object.keys(checks).filter(key => !checks[key]);
    return { valid: failed.length === 0, checks, errors: failed.map(key => messages[key]) };
  }

  const api = { MIN_LENGTH, MAX_LENGTH, getChecks, validate };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PasswordRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
