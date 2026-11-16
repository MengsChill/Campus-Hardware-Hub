/* ============================================================
   Module 5 – Dispute & Damage Management (DDM)
   open → resolved (admin decision) | dismissed (invalid) | settled (parties agreed)
   ============================================================ */

const express = require('express');
const { db } = require('../db');
const {
  config, rm, today, cleanText, cleanMultiline, fail, handle, transaction, imageUrl,
  requireAuth, requireStudent, requireAdmin, notify, notifyAdmins, logEvent, adjustTrust, escrowBalance, saveImage,
} = require('../helpers');
const { getLoanRow, completeLoan, setLoan, loanRef } = require('./loans');

const router = express.Router();

const TYPES = { damage: 'Damaged hardware', lost: 'Lost item', not_returned: 'Refused to return overdue item' };
const MAX_EVIDENCE = 4;

const DISPUTE_SELECT = `
  SELECT d.*, l.tool_id, l.borrower_id, l.owner_id, l.deposit, l.start_date, l.end_date, l.status AS loan_status, l.return_photo, l.return_note,
         t.name AS tool_name, b.full_name AS borrower_name, o.full_name AS owner_name, f.full_name AS filed_by_name, a.full_name AS decided_by_name,
         b.trust_points AS borrower_trust
  FROM disputes d
  JOIN loans l ON l.id = d.loan_id
  JOIN tools t ON t.id = l.tool_id
  JOIN users b ON b.id = l.borrower_id
  JOIN users o ON o.id = l.owner_id
  JOIN users f ON f.id = d.filed_by
  LEFT JOIN users a ON a.id = d.decided_by`;

function serialize(row, viewer) {
  const isParty = [row.borrower_id, row.owner_id].includes(viewer.id);
  return {
    id: row.id,
    ref: 'DSP-' + String(row.id).padStart(5, '0'),
    loan: { id: row.loan_id, ref: loanRef(row.loan_id), status: row.loan_status, startDate: row.start_date, endDate: row.end_date, deposit: row.deposit },
    tool: { id: row.tool_id, name: row.tool_name },
    borrower: { id: row.borrower_id, name: row.borrower_name, trustPoints: row.borrower_trust },
    owner: { id: row.owner_id, name: row.owner_name },
    filedBy: { id: row.filed_by, name: row.filed_by_name },
    type: row.type,
    typeName: TYPES[row.type],
    description: row.description,
    claimAmount: row.claim_amount,
    status: row.status,
    decision: row.decided_at ? {
      deduction: row.deduction, violation: !!row.violation, penaltyPoints: row.penalty_points,
      note: row.admin_note, by: row.decided_by_name, at: row.decided_at,
    } : null,
    heldDeposit: escrowBalance(row.loan_id),
    createdAt: row.created_at,
    viewerRole: viewer.role === 'admin' ? 'admin' : viewer.id === row.owner_id ? 'lender' : 'borrower',
    canAddStatement: isParty && row.status === 'open',
  };
}

const getRow = id => db.prepare(`${DISPUTE_SELECT} WHERE d.id = ?`).get(Number(id));

function saveEvidence(disputeId, userId, images) {
  if (!Array.isArray(images)) return 0;
  if (images.length > MAX_EVIDENCE) fail(400, `Attach at most ${MAX_EVIDENCE} photos.`);
  const paths = images.map(img => saveImage(img, 'evidence'));   // validate all before inserting
  paths.forEach(p => db.prepare('INSERT INTO dispute_evidence (dispute_id, user_id, path) VALUES (?, ?, ?)').run(disputeId, userId, p));
  return paths.length;
}

const event = (disputeId, actorId, action, note = null) =>
  db.prepare('INSERT INTO dispute_events (dispute_id, actor_id, action, note) VALUES (?, ?, ?, ?)').run(disputeId, actorId, action, note);

