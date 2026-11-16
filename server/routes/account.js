/* ============================================================
   Module 1 – User Authentication & Profile (UAP): profile side
   Also: notifications, badge counts, dashboard, public profiles.
   ============================================================ */

const express = require('express');
const bcrypt  = require('bcryptjs');
const { db, BCRYPT_ROUNDS } = require('../db');
const PasswordRules = require('../../js/password-rules.js');
const {
  config, SESSION_COOKIE, COMMITTED, OPEN, sqlList, sha256, cleanText, today, addDays, fail, handle, publicUser, ratingSummary, imageUrl,
  requireAuth, saveImage, deleteImage,
} = require('../helpers');
const { isValidMalaysianPhone, NAME_REGEX, DEPARTMENTS } = require('./auth');
const { serializeTool, TOOL_SELECT } = require('./tools');
const { serializeLoan, LOAN_SELECT, borrowerBlockReason } = require('./loans');
const reviews = require('./reviews');

const router = express.Router();
const usersRouter = express.Router();

const freshUser = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const count = (sql, ...params) => db.prepare(sql).get(...params).n;
const trustHistory = (userId, limit = 50) => db.prepare(`SELECT delta, balance, reason, created_at AS createdAt FROM trust_events
                                                         WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, limit);

/* ── Read: own profile ────────────────────────────── */
router.get('/profile', requireAuth, (req, res) => {
  const id = req.user.id;
  res.json({
    user: publicUser(req.user),
    stats: {
      activeBookings: count(`SELECT COUNT(*) AS n FROM loans WHERE (borrower_id = ? OR owner_id = ?) AND status IN (${sqlList(OPEN)})`, id, id),
      listings:      count("SELECT COUNT(*) AS n FROM tools WHERE owner_id = ? AND status != 'removed'", id),
      timesLent:     count("SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND status = 'completed'", id),
      timesBorrowed: count("SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status = 'completed'", id),
      earnings:      count("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE user_id = ? AND type IN ('release_fee', 'deposit_deduction')", id),
    },
    rating: ratingSummary("target_type = 'user' AND target_user_id = ?", id),
    trustHistory: trustHistory(id),
    trustRules: { start: config.TRUST_START, flagBelow: config.TRUST_FLAG_BELOW, penalty: config.TRUST_PENALTY, onTime: config.TRUST_BONUS_ON_TIME, ratingBonus: config.TRUST_RATING_BONUS },
  });
});

/* ── Update ───────────────────────────────────────── */
router.put('/profile', requireAuth, (req, res) => {
  const fullName   = cleanText(req.body?.fullName, 80);
  const phone      = cleanText(req.body?.phone, 20);
  const whatsapp   = cleanText(req.body?.whatsapp, 20);
  const department = String(req.body?.department || '');
  const errors = {};
  if (fullName.length < 3 || !NAME_REGEX.test(fullName)) errors.fullName = 'Enter your full name (3–80 letters).';
  if (!isValidMalaysianPhone(phone)) errors.phone = 'Enter a valid Malaysian phone number.';
  if (!isValidMalaysianPhone(whatsapp)) errors.whatsapp = 'Enter a valid WhatsApp number.';
  if (req.user.role === 'student' && !DEPARTMENTS.includes(department)) errors.department = 'Select a valid programme.';
  if (Object.keys(errors).length) fail(400, 'Please fix the highlighted fields.', errors);

  db.prepare('UPDATE users SET full_name = ?, phone = ?, whatsapp = ?, department = ? WHERE id = ?')
    .run(fullName, phone, whatsapp, req.user.role === 'student' ? department : req.user.department, req.user.id);
  res.json({ message: 'Profile updated.', user: publicUser(freshUser(req.user.id)) });
});

router.post('/avatar', requireAuth, handle(async (req, res) => {
  const path = saveImage(req.body?.image, 'avatars');
  deleteImage(req.user.avatar_path);
  db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(path, req.user.id);
  res.json({ message: 'Profile picture updated.', user: publicUser(freshUser(req.user.id)) });
}));

router.delete('/avatar', requireAuth, (req, res) => {
  deleteImage(req.user.avatar_path);
  db.prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(req.user.id);
  res.json({ message: 'Profile picture removed.', user: publicUser(freshUser(req.user.id)) });
});

router.post('/password', requireAuth, handle(async (req, res) => {
  const current  = String(req.body?.currentPassword || '');
  const password = String(req.body?.newPassword || '');
  if (!(await bcrypt.compare(current, req.user.password_hash))) fail(400, 'Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
  const result = PasswordRules.validate(password, { email: req.user.email, fullName: req.user.full_name });
  if (!result.valid) fail(400, result.errors[0], { newPassword: result.errors[0] });
  if (current === password) fail(400, 'Choose a password different from the current one.', { newPassword: 'Must differ from the current password.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, BCRYPT_ROUNDS), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, sha256(req.cookies[SESSION_COOKIE]));
  res.json({ message: 'Password changed. Other devices have been signed out.' });
}));

/* ── Delete: deactivate own account ───────────────── */
function deactivationBlockers(userId) {
  const reasons = [];
  const open = count(`SELECT COUNT(*) AS n FROM loans WHERE (borrower_id = ? OR owner_id = ?) AND status IN (${sqlList(OPEN)})`, userId, userId);
  if (open) reasons.push(`${open} booking${open === 1 ? ' is' : 's are'} still in progress`);
  const disputes = count(`SELECT COUNT(*) AS n FROM disputes d JOIN loans l ON l.id = d.loan_id
                          WHERE d.status = 'open' AND (l.borrower_id = ? OR l.owner_id = ?)`, userId, userId);
  if (disputes) reasons.push(`${disputes} dispute${disputes === 1 ? ' is' : 's are'} unresolved`);
  return reasons;
}

router.get('/deactivation-check', requireAuth, (req, res) => res.json({ blockers: deactivationBlockers(req.user.id) }));

router.post('/deactivate', requireAuth, handle(async (req, res) => {
  if (!(await bcrypt.compare(String(req.body?.password || ''), req.user.password_hash))) fail(400, 'Password is incorrect.', { deactivatePassword: 'Password is incorrect.' });
  const blockers = deactivationBlockers(req.user.id);
  if (blockers.length) fail(409, `You cannot deactivate yet: ${blockers.join(' and ')}.`);
  if (req.user.role === 'admin' && count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'") <= 1) {
    fail(409, 'You are the only active admin. Promote another admin first.');
  }
  db.prepare("UPDATE users SET status = 'deactivated' WHERE id = ?").run(req.user.id);
  db.prepare("UPDATE tools SET status = 'removed', removed_reason = 'Owner deactivated their account' WHERE owner_id = ? AND status != 'removed'").run(req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ message: 'Your account has been deactivated.' });
}));

/* ── Notifications ────────────────────────────────── */
const notifRow = n => ({ id: n.id, title: n.title, body: n.body, icon: n.icon, link: n.link, read: !!n.is_read, createdAt: n.created_at });

router.get('/notifications', requireAuth, (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 50);
  res.json({
    notifications: db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(req.user.id, limit).map(notifRow),
    unread: count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id),
  });
});
router.post('/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All notifications marked as read.' });
});
router.post('/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

/* ── Sidebar badge counts ─────────────────────────── */
router.get('/counts', requireAuth, (req, res) => {
  const id = req.user.id;
  const isAdmin = req.user.role === 'admin';
  res.json({
    unread:   count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', id),
    incoming: count("SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND ((status = 'pending' AND awaiting = 'lender') OR status IN ('confirmed', 'return_pending'))", id),
    myLoans:  count("SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND (status IN ('awaiting_payment', 'confirmed', 'active') OR (status = 'pending' AND awaiting = 'borrower'))", id),
    messages: isAdmin ? 0 : count('SELECT COUNT(*) AS n FROM messages m JOIN loans l ON l.id = m.loan_id WHERE (l.borrower_id = ? OR l.owner_id = ?) AND m.sender_id != ? AND m.read_at IS NULL', id, id, id),
    disputes: isAdmin
      ? count("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'")
      : count("SELECT COUNT(*) AS n FROM disputes d JOIN loans l ON l.id = d.loan_id WHERE d.status = 'open' AND (l.borrower_id = ? OR l.owner_id = ?)", id, id),
    flagged:  isAdmin ? count("SELECT COUNT(*) AS n FROM users WHERE flagged = 1 AND status = 'active'") : 0,
  });
});

/* ── Dashboard summary ────────────────────────────── */
const ACTIVITY_SELECT = `
  SELECT e.action, e.note, e.created_at AS createdAt, e.loan_id AS loanId, a.full_name AS actor, t.name AS tool
  FROM loan_events e JOIN loans l ON l.id = e.loan_id JOIN tools t ON t.id = l.tool_id LEFT JOIN users a ON a.id = e.actor_id`;

router.get('/dashboard', requireAuth, (req, res) => {
  const user = req.user;
  const loans = (sql, ...params) => db.prepare(`${LOAN_SELECT} ${sql}`).all(...params).map(row => serializeLoan(row, user));
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(user.id).map(notifRow);
  const tools = (sql, ...params) => db.prepare(`${TOOL_SELECT} ${sql}`).all(...params).map(r => serializeTool(r, user));

  if (user.role === 'admin') {
    return res.json({
      role: 'admin',
      stats: {
        students:  count("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND status = 'active'"),
        flagged:   count("SELECT COUNT(*) AS n FROM users WHERE flagged = 1 AND status = 'active'"),
        active:    count(`SELECT COUNT(*) AS n FROM loans WHERE status IN (${sqlList(COMMITTED)})`),
        disputes:  count("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'"),
        escrow:    count("SELECT COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE -amount END), 0) AS n FROM transactions"),
        overdue:   count("SELECT COUNT(*) AS n FROM loans WHERE status = 'active' AND end_date < ?", today()),
      },
      recentLoans: loans('ORDER BY l.updated_at DESC, l.id DESC LIMIT 6'),
      flaggedUsers: db.prepare("SELECT id, full_name AS name, avatar_path, trust_points AS trustPoints FROM users WHERE flagged = 1 AND status = 'active' ORDER BY trust_points LIMIT 5").all()
        .map(u => ({ ...u, avatar: imageUrl(u.avatar_path), avatar_path: undefined })),
      latestTools: tools("WHERE t.status != 'removed' ORDER BY t.id DESC LIMIT 6"),
      notifications,
      activity: db.prepare(`${ACTIVITY_SELECT} WHERE e.action NOT LIKE 'reminder_%' ORDER BY e.id DESC LIMIT 8`).all(),
    });
  }

  res.json({
    role: 'student',
    stats: {
      trustPoints: user.trust_points,
      borrowing: count(`SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status IN (${sqlList(COMMITTED)})`, user.id),
      overdue:   count("SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status = 'active' AND end_date < ?", user.id, today()),
      listings:  count("SELECT COUNT(*) AS n FROM tools WHERE owner_id = ? AND status != 'removed'", user.id),
      incoming:  count("SELECT COUNT(*) AS n FROM loans WHERE owner_id = ? AND ((status = 'pending' AND awaiting = 'lender') OR status IN ('confirmed', 'return_pending'))", user.id),
      earnings:  count("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE user_id = ? AND type IN ('release_fee', 'deposit_deduction')", user.id),
    },
    flagged: !!user.flagged,
    blocked: borrowerBlockReason(user.id),
    myLoans:  loans(`WHERE l.borrower_id = ? AND l.status IN (${sqlList(OPEN)}) ORDER BY l.start_date LIMIT 5`, user.id),
    incoming: loans(`WHERE l.owner_id = ? AND l.status IN ('pending', 'confirmed', 'return_pending', 'disputed') ORDER BY l.updated_at DESC LIMIT 5`, user.id),
    dueSoon:  loans("WHERE l.borrower_id = ? AND l.status = 'active' AND l.end_date <= ? ORDER BY l.end_date LIMIT 4", user.id, addDays(today(), 3)),
    latestTools: tools("WHERE t.status = 'available' AND u.status = 'active' AND t.owner_id != ? ORDER BY t.id DESC LIMIT 6", user.id),
    notifications,
    activity: db.prepare(`${ACTIVITY_SELECT} WHERE (l.borrower_id = ? OR l.owner_id = ?) AND e.action NOT LIKE 'reminder_%' ORDER BY e.id DESC LIMIT 8`).all(user.id, user.id),
  });
});

/* ── Public profiles (/api/users/:id) ─────────────── */
usersRouter.get('/:id', requireAuth, (req, res) => {
  const row = freshUser(Number(req.params.id));
  if (!row) fail(404, 'User not found.');
  const isAdmin = req.user.role === 'admin';
  const base = publicUser(row);
  const profile = {
    id: base.id, fullName: base.fullName, avatar: base.avatar, role: base.role, departmentName: base.departmentName,
    trustPoints: base.trustPoints, createdAt: base.createdAt, status: base.status,
    rating: ratingSummary("target_type = 'user' AND target_user_id = ?", row.id),
    listings: count("SELECT COUNT(*) AS n FROM tools WHERE owner_id = ? AND status != 'removed'", row.id),
    completed: count("SELECT COUNT(*) AS n FROM loans WHERE (borrower_id = ? OR owner_id = ?) AND status = 'completed'", row.id, row.id),
    reviews: db.prepare(`${reviews.REVIEW_SELECT} WHERE r.target_type = 'user' AND r.target_user_id = ? AND r.removed = 0 ORDER BY r.id DESC LIMIT 30`).all(row.id)
      .map(r => reviews.serialize(r, req.user)),
  };
  if (isAdmin) Object.assign(profile, { email: base.email, phone: base.phone, whatsapp: base.whatsapp, campusId: base.campusId, flagged: base.flagged, trustHistory: trustHistory(row.id) });
  res.json({ profile });
});

module.exports = { router, usersRouter };
