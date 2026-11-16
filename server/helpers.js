/* ============================================================
   Shared server helpers: sessions, guards, notifications,
   Trust Points, escrow ledger, image uploads, dates.
   ============================================================ */

const path   = require('node:path');
const fs     = require('node:fs');
const crypto = require('node:crypto');
const { db } = require('./db');
const config = require('./config');

const IS_PROD        = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'chh_session';
const SESSION_HOURS  = 12;
const REMEMBER_DAYS  = 30;
const UPLOAD_DIR     = path.join(__dirname, '..', 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const CATEGORIES = {
  electrical: 'Electrical & Electronics',
  mechanical: 'Mechanical & Hand Tools',
  measuring:  'Measuring Instruments',
  computing:  'Computing & Boards',
  others:     'Others',
};
const CONDITIONS = { new: 'Like new', good: 'Good', fair: 'Fair', worn: 'Worn' };
const PROGRAMMES = {
  civil: 'Civil Engineering', electrical: 'Electrical Engineering', mechanical: 'Mechanical Engineering',
  computer: 'Computer Engineering', electronic: 'Electronics Engineering', cs: 'Computer Science',
  it: 'Information Technology', se: 'Software Engineering', ds: 'Data Science', cyber: 'Cybersecurity',
  id: 'Industrial Design', arch: 'Architecture',
};

// Booking status groups
const COMMITTED = ['confirmed', 'active', 'return_pending', 'disputed'];          // dates are blocked for others
const OPEN      = ['awaiting_payment', 'pending', ...COMMITTED];                  // not finished yet
const FINAL     = ['completed', 'cancelled', 'declined', 'voided'];
const sqlList   = list => list.map(s => `'${s}'`).join(',');

/* ── Small utilities ──────────────────────────────── */
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const now    = () => Date.now();
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const cleanText = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanMultiline = (value, max) => String(value ?? '').trim().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, max);
const ref = prefix => `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const rm = sen => `RM ${(sen / 100).toFixed(2)}`;
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const today = () => new Date().toLocaleDateString('en-CA');          // YYYY-MM-DD, server local time
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}
function daysBetween(from, to) {
  return Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000);
}
const isDateStr = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + 'T00:00:00').getTime());
const isDateTimeStr = value => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value) && !Number.isNaN(new Date(value.replace(' ', 'T')).getTime());

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
const fail = (status, message, fields) => { throw new HttpError(status, message, fields); };
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Run several statements atomically. */
function transaction(fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

function ratingSummary(where, param) {
  const row = db.prepare(`SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM reviews WHERE ${where} AND removed = 0`).get(param);
  return { average: row.avg, count: row.n };
}

function publicUser(row) {
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    campusId: row.campus_id,
    department: row.department,
    departmentName: PROGRAMMES[row.department] || (row.role === 'admin' ? 'Administration' : row.department),
    avatar: row.avatar_path ? '/uploads/' + row.avatar_path : null,
    status: row.status,
    trustPoints: row.trust_points,
    flagged: !!row.flagged,
    createdAt: row.created_at,
  };
}

/* ── Sessions ─────────────────────────────────────── */
function createSession(res, userId, remember) {
  const token  = crypto.randomBytes(32).toString('base64url');
  const maxAge = remember ? REMEMBER_DAYS * 24 * 3600 * 1000 : SESSION_HOURS * 3600 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, now() + maxAge);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: '/',
    ...(remember ? { maxAge } : {}),
  });
}

function getSessionUser(req) {
  if (req._user !== undefined) return req._user;
  const token = req.cookies[SESSION_COOKIE];
  req._user = token
    ? db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`).get(sha256(token), now()) || null
    : null;
  return req._user;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access only.' })));
}
function requireStudent(req, res, next) {
  requireAuth(req, res, () => (req.user.role === 'student' ? next() : res.status(403).json({ error: 'Only student accounts can borrow or lend hardware.' })));
}