/* ── Read ─────────────────────────────────────────── */
router.get('/', requireAuth, (req, res) => {
  const where = [];
  const params = [];
  if (req.user.role !== 'admin') { where.push('(l.borrower_id = ? OR l.owner_id = ?)'); params.push(req.user.id, req.user.id); }
  if (['open', 'resolved', 'dismissed', 'settled'].includes(req.query.status)) { where.push('d.status = ?'); params.push(req.query.status); }
  const rows = db.prepare(`${DISPUTE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.status = 'open' DESC, d.id DESC`).all(...params);
  res.json({ disputes: rows.map(r => serialize(r, req.user)), types: TYPES });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = getRow(req.params.id);
  if (!row || (req.user.role !== 'admin' && ![row.borrower_id, row.owner_id].includes(req.user.id))) fail(404, 'Dispute not found.');
  const dispute = serialize(row, req.user);
  dispute.returnPhoto = imageUrl(row.return_photo);
  dispute.returnNote = row.return_note;
  dispute.evidence = db.prepare(`SELECT e.path, e.created_at AS createdAt, u.full_name AS by FROM dispute_evidence e JOIN users u ON u.id = e.user_id
                                 WHERE e.dispute_id = ? ORDER BY e.id`).all(row.id).map(e => ({ ...e, url: imageUrl(e.path), path: undefined }));
  dispute.statements = db.prepare(`SELECT s.body, s.created_at AS createdAt, u.full_name AS by, s.user_id AS userId FROM dispute_statements s
                                   JOIN users u ON u.id = s.user_id WHERE s.dispute_id = ? ORDER BY s.id`).all(row.id)
    .map(s => ({ ...s, side: s.userId === row.owner_id ? 'Lender' : s.userId === row.borrower_id ? 'Borrower' : 'Admin' }));
  dispute.history = db.prepare(`SELECT e.action, e.note, e.created_at AS createdAt, u.full_name AS actor FROM dispute_events e
                                LEFT JOIN users u ON u.id = e.actor_id WHERE e.dispute_id = ? ORDER BY e.id`).all(row.id);
  dispute.penaltyRules = config.TRUST_PENALTY;
  res.json({ dispute });
});

/* ── Create (lender files a claim) ────────────────── */
router.post('/', requireStudent, handle(async (req, res) => {
  const loan = getLoanRow(req.body?.loanId);
  if (!loan || loan.owner_id !== req.user.id) fail(404, 'Booking not found.');
  const type = String(req.body?.type || '');
  const overdue = loan.status === 'active' && loan.end_date < today();
  const allowed = loan.status === 'return_pending' ? ['damage', 'lost'] : overdue ? ['not_returned', 'lost'] : [];
  if (!allowed.length) fail(409, 'You can file a claim after the item is returned, or when it is overdue.');
  if (!allowed.includes(type)) fail(400, 'Choose a valid claim type.', { type: 'Choose a valid claim type.' });
  if (db.prepare("SELECT 1 FROM disputes WHERE loan_id = ? AND status = 'open'").get(loan.id)) fail(409, 'There is already an open dispute for this booking.');

  const description = cleanMultiline(req.body?.description, 1500);
  const claim = Math.round(Number(req.body?.claimAmount) * 100);
  const evidence = Array.isArray(req.body?.evidence) ? req.body.evidence : [];
  const errors = {};
  if (description.length < 20) errors.description = 'Describe what happened in at least 20 characters.';
  if (!Number.isFinite(claim) || claim < 0 || claim > loan.deposit) errors.claimAmount = `Claim must be between RM 0 and the deposit (${rm(loan.deposit)}).`;
  if (type === 'damage' && !evidence.length) errors.evidence = 'Attach at least one photo of the damage.';
  if (Object.keys(errors).length) fail(400, 'Please fix the highlighted fields.', errors);

  const disputeId = transaction(() => {
    const id = Number(db.prepare('INSERT INTO disputes (loan_id, filed_by, against_id, type, description, claim_amount) VALUES (?, ?, ?, ?, ?, ?)')
      .run(loan.id, req.user.id, loan.borrower_id, type, description, claim).lastInsertRowid);
    saveEvidence(id, req.user.id, evidence);
    event(id, req.user.id, 'filed', `${TYPES[type]} · claim ${rm(claim)}`);
    setLoan(loan.id, { status: 'disputed' });
    logEvent(loan.id, req.user.id, 'disputed', TYPES[type]);
    return id;
  });
  notify(loan.borrower_id, 'A claim was filed against you', `${req.user.full_name} filed a "${TYPES[type]}" claim for ${loan.tool_name} (${rm(claim)}). Add your statement and evidence.`, 'fa-scale-balanced', 'disputes.html');
  notifyAdmins('New dispute filed', `${req.user.full_name} filed a ${TYPES[type].toLowerCase()} claim on ${loan.tool_name} (borrowed by ${loan.borrower_name}).`, 'fa-scale-balanced', 'disputes.html');
  res.status(201).json({ message: 'Claim filed. The deposit stays in escrow until an admin decides.', id: disputeId });
}));

