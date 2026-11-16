/* ============================================================
   Module 6 – Rating, Review & Feedback Management (RFM)
   ============================================================ */

const express = require('express');
const { db } = require('../db');
const {
  config, cleanMultiline, cleanText, fail, imageUrl, transaction, ratingSummary,
  requireAuth, requireStudent, requireAdmin, notify, adjustTrust,
} = require('../helpers');

const router = express.Router();

const bonusFor = rating => config.TRUST_RATING_BONUS[rating] || 0;
const editableUntil = createdAt => new Date(new Date(createdAt.replace(' ', 'T') + 'Z').getTime() + config.REVIEW_EDIT_DAYS * 86400000);

function serialize(r, viewer) {
  const isAdmin = viewer.role === 'admin';
  return {
    id: r.id,
    loanId: r.loan_id,
    targetType: r.target_type,
    rating: r.rating,
    comment: r.comment_hidden && !isAdmin ? null : r.comment,
    commentHidden: !!r.comment_hidden,
    reviewer: { id: r.reviewer_id, name: r.reviewer_name, avatar: imageUrl(r.reviewer_avatar) },
    toolName: r.tool_name || null,
    bonusPoints: isAdmin ? r.bonus_points : undefined,
    createdAt: r.created_at,
    edited: r.updated_at !== r.created_at,
    editableUntil: editableUntil(r.created_at).toISOString(),
    canEdit: r.reviewer_id === viewer.id && editableUntil(r.created_at) > new Date(),
  };
}

const REVIEW_SELECT = `
  SELECT r.*, u.full_name AS reviewer_name, u.avatar_path AS reviewer_avatar, t.name AS tool_name
  FROM reviews r JOIN users u ON u.id = r.reviewer_id
  LEFT JOIN loans l ON l.id = r.loan_id LEFT JOIN tools t ON t.id = l.tool_id`;

/* ── Read ─────────────────────────────────────────── */
router.get('/', requireAuth, (req, res) => {
  let rows, summary;
  if (req.query.userId) {
    rows = db.prepare(`${REVIEW_SELECT} WHERE r.target_type = 'user' AND r.target_user_id = ? AND r.removed = 0 ORDER BY r.id DESC`).all(Number(req.query.userId));
    summary = ratingSummary("target_type = 'user' AND target_user_id = ?", Number(req.query.userId));
  } else if (req.query.toolId) {
    rows = db.prepare(`${REVIEW_SELECT} WHERE r.target_type = 'tool' AND r.tool_id = ? AND r.removed = 0 ORDER BY r.id DESC`).all(Number(req.query.toolId));
    summary = ratingSummary("target_type = 'tool' AND tool_id = ?", Number(req.query.toolId));
  } else fail(400, 'Specify userId or toolId.');
  res.json({ reviews: rows.map(r => serialize(r, req.user)), summary });
});

