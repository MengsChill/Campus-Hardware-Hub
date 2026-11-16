/* ============================================================
   Module 2 – Hardware Inventory & Listing (HIL)
   ============================================================ */

const express = require('express');
const { db } = require('../db');
const {
  config, CATEGORIES, CONDITIONS, COMMITTED, sqlList, rm, today,
  cleanText, cleanMultiline, fail, handle, transaction, imageUrl, ratingSummary,
  requireAuth, requireStudent, notify, logEvent, saveImage, deleteImage, refundAll,
} = require('../helpers');

const router = express.Router();

const TOOL_SELECT = `
  SELECT t.*, u.full_name AS owner_name, u.avatar_path AS owner_avatar, u.department AS owner_department,
         u.trust_points AS owner_trust,
    (SELECT path FROM tool_photos p WHERE p.tool_id = t.id ORDER BY position, id LIMIT 1) AS cover,
    (SELECT l.end_date FROM loans l WHERE l.tool_id = t.id AND l.status = 'active' LIMIT 1) AS on_loan_until,
    (SELECT COUNT(*) FROM loans l WHERE l.tool_id = t.id AND l.status = 'pending') AS pending_count,
    (SELECT COUNT(*) FROM loans l WHERE l.tool_id = t.id AND l.status = 'completed') AS times_borrowed,
    (SELECT ROUND(AVG(rating), 1) FROM reviews r WHERE r.tool_id = t.id AND r.target_type = 'tool' AND r.removed = 0) AS rating_avg,
    (SELECT COUNT(*) FROM reviews r WHERE r.tool_id = t.id AND r.target_type = 'tool' AND r.removed = 0) AS rating_count
  FROM tools t JOIN users u ON u.id = t.owner_id`;

function availability(row) {
  if (row.status === 'removed')     return 'removed';
  if (row.status === 'maintenance') return 'maintenance';
  if (row.on_loan_until)            return 'on_loan';
  return 'available';
}

function serializeTool(row, viewer) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    categoryName: CATEGORIES[row.category] || 'Others',
    description: row.description,
    specs: row.specs,
    condition: row.condition,
    conditionName: CONDITIONS[row.condition] || row.condition,
    location: row.location,
    maxDays: row.max_days,
    dailyRate: row.daily_rate,          // sen
    deposit: row.deposit,               // sen
    image: imageUrl(row.cover),
    status: row.status,
    availability: availability(row),
    onLoanUntil: row.on_loan_until,
    pendingCount: row.pending_count,
    timesBorrowed: row.times_borrowed,
    rating: { average: row.rating_avg, count: row.rating_count },
    removedReason: row.removed_reason,
    createdAt: row.created_at,
    owner: {
      id: row.owner_id,
      name: row.owner_name,
      avatar: imageUrl(row.owner_avatar),
      trustPoints: row.owner_trust,
    },
    isMine: viewer ? row.owner_id === viewer.id : false,
  };
}

const getToolRow = id => db.prepare(`${TOOL_SELECT} WHERE t.id = ?`).get(Number(id));
const toolPhotos = id => db.prepare('SELECT id, path FROM tool_photos WHERE tool_id = ? ORDER BY position, id').all(id)
  .map(p => ({ id: p.id, url: imageUrl(p.path) }));

function toolReviews(toolId, viewer) {
  return db.prepare(`SELECT r.*, u.full_name AS reviewer_name, u.avatar_path AS reviewer_avatar FROM reviews r
                     JOIN users u ON u.id = r.reviewer_id
                     WHERE r.tool_id = ? AND r.target_type = 'tool' AND r.removed = 0 ORDER BY r.id DESC`).all(toolId)
    .map(r => serializeReview(r, viewer));
}

function serializeReview(r, viewer) {
  const isAdmin = viewer?.role === 'admin';
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment_hidden && !isAdmin ? null : r.comment,
    commentHidden: !!r.comment_hidden,
    reviewer: { id: r.reviewer_id, name: r.reviewer_name, avatar: imageUrl(r.reviewer_avatar) },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    edited: r.updated_at !== r.created_at,
  };
}

