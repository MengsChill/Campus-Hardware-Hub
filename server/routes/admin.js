/* ============================================================
   Admin routes: users (flag review, suspend, roles) and reports.
   Listing moderation: /api/tools?scope=all + DELETE /api/tools/:id
   Bookings oversight: /api/loans?as=all + POST /api/loans/:id/void
   Disputes: /api/disputes
   ============================================================ */

const express = require('express');
const { db } = require('../db');
const { config, CATEGORIES, COMMITTED, OPEN, sqlList, today, cleanText, fail, publicUser, requireAdmin, notify } = require('../helpers');
const { serializeLoan, LOAN_SELECT } = require('./loans');

const router = express.Router();
router.use(requireAdmin);

/* ── Users ────────────────────────────────────────── */
router.get('/users', (req, res) => {
  const where = [];
  const params = [];
  const q = cleanText(req.query.q, 60);
  if (q) { where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.campus_id LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (['student', 'admin'].includes(req.query.role)) { where.push('u.role = ?'); params.push(req.query.role); }
  if (['active', 'suspended', 'deactivated'].includes(req.query.status)) { where.push('u.status = ?'); params.push(req.query.status); }
  if (req.query.filter === 'flagged') where.push("u.flagged = 1 AND u.status = 'active'");

  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM tools t WHERE t.owner_id = u.id AND t.status != 'removed') AS tool_count,
      (SELECT COUNT(*) FROM loans l WHERE l.borrower_id = u.id AND l.status IN (${sqlList(COMMITTED)})) AS active_loans,
      (SELECT COUNT(*) FROM loans l WHERE l.borrower_id = u.id AND l.status = 'active' AND l.end_date < ?) AS overdue,
      (SELECT COUNT(*) FROM disputes d WHERE d.against_id = u.id AND d.violation = 1) AS violations,
      (SELECT ROUND(AVG(rating), 1) FROM reviews r WHERE r.target_user_id = u.id AND r.target_type = 'user' AND r.removed = 0) AS rating
    FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.flagged DESC, u.role = 'admin' DESC, u.created_at DESC`).all(today(), ...params);

  res.json({
    users: rows.map(row => ({
      ...publicUser(row),
      toolCount: row.tool_count, activeLoans: row.active_loans, overdue: row.overdue, violations: row.violations, rating: row.rating,
      isSelf: row.id === req.user.id,
    })),
    flagBelow: config.TRUST_FLAG_BELOW,
  });
});

function getTarget(req) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) fail(404, 'User not found.');
  if (user.id === req.user.id) fail(400, 'You cannot change your own account here.');
  return user;
}

const suspend = user => {
  db.prepare("UPDATE users SET status = 'suspended', flagged = 0 WHERE id = ?").run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);   // force sign-out
};

// Flagged account review: suspend, or clear the flag and keep the account active.
router.post('/users/:id/flag-review', (req, res) => {
  const user = getTarget(req);
  if (!user.flagged) fail(409, 'This account is not flagged.');
  const note = cleanText(req.body?.note, 300);
  if (note.length < 5) fail(400, 'Write a short note about your decision.', { note: 'Explain your decision.' });
  if (req.body?.action === 'suspend') {
    suspend(user);
    return res.json({ message: `${user.full_name} has been suspended and signed out.` });
  }
  db.prepare('UPDATE users SET flagged = 0 WHERE id = ?').run(user.id);
  notify(user.id, 'Account reviewed', `An admin reviewed your account after your Trust Points fell below ${config.TRUST_FLAG_BELOW}. No action was taken: ${note}. Please keep returning items on time.`, 'fa-user-check', 'profile.html');
  res.json({ message: `Flag cleared. ${user.full_name} stays active and will be flagged again if their points drop further.` });
});

router.post('/users/:id/status', (req, res) => {
  const user = getTarget(req);
  const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
  if (status === 'suspended') suspend(user);
  else {
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(user.id);
    notify(user.id, 'Account reactivated', 'Your account has been reactivated by the admin.', 'fa-user-check');
  }
  res.json({ message: status === 'suspended' ? `${user.full_name} has been suspended and signed out.` : `${user.full_name} has been reactivated.` });
});

router.post('/users/:id/role', (req, res) => {
  const user = getTarget(req);
  const role = req.body?.role === 'admin' ? 'admin' : 'student';
  if (role === 'admin') {
    const open = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE (borrower_id = ? OR owner_id = ?) AND status IN (${sqlList(OPEN)})`).get(user.id, user.id).n;
    if (open) fail(409, `${user.full_name} still has bookings in progress. They must be finished before promotion.`);
  }
  db.prepare('UPDATE users SET role = ?, flagged = 0 WHERE id = ?').run(role, user.id);
  notify(user.id, 'Account role changed', role === 'admin' ? 'You have been given admin access.' : 'Your admin access has been removed.', 'fa-user-shield');
  res.json({ message: role === 'admin' ? `${user.full_name} is now an admin.` : `${user.full_name} is now a student.` });
});

