/* ============================================================
   Auth routes: register, login (with lockout), logout,
   current user, forgot / reset password.
   ============================================================ */

const crypto  = require('node:crypto');
const express = require('express');
const bcrypt  = require('bcryptjs');
const { db, BCRYPT_ROUNDS, DEMO_USERS } = require('../db');
const mailer  = require('../mailer');
const PasswordRules = require('../../js/password-rules.js');
const {
  config, IS_PROD, SESSION_COOKIE, sha256, now, normalizeEmail, handle, publicUser,
  createSession, getSessionUser, notifyAdmins,
} = require('../helpers');

const router = express.Router();

const MAX_FAILED_LOGINS    = 5;
const LOCKOUT_MINUTES      = 15;
const RESET_CODE_MINUTES   = 15;
const MAX_RESET_ATTEMPTS   = 5;
const RESET_RESEND_SECONDS = 60;

const STUDENT_DOMAIN = config.STUDENT_DOMAIN;
const DEPARTMENTS = ['civil', 'electrical', 'mechanical', 'computer', 'electronic', 'cs', 'it', 'se', 'ds', 'cyber', 'id', 'arch'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_REGEX  = /^[\p{L}][\p{L} .'@/-]*$/u;

// Used when the email doesn't exist so failed logins take the same time.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_ROUNDS);

function isValidMalaysianPhone(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return false;
  let national = compact;
  if (compact.startsWith('+60')) national = '0' + compact.slice(3);
  else if (compact.startsWith('60')) national = '0' + compact.slice(2);
  return /^01(?:[15]\d{8}|[02-46-9]\d{7})$/.test(national) || /^0[3-9]\d{7,8}$/.test(national);
}

function getAttempts(email) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE email = ?').get(email);
  if (!row) return { failed_count: 0, locked_until: 0 };
  // Forget old failures once the lockout window has passed.
  if (row.locked_until <= now() && now() - row.last_failed_at > LOCKOUT_MINUTES * 60 * 1000) {
    return { failed_count: 0, locked_until: 0 };
  }
  return row;
}

function recordFailedLogin(email) {
  const current = getAttempts(email);
  let failed = current.failed_count + 1;
  let lockedUntil = 0;
  if (failed >= MAX_FAILED_LOGINS) {
    lockedUntil = now() + LOCKOUT_MINUTES * 60 * 1000;
    failed = 0;
  }
  db.prepare(`
    INSERT INTO login_attempts (email, failed_count, locked_until, last_failed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET failed_count = excluded.failed_count,
      locked_until = excluded.locked_until, last_failed_at = excluded.last_failed_at`)
    .run(email, failed, lockedUntil, now());
  return { lockedUntil, remaining: lockedUntil ? 0 : MAX_FAILED_LOGINS - failed };
}

function lockoutMessage(lockedUntil) {
  const minutes = Math.max(1, Math.ceil((lockedUntil - now()) / 60000));
  return `Too many failed attempts. This account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`;
}

/* ── Admin secret-code attempts (rate limited per IP) ── */
function adminCodeLocked(key) {
  const row = db.prepare('SELECT * FROM admin_code_attempts WHERE key = ?').get(key);
  return row && row.locked_until > now() ? row.locked_until : 0;
}
function recordAdminCodeFailure(key) {
  const row = db.prepare('SELECT * FROM admin_code_attempts WHERE key = ?').get(key);
  const stale = !row || now() - row.last_failed_at > config.ADMIN_CODE_LOCK_MINUTES * 60000;
  let failed = (stale ? 0 : row.failed_count) + 1;
  let lockedUntil = 0;
  if (failed >= config.ADMIN_CODE_MAX_ATTEMPTS) { lockedUntil = now() + config.ADMIN_CODE_LOCK_MINUTES * 60000; failed = 0; }
  db.prepare(`INSERT INTO admin_code_attempts (key, failed_count, locked_until, last_failed_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET failed_count = excluded.failed_count, locked_until = excluded.locked_until, last_failed_at = excluded.last_failed_at`)
    .run(key, failed, lockedUntil, now());
  return { lockedUntil, remaining: lockedUntil ? 0 : config.ADMIN_CODE_MAX_ATTEMPTS - failed };
}
function secretCodeMatches(code) {
  const a = Buffer.from(sha256(String(code || '')), 'hex');
  const b = Buffer.from(sha256(config.ADMIN_SECRET_CODE), 'hex');
  return crypto.timingSafeEqual(a, b);
}

/* ── Register (student, or admin with the secret code) ── */
router.post('/register', handle(async (req, res) => {
  const body = req.body || {};
  const role       = body.role === 'admin' ? 'admin' : 'student';
  const fullName   = String(body.fullName || '').trim().replace(/\s+/g, ' ');
  const email      = normalizeEmail(body.email);
  const phone      = String(body.phone || '').trim();
  const whatsapp   = String(body.whatsapp || '').trim() || phone;
  const campusId   = String(body.campusId || '').trim().toUpperCase();
  const department = role === 'admin' ? 'admin' : String(body.department || '');
  const password   = String(body.password || '');

  // The secret code is checked first so a locked-out client learns nothing else.
  if (role === 'admin') {
    const key = 'ip:' + (req.ip || 'unknown');
    const lockedUntil = adminCodeLocked(key);
    if (lockedUntil) {
      const minutes = Math.ceil((lockedUntil - now()) / 60000);
      return res.status(429).json({ error: `Too many wrong secret codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, fields: { secretCode: 'Temporarily locked.' } });
    }
    if (!secretCodeMatches(body.secretCode)) {
      const result = recordAdminCodeFailure(key);
      if (result.lockedUntil) notifyAdmins('Admin sign-up blocked', `Repeated wrong admin secret codes from ${req.ip}. Registration locked for ${config.ADMIN_CODE_LOCK_MINUTES} minutes.`, 'fa-shield-halved');
      const msg = result.lockedUntil
        ? `Too many wrong secret codes. Admin registration is locked for ${config.ADMIN_CODE_LOCK_MINUTES} minutes.`
        : `Invalid admin secret code. ${result.remaining} attempt${result.remaining === 1 ? '' : 's'} left.`;
      return res.status(result.lockedUntil ? 429 : 403).json({ error: msg, fields: { secretCode: msg } });
    }
  }

  const errors = {};
  if (fullName.length < 3 || fullName.length > 80 || !NAME_REGEX.test(fullName)) errors.fullName = 'Enter your full name (3–80 letters).';
  if (!EMAIL_REGEX.test(email) || email.length > 120) errors.email = 'Enter a valid email address.';
  else if (role === 'student' && !email.endsWith(STUDENT_DOMAIN)) errors.email = `Students must use their university email (${STUDENT_DOMAIN}).`;
  if (!isValidMalaysianPhone(phone)) errors.phone = 'Enter a valid Malaysian phone number.';
  if (!isValidMalaysianPhone(whatsapp)) errors.whatsapp = 'Enter a valid WhatsApp number.';
  if (!/^[A-Z0-9]{4,15}$/.test(campusId)) errors.campusId = 'ID must be 4–15 letters or numbers.';
  if (role === 'student' && !DEPARTMENTS.includes(department)) errors.department = 'Select a valid programme.';

  const pwResult = PasswordRules.validate(password, { email, fullName });
  if (!pwResult.valid) errors.password = pwResult.errors[0];
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.', fields: { email: 'This email is already registered. Sign in instead.' } });
  }
  if (db.prepare('SELECT 1 FROM users WHERE campus_id = ?').get(campusId)) {
    return res.status(409).json({ error: 'This ID is already registered.', fields: { campusId: 'This ID is already linked to another account.' } });
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare(`INSERT INTO users (role, full_name, email, phone, whatsapp, campus_id, department, password_hash, trust_points)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(role, fullName, email, phone, whatsapp, campusId, department, hash, config.TRUST_START);
  if (role === 'admin') notifyAdmins('New admin registered', `${fullName} (${email}) registered as an admin using the secret code.`, 'fa-user-shield', 'manage-users.html');

  res.status(201).json({ message: 'Account created. You can now sign in.' });
}));

/* ── Login / logout / me ──────────────────────────── */
router.post('/login', handle(async (req, res) => {
  const email    = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const remember = req.body?.remember === true;

  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

  const attempts = getAttempts(email);
  if (attempts.locked_until > now()) {
    return res.status(423).json({ error: lockoutMessage(attempts.locked_until), locked: true });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok   = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !ok) {
    // Same response whether the email exists or not (no account enumeration).
    const result = recordFailedLogin(email);
    if (result.lockedUntil) {
      return res.status(423).json({ error: lockoutMessage(result.lockedUntil), locked: true });
    }
    return res.status(401).json({
      error: `Incorrect email or password. ${result.remaining} attempt${result.remaining === 1 ? '' : 's'} left before the account is locked.`,
      remaining: result.remaining,
    });
  }

  db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
  if (user.status === 'deactivated') {
    return res.status(403).json({ error: 'This account was deactivated by its owner. Contact the system admin to restore it.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This account has been suspended. Please contact the system admin.' });
  }
  createSession(res, user.id, remember);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ message: 'Signed out.' });
});

// Codes can only reach users by email; outside production they are shown on screen.
const resetAvailable = () => mailer.enabled || !IS_PROD;

/* ── Public settings for the sign-in page ─────────── */
router.get('/config', (req, res) => {
  res.json({
    demo: config.DEMO_MODE,
    passwordReset: resetAvailable(),
    demoAccounts: config.DEMO_MODE
      ? DEMO_USERS.map(u => ({ label: u.key === 'admin' ? 'Admin' : u.fullName.split(' ')[0], role: u.role, email: u.email, password: u.password }))
      : [],
  });
});

router.get('/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: publicUser(user) });
});

/* ── Forgot / reset password ──────────────────────── */
router.post('/forgot', handle(async (req, res) => {
  if (!resetAvailable()) {
    return res.status(503).json({ error: 'Password reset by email is not available. Please contact the system admin.' });
  }
  const email = normalizeEmail(req.body?.email);
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

  const generic = { message: 'If an account exists for this email, a 6-digit reset code has been sent.' };
  const user = db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").get(email);
  if (!user) return res.json(generic);

  const existing = db.prepare('SELECT created_at FROM password_resets WHERE email = ?').get(email);
  if (existing && now() - existing.created_at < RESET_RESEND_SECONDS * 1000) {
    return res.status(429).json({ error: `Please wait ${RESET_RESEND_SECONDS} seconds before requesting another code.` });
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(`
    INSERT INTO password_resets (email, code_hash, expires_at, created_at, attempts) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
      created_at = excluded.created_at, attempts = 0`)
    .run(email, sha256(email + ':' + code), now() + RESET_CODE_MINUTES * 60 * 1000, now());

  if (mailer.enabled) {
    try {
      await mailer.sendMail({
        to: email,
        subject: 'Your password reset code',
        text: `Your Campus Hardware Lending System reset code is ${code}.\n\n`
            + `It expires in ${RESET_CODE_MINUTES} minutes. If you did not ask to reset your password, ignore this email.`,
      });
    } catch (err) {
      console.error('[password reset] email failed:', err.message);
      db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);
      return res.status(502).json({ error: 'The reset email could not be sent. Please try again later.' });
    }
    return res.json(generic);
  }

  // No email service (local development only): show the code on screen.
  console.log(`[password reset] code for ${email}: ${code} (valid ${RESET_CODE_MINUTES} min)`);
  res.json({ ...generic, devCode: code });
}));

router.post('/reset', handle(async (req, res) => {
  const email    = normalizeEmail(req.body?.email);
  const code     = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');
  const invalid  = { error: 'The reset code is invalid or has expired.', fields: { code: 'Invalid or expired code.' } };

  const reset = db.prepare('SELECT * FROM password_resets WHERE email = ?').get(email);
  if (!reset || reset.expires_at <= now()) return res.status(400).json(invalid);
  if (reset.attempts >= MAX_RESET_ATTEMPTS) {
    db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);
    return res.status(400).json({ error: 'Too many incorrect codes. Request a new one.', fields: { code: 'Request a new code.' } });
  }

  const expected = Buffer.from(reset.code_hash, 'hex');
  const given    = Buffer.from(sha256(email + ':' + code), 'hex');
  if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(expected, given)) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?').run(email);
    return res.status(400).json(invalid);
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json(invalid);

  const pwResult = PasswordRules.validate(password, { email, fullName: user.full_name });
  if (!pwResult.valid) return res.status(400).json({ error: pwResult.errors[0], fields: { password: pwResult.errors[0] } });
  if (await bcrypt.compare(password, user.password_hash)) {
    const msg = 'Your new password must be different from the current one.';
    return res.status(400).json({ error: msg, fields: { password: msg } });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, BCRYPT_ROUNDS), user.id);
  db.prepare('DELETE FROM password_resets WHERE email = ?').run(email);
  db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);   // sign out everywhere

  res.json({ message: 'Password updated. Sign in with your new password.' });
}));

module.exports = { router, isValidMalaysianPhone, NAME_REGEX, DEPARTMENTS };