/* ── Create / update (one per person or item per booking) ── */
router.post('/', requireStudent, (req, res) => {
  const loan = db.prepare(`SELECT l.*, t.name AS tool_name FROM loans l JOIN tools t ON t.id = l.tool_id WHERE l.id = ?`).get(Number(req.body?.loanId));
  if (!loan || ![loan.borrower_id, loan.owner_id].includes(req.user.id)) fail(404, 'Booking not found.');
  if (loan.status !== 'completed') fail(409, 'You can rate a booking after it is completed.');

  const targetType = req.body?.targetType === 'tool' ? 'tool' : 'user';
  const isBorrower = req.user.id === loan.borrower_id;
  if (targetType === 'tool' && !isBorrower) fail(400, 'Only the borrower can rate the hardware.');
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'Choose 1 to 5 stars.', { rating: 'Choose 1 to 5 stars.' });
  const comment = cleanMultiline(req.body?.comment, 600);
  const targetUser = isBorrower ? loan.owner_id : loan.borrower_id;

  const existing = db.prepare('SELECT * FROM reviews WHERE loan_id = ? AND reviewer_id = ? AND target_type = ?').get(loan.id, req.user.id, targetType);
  if (existing?.removed) fail(409, 'This review was removed by an admin and cannot be edited.');
  if (existing && editableUntil(existing.created_at) <= new Date()) fail(409, `Reviews can only be edited within ${config.REVIEW_EDIT_DAYS} days.`);

  const message = transaction(() => {
    if (targetType === 'tool') {
      if (existing) db.prepare("UPDATE reviews SET rating = ?, comment = ?, updated_at = datetime('now') WHERE id = ?").run(rating, comment, existing.id);
      else db.prepare("INSERT INTO reviews (loan_id, reviewer_id, target_type, tool_id, rating, comment) VALUES (?, ?, 'tool', ?, ?, ?)").run(loan.id, req.user.id, loan.tool_id, rating, comment);
      return existing ? 'Item review updated.' : 'Thanks for rating the item.';
    }

    // Person reviews: Trust Point bonus follows the stars (recalculated on edit).
    const newBonus = bonusFor(rating);
    let reviewId;
    if (existing) {
      db.prepare("UPDATE reviews SET rating = ?, comment = ?, bonus_points = ?, updated_at = datetime('now') WHERE id = ?").run(rating, comment, newBonus, existing.id);
      reviewId = existing.id;
      const delta = newBonus - existing.bonus_points;
      if (delta) adjustTrust(targetUser, delta, `Rating changed from ${existing.rating}★ to ${rating}★`, 'review', reviewId);
    } else {
      reviewId = Number(db.prepare("INSERT INTO reviews (loan_id, reviewer_id, target_type, target_user_id, rating, comment, bonus_points) VALUES (?, ?, 'user', ?, ?, ?, ?)")
        .run(loan.id, req.user.id, targetUser, rating, comment, newBonus).lastInsertRowid);
      if (newBonus) adjustTrust(targetUser, newBonus, `${rating}★ rating received`, 'review', reviewId);
      else notify(targetUser, 'New rating', `${req.user.full_name} rated you ${rating}★ for ${loan.tool_name}.`, 'fa-star', 'profile.html');
    }
    const wasLow = existing && existing.rating <= config.LOW_RATING_WARNING_AT;
    if (rating <= config.LOW_RATING_WARNING_AT && !wasLow) {
      notify(targetUser, 'Reputation warning', `You received a ${rating}★ rating for ${loan.tool_name}. Repeated low ratings may affect your standing in the community.`, 'fa-triangle-exclamation', 'profile.html');
    }
    return existing ? 'Review updated.' : 'Thanks for your review.';
  });
  res.json({ message });
});

/* ── Admin moderation ─────────────────────────────── */
router.post('/:id/hide', requireAdmin, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ? AND removed = 0').get(Number(req.params.id));
  if (!review) fail(404, 'Review not found.');
  const hidden = req.body?.hidden !== false;
  db.prepare('UPDATE reviews SET comment_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, review.id);
  if (hidden) notify(review.reviewer_id, 'Review comment hidden', 'An admin hid the comment on one of your reviews because it broke the community rules. Your star rating still counts.', 'fa-eye-slash');
  res.json({ message: hidden ? 'Comment hidden. The star rating and any bonus it earned are kept.' : 'Comment is visible again.' });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ? AND removed = 0').get(Number(req.params.id));
  if (!review) fail(404, 'Review not found.');
  const reason = cleanText(req.body?.reason, 200);
  if (reason.length < 3) fail(400, 'Give a reason (e.g. fake or spam).', { reason: 'Enter a reason.' });
  transaction(() => {
    db.prepare('UPDATE reviews SET removed = 1, removed_reason = ?, bonus_points = 0 WHERE id = ?').run(reason, review.id);
    if (review.bonus_points && review.target_user_id) adjustTrust(review.target_user_id, -review.bonus_points, 'Bonus reversed: a review you received was removed', 'review', review.id);
  });
  notify(review.reviewer_id, 'Review removed', `An admin removed one of your reviews. Reason: ${reason}`, 'fa-trash');
  res.json({ message: `Review removed and excluded from the average${review.bonus_points ? `; ${review.bonus_points} bonus Trust Points reversed` : ''}.` });
});

module.exports = { router, serialize, REVIEW_SELECT };