/* ── Reports ──────────────────────────────────────── */
router.get('/reports', (req, res) => {
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  const sum = type => count('SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type = ?', type);

  const months = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthly = Object.fromEntries(months.map(m => [m, 0]));
  all(`SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS n FROM loans
       WHERE paid_at IS NOT NULL AND status NOT IN ('declined', 'cancelled', 'voided') GROUP BY month`).forEach(r => { if (r.month in monthly) monthly[r.month] = r.n; });

  const byCategory = Object.fromEntries(Object.keys(CATEGORIES).map(key => [key, 0]));
  all(`SELECT t.category, COUNT(*) AS n FROM loans l JOIN tools t ON t.id = l.tool_id
       WHERE l.paid_at IS NOT NULL AND l.status NOT IN ('declined', 'cancelled', 'voided') GROUP BY t.category`).forEach(r => { byCategory[r.category] = r.n; });

  const payments = sum('payment');
  const paidOut = sum('release_fee') + sum('refund') + sum('deposit_deduction');
  res.json({
    totals: {
      students:   count("SELECT COUNT(*) AS n FROM users WHERE role = 'student'"),
      flagged:    count("SELECT COUNT(*) AS n FROM users WHERE flagged = 1 AND status = 'active'"),
      suspended:  count("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'"),
      listings:   count("SELECT COUNT(*) AS n FROM tools WHERE status != 'removed'"),
      bookings:   count('SELECT COUNT(*) AS n FROM loans WHERE paid_at IS NOT NULL'),
      completed:  count("SELECT COUNT(*) AS n FROM loans WHERE status = 'completed'"),
      active:     count(`SELECT COUNT(*) AS n FROM loans WHERE status IN (${sqlList(COMMITTED)})`),
      overdue:    count("SELECT COUNT(*) AS n FROM loans WHERE status = 'active' AND end_date < ?", today()),
      openDisputes: count("SELECT COUNT(*) AS n FROM disputes WHERE status = 'open'"),
      avgTrust:   count("SELECT COALESCE(ROUND(AVG(trust_points)), 0) AS n FROM users WHERE role = 'student' AND status = 'active'"),
    },
    finance: {
      collected: payments,
      feesReleased: sum('release_fee'),
      refunded: sum('refund'),
      deductions: sum('deposit_deduction'),
      held: payments - paidOut,
    },
    disputes: all('SELECT status, COUNT(*) AS n FROM disputes GROUP BY status'),
    monthly: months.map(m => ({ month: m, count: monthly[m] })),
    byCategory: Object.entries(byCategory).map(([key, n]) => ({ category: CATEGORIES[key], count: n })),
    topTools: all(`SELECT t.id, t.name, u.full_name AS owner, COUNT(*) AS n FROM loans l JOIN tools t ON t.id = l.tool_id JOIN users u ON u.id = t.owner_id
                   WHERE l.status IN ('completed', ${sqlList(COMMITTED)}) GROUP BY t.id ORDER BY n DESC LIMIT 5`),
    lowestTrust: all(`SELECT id, full_name AS name, trust_points AS n FROM users WHERE role = 'student' AND status = 'active' ORDER BY trust_points LIMIT 5`),
    overdue: db.prepare(`${LOAN_SELECT} WHERE l.status = 'active' AND l.end_date < ? ORDER BY l.end_date`).all(today()).map(row => serializeLoan(row, req.user)),
  });
});

module.exports = { router };