function readMoney(value, max, label, field, errors) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max || Math.round(n * 100) !== Number((n * 100).toFixed(2))) {
    errors[field] = `${label} must be between RM 0 and RM ${max}.`;
    return 0;
  }
  return Math.round(n * 100);
}

function readToolInput(body) {
  const errors = {};
  const input = {
    name:        cleanText(body.name, 80),
    category:    String(body.category || ''),
    description: cleanMultiline(body.description, 1000),
    specs:       cleanMultiline(body.specs, 1000),
    condition:   String(body.condition || ''),
    location:    cleanText(body.location, 100),
    maxDays:     Number(body.maxDays),
  };
  input.dailyRate = readMoney(body.dailyRate, config.MAX_DAILY_RATE, 'Daily rate', 'dailyRate', errors);
  input.deposit   = readMoney(body.deposit, config.MAX_DEPOSIT, 'Security deposit', 'deposit', errors);

  if (input.name.length < 3) errors.name = 'Tool name must be at least 3 characters.';
  if (!CATEGORIES[input.category]) errors.category = 'Choose a category.';
  if (!CONDITIONS[input.condition]) errors.condition = 'Choose the condition.';
  if (input.description.length < 10) errors.description = 'Describe the item in at least 10 characters.';
  if (input.location.length < 3) errors.location = 'Enter a pick-up location on campus.';
  if (!Number.isInteger(input.maxDays) || input.maxDays < 1 || input.maxDays > config.MAX_LOAN_DAYS) {
    errors.maxDays = `Maximum rental period must be 1–${config.MAX_LOAN_DAYS} days.`;
  }
  if (Object.keys(errors).length) fail(400, 'Please fix the highlighted fields.', errors);
  return input;
}

/**
 * photos: ordered array of { id } (keep an existing photo) or { data } (new upload).
 * Saves new images first so a bad file fails before anything changes.
 */
function applyPhotos(toolId, photos) {
  if (!Array.isArray(photos)) return;
  if (photos.length > config.MAX_PHOTOS) fail(400, `You can upload at most ${config.MAX_PHOTOS} photos.`);
  const existing = db.prepare('SELECT id, path FROM tool_photos WHERE tool_id = ?').all(toolId);
  const plan = photos.map(p => (p && p.data ? { path: saveImage(p.data, 'tools') } : { id: Number(p?.id) }));
  const keepIds = new Set(plan.filter(p => p.id).map(p => p.id));

  for (const photo of existing) {
    if (!keepIds.has(photo.id)) {
      db.prepare('DELETE FROM tool_photos WHERE id = ?').run(photo.id);
      deleteImage(photo.path);
    }
  }
  plan.forEach((p, position) => {
    if (p.path) db.prepare('INSERT INTO tool_photos (tool_id, path, position) VALUES (?, ?, ?)').run(toolId, p.path, position);
    else if (existing.some(e => e.id === p.id)) db.prepare('UPDATE tool_photos SET position = ? WHERE id = ?').run(position, p.id);
  });
}

/* ── Meta ─────────────────────────────────────────── */
router.get('/meta', requireAuth, (req, res) => {
  res.json({
    categories: CATEGORIES, conditions: CONDITIONS, maxLoanDays: config.MAX_LOAN_DAYS,
    maxDailyRate: config.MAX_DAILY_RATE, maxDeposit: config.MAX_DEPOSIT, maxPhotos: config.MAX_PHOTOS,
  });
});