/* ── Notifications & history ──────────────────────── */
function notify(userId, title, body, icon = 'fa-bell', link = null) {
  db.prepare('INSERT INTO notifications (user_id, title, body, icon, link) VALUES (?, ?, ?, ?, ?)').run(userId, title, body, icon, link);
}
function notifyAdmins(title, body, icon, link) {
  db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()
    .forEach(admin => notify(admin.id, title, body, icon, link));
}
function logEvent(loanId, actorId, action, note = null) {
  db.prepare('INSERT INTO loan_events (loan_id, actor_id, action, note) VALUES (?, ?, ?, ?)').run(loanId, actorId, action, note);
}

/* ── Trust Points ─────────────────────────────────── */
/** Change a user's Trust Points, record why, and flag the account if it drops too low. */
function adjustTrust(userId, delta, reason, refType = null, refId = null) {
  if (!delta) return;
  const user = db.prepare('SELECT trust_points, flagged, full_name, role FROM users WHERE id = ?').get(userId);
  if (!user || user.role !== 'student') return;
  const balance = user.trust_points + delta;
  db.prepare('UPDATE users SET trust_points = ? WHERE id = ?').run(balance, userId);
  db.prepare('INSERT INTO trust_events (user_id, delta, balance, reason, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, delta, balance, reason, refType, refId);
  notify(userId, delta > 0 ? `+${delta} Trust Points` : `${delta} Trust Points`, `${reason}. Your balance is now ${balance}.`,
    delta > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', 'profile.html');

  if (balance < config.TRUST_FLAG_BELOW && !user.flagged) {
    db.prepare("UPDATE users SET flagged = 1, flagged_at = datetime('now') WHERE id = ?").run(userId);
    notifyAdmins('Account flagged', `${user.full_name} dropped to ${balance} Trust Points and needs review.`, 'fa-flag', 'manage-users.html?filter=flagged');
  }
}

/* ── Escrow ledger ────────────────────────────────── */
function addTransaction(loanId, userId, type, amount, prefix, extra = {}) {
  if (amount <= 0) return null;
  const reference = ref(prefix);
  db.prepare(`INSERT INTO transactions (loan_id, user_id, type, amount, method, card_last4, reference, note)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(loanId, userId, type, amount, extra.method || null, extra.last4 || null, reference, extra.note || null);
  return reference;
}

/** Money still held in escrow for a booking (sen). */
function escrowBalance(loanId) {
  const row = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type = 'payment' THEN amount END), 0) AS paid_in,
      COALESCE(SUM(CASE WHEN type != 'payment' THEN amount END), 0) AS paid_out
    FROM transactions WHERE loan_id = ?`).get(loanId);
  return row.paid_in - row.paid_out;
}

/** Refund everything still held for a booking to the borrower. */
function refundAll(loan, note) {
  const amount = escrowBalance(loan.id);
  return amount > 0 ? { amount, reference: addTransaction(loan.id, loan.borrower_id, 'refund', amount, 'RFD', { note }) } : null;
}

/* ── Image uploads ────────────────────────────────── */
const SIGNATURES = {
  jpg:  buf => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  png:  buf => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
  webp: buf => buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP',
};

function saveImage(dataUrl, folder) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) fail(400, 'Please upload a JPG, PNG or WebP image.');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) fail(400, 'Image is too large (max 5 MB).');
  if (!SIGNATURES[ext](buffer)) fail(400, 'The file is not a valid image.');
  const dir = path.join(UPLOAD_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return `${folder}/${name}`;
}

function deleteImage(relPath) {
  if (!relPath) return;
  const full = path.join(UPLOAD_DIR, relPath);
  if (full.startsWith(UPLOAD_DIR + path.sep)) fs.rm(full, { force: true }, () => {});
}

const imageUrl = relPath => (relPath ? '/uploads/' + relPath : null);

module.exports = {
  config, IS_PROD, SESSION_COOKIE, UPLOAD_DIR, CATEGORIES, CONDITIONS, PROGRAMMES,
  COMMITTED, OPEN, FINAL, sqlList,
  sha256, now, normalizeEmail, cleanText, cleanMultiline, ref, rm, sqlNow, today, addDays, daysBetween, isDateStr, isDateTimeStr,
  HttpError, fail, handle, transaction, ratingSummary, publicUser,
  createSession, getSessionUser, requireAuth, requireAdmin, requireStudent,
  notify, notifyAdmins, logEvent, adjustTrust, addTransaction, escrowBalance, refundAll,
  saveImage, deleteImage, imageUrl,
};