/* ── Statements & extra evidence from either party ── */
router.post('/:id/statements', requireStudent, handle(async (req, res) => {
  const row = getRow(req.params.id);
  if (!row || ![row.borrower_id, row.owner_id].includes(req.user.id)) fail(404, 'Dispute not found.');
  if (row.status !== 'open') fail(409, 'This dispute is closed.');
  const body = cleanMultiline(req.body?.body, 1500);
  const evidence = Array.isArray(req.body?.evidence) ? req.body.evidence : [];
  if (body.length < 5 && !evidence.length) fail(400, 'Write a statement or attach a photo.', { statement: 'Write your statement.' });
  transaction(() => {
    if (body) db.prepare('INSERT INTO dispute_statements (dispute_id, user_id, body) VALUES (?, ?, ?)').run(row.id, req.user.id, body);
    const n = saveEvidence(row.id, req.user.id, evidence);
    event(row.id, req.user.id, 'statement', n ? `${n} photo${n === 1 ? '' : 's'} attached` : null);
  });
  const other = req.user.id === row.owner_id ? row.borrower_id : row.owner_id;
  notify(other, 'New statement in dispute', `${req.user.full_name} added a statement to the dispute about ${row.tool_name}.`, 'fa-comment-dots', 'disputes.html');
  res.json({ message: 'Statement added.' });
}));

/* ── Admin decisions ──────────────────────────────── */
function readDeduction(body, row) {
  const held = escrowBalance(row.loan_id);
  const deduction = Math.round(Number(body?.deduction) * 100);
  if (!Number.isFinite(deduction) || deduction < 0 || deduction > held) {
    fail(400, `Deduction must be between RM 0 and the held deposit (${rm(held)}).`, { deduction: `Max ${rm(held)}.` });
  }
  return deduction;
}

function decide(req, status, { deduction = 0, violation = false }) {
  const row = getRow(req.params.id);
  if (!row) fail(404, 'Dispute not found.');
  if (row.status !== 'open') fail(409, 'This dispute has already been decided.');
  const note = cleanText(req.body?.note, 500);
  if (note.length < 5) fail(400, 'Write a short explanation of the decision.', { note: 'Explain the decision.' });
  const penalty = violation ? config.TRUST_PENALTY[row.type] : 0;

  transaction(() => {
    db.prepare(`UPDATE disputes SET status = ?, deduction = ?, violation = ?, penalty_points = ?, admin_note = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?`)
      .run(status, deduction, violation ? 1 : 0, penalty, note, req.user.id, row.id);
    event(row.id, req.user.id, status, `${note} · deduction ${rm(deduction)}${penalty ? ` · −${penalty} Trust Points` : ''}`);
    completeLoan(getLoanRow(row.loan_id), { deduction, actorId: req.user.id, viaDispute: true });
    if (penalty) adjustTrust(row.borrower_id, -penalty, `Confirmed violation: ${TYPES[row.type].toLowerCase()} (${row.tool_name})`, 'dispute', row.id);
  });

  const refund = row.deposit - deduction;
  const label = { resolved: 'Dispute resolved', dismissed: 'Claim dismissed', settled: 'Dispute closed as settled' }[status];
  notify(row.owner_id, label, `${row.tool_name}: ${rm(deduction)} of the deposit goes to you. Admin note: ${note}`, 'fa-scale-balanced', 'disputes.html');
  notify(row.borrower_id, label, `${row.tool_name}: ${rm(deduction)} deducted, ${rm(Math.max(0, refund))} refunded to you.${penalty ? ` −${penalty} Trust Points.` : ''} Admin note: ${note}`, 'fa-scale-balanced', 'disputes.html');
  return { refund, penalty };
}

router.post('/:id/resolve', requireAdmin, (req, res) => {
  const row = getRow(req.params.id);
  if (!row) fail(404, 'Dispute not found.');
  const deduction = readDeduction(req.body, row);
  const { penalty } = decide(req, 'resolved', { deduction, violation: req.body?.violation === true });
  res.json({ message: `Dispute resolved. ${rm(deduction)} paid to the lender from the deposit${penalty ? `, ${penalty} Trust Points deducted from the borrower` : ''}.` });
});

router.post('/:id/dismiss', requireAdmin, (req, res) => {
  decide(req, 'dismissed', { deduction: 0 });
  res.json({ message: 'Claim dismissed. The full deposit has been refunded to the borrower.' });
});

router.post('/:id/settle', requireAdmin, (req, res) => {
  const row = getRow(req.params.id);
  if (!row) fail(404, 'Dispute not found.');
  const deduction = readDeduction(req.body, row);
  decide(req, 'settled', { deduction });
  res.json({ message: `Closed as settled by both parties. ${rm(deduction)} paid to the lender; no Trust Point penalty.` });
});

module.exports = { router, TYPES };