/* ── Read: list / search / filter ─────────────────── */
// scope=catalog (default) | mine | all (admin)
router.get('/', requireAuth, (req, res) => {
  const scope = String(req.query.scope || 'catalog');
  const where = [];
  const params = [];

  if (scope === 'mine') {
    where.push("t.owner_id = ? AND t.status != 'removed'");
    params.push(req.user.id);
  } else if (scope === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Admin access only.');
    if (['available', 'maintenance', 'removed'].includes(req.query.status)) { where.push('t.status = ?'); params.push(req.query.status); }
  } else {
    where.push("t.status != 'removed' AND u.status = 'active'");
  }

  const q = cleanText(req.query.q, 60);
  if (q) { where.push('(t.name LIKE ? OR t.description LIKE ? OR t.specs LIKE ? OR u.full_name LIKE ?)'); params.push(...Array(4).fill(`%${q}%`)); }
  if (CATEGORIES[req.query.category]) { where.push('t.category = ?'); params.push(req.query.category); }
  if (CONDITIONS[req.query.condition]) { where.push('t.condition = ?'); params.push(req.query.condition); }
  const maxRate = Number(req.query.maxRate);
  if (req.query.maxRate && Number.isFinite(maxRate)) { where.push('t.daily_rate <= ?'); params.push(Math.round(maxRate * 100)); }

  const orders = {
    price_asc: 't.daily_rate ASC, t.id DESC',
    price_desc: 't.daily_rate DESC, t.id DESC',
    rating: 'rating_avg IS NULL, rating_avg DESC, rating_count DESC',
    name: 't.name COLLATE NOCASE ASC',
  };
  const order = orders[req.query.sort] || 't.created_at DESC, t.id DESC';
  let tools = db.prepare(`${TOOL_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`).all(...params)
    .map(row => serializeTool(row, req.user));

  if (['available', 'on_loan', 'maintenance'].includes(req.query.availability)) tools = tools.filter(t => t.availability === req.query.availability);
  if (req.query.limit) tools = tools.slice(0, Math.max(1, Number(req.query.limit) || 0));
  res.json({ tools });
});

/* ── Read: detail ─────────────────────────────────── */
router.get('/:id', requireAuth, (req, res) => {
  const row = getToolRow(req.params.id);
  const isOwner = row && row.owner_id === req.user.id;
  if (!row || (row.status === 'removed' && !isOwner && req.user.role !== 'admin')) fail(404, 'This listing is no longer available.');

  const tool = serializeTool(row, req.user);
  tool.photos = toolPhotos(row.id);
  tool.reviews = toolReviews(row.id, req.user);
  tool.owner.rating = ratingSummary("target_user_id = ? AND target_type = 'user'", row.owner_id);
  // Dates already taken by confirmed bookings, so borrowers can pick free dates.
  tool.bookedRanges = db.prepare(`SELECT start_date AS start, end_date AS end FROM loans
                                  WHERE tool_id = ? AND status IN (${sqlList(COMMITTED)}) AND end_date >= ? ORDER BY start_date`).all(row.id, today());
  const mine = db.prepare(`SELECT id, status, start_date, end_date FROM loans
                           WHERE tool_id = ? AND borrower_id = ? AND status IN ('awaiting_payment', 'pending', ${sqlList(COMMITTED)})
                           ORDER BY id DESC LIMIT 1`).get(row.id, req.user.id);
  tool.myBooking = mine ? { id: mine.id, status: mine.status, startDate: mine.start_date, endDate: mine.end_date } : null;
  res.json({ tool });
});

/* ── Create ───────────────────────────────────────── */
router.post('/', requireStudent, handle(async (req, res) => {
  const input = readToolInput(req.body || {});
  const id = transaction(() => {
    const result = db.prepare(`INSERT INTO tools (owner_id, name, category, description, specs, condition, location, max_days, daily_rate, deposit)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, input.name, input.category, input.description, input.specs, input.condition, input.location, input.maxDays, input.dailyRate, input.deposit);
    const toolId = Number(result.lastInsertRowid);
    applyPhotos(toolId, req.body.photos || []);
    return toolId;
  });
  res.status(201).json({ tool: serializeTool(getToolRow(id), req.user) });
}));

/* ── Update ───────────────────────────────────────── */
function getOwnedTool(req) {
  const row = getToolRow(req.params.id);
  if (!row || row.status === 'removed') fail(404, 'Listing not found.');
  if (row.owner_id !== req.user.id) fail(403, 'You can only change listings you posted.');
  return row;
}

router.put('/:id', requireStudent, handle(async (req, res) => {
  const row = getOwnedTool(req);
  const input = readToolInput(req.body || {});
  transaction(() => {
    db.prepare(`UPDATE tools SET name = ?, category = ?, description = ?, specs = ?, condition = ?, location = ?, max_days = ?,
                daily_rate = ?, deposit = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(input.name, input.category, input.description, input.specs, input.condition, input.location, input.maxDays, input.dailyRate, input.deposit, row.id);
    applyPhotos(row.id, req.body.photos);
  });
  // Existing bookings keep the price they were paid at.
  res.json({ tool: serializeTool(getToolRow(row.id), req.user), message: 'Listing updated. Existing bookings keep their original price.' });
}));

router.post('/:id/status', requireStudent, (req, res) => {
  const row = getOwnedTool(req);
  const status = req.body?.status === 'maintenance' ? 'maintenance' : 'available';
  if (status === 'maintenance') {
    const busy = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE tool_id = ? AND status IN ('confirmed', 'active', 'return_pending')`).get(row.id).n;
    if (busy) fail(409, 'This item has a confirmed or active booking. Finish or cancel it before marking the item as under maintenance.');
  }
  db.prepare(`UPDATE tools SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, row.id);
  res.json({
    tool: serializeTool(getToolRow(row.id), req.user),
    message: status === 'maintenance' ? 'Marked as under maintenance. Borrowers cannot book it until you set it back to available.' : 'Item is available for booking again.',
  });
});

/* ── Delete (owner or admin) ──────────────────────── */
const REMOVAL_REASONS = { no_longer_offered: 'No longer offered', broken: 'Broken', scrapped: 'Scrapped', other: 'Other' };

router.delete('/:id', requireAuth, (req, res) => {
  const row = getToolRow(req.params.id);
  if (!row || row.status === 'removed') fail(404, 'Listing not found.');
  const isAdmin = req.user.role === 'admin';
  const asModerator = isAdmin && row.owner_id !== req.user.id;
  if (row.owner_id !== req.user.id && !isAdmin) fail(403, 'You can only remove listings you posted.');

  const committed = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE tool_id = ? AND status IN (${sqlList(COMMITTED)})`).get(row.id).n;
  if (committed) fail(409, 'This item has confirmed, active or disputed bookings. It can be removed once they are finished.');

  const note = cleanText(req.body?.reason, 200);
  let reason;
  if (asModerator) {
    if (note.length < 5) fail(400, 'Please give the owner a reason for removing this listing.', { reason: 'Enter a reason (at least 5 characters).' });
    reason = `Removed by admin: ${note}`;
  } else {
    reason = REMOVAL_REASONS[req.body?.reasonCode] || 'No longer offered';
    if (note) reason += ` – ${note}`;
  }

  transaction(() => {
    db.prepare(`UPDATE tools SET status = 'removed', removed_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(reason, row.id);
    // Open requests are declined and fully refunded.
    const open = db.prepare(`SELECT * FROM loans WHERE tool_id = ? AND status IN ('awaiting_payment', 'pending')`).all(row.id);
    for (const loan of open) {
      const refund = refundAll(loan, 'Listing removed');
      db.prepare(`UPDATE loans SET status = 'declined', cancel_reason = 'The listing was removed.', updated_at = datetime('now') WHERE id = ?`).run(loan.id);
      logEvent(loan.id, req.user.id, 'declined', 'Listing removed');
      notify(loan.borrower_id, 'Booking declined', `Your booking for ${row.name} was declined because the listing was removed.${refund ? ` ${rm(refund.amount)} has been refunded.` : ''}`, 'fa-circle-xmark', 'my-loans.html');
    }
  });
  if (asModerator) notify(row.owner_id, 'Listing removed by admin', `Your listing "${row.name}" was removed. Reason: ${note}`, 'fa-triangle-exclamation', 'my-tools.html');
  res.json({ message: 'Listing removed from the catalog.' });
});

module.exports = { router, serializeTool, serializeReview, TOOL_SELECT, REMOVAL_REASONS };
