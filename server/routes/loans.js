/* ============================================================
   Module 3 – Booking & Online Payment Management (LPM)
   Module 4 – Handover Verification & Status Tracking (HST)

   awaiting_payment → pending (paid; handover time/place negotiated)
     → confirmed (4-digit PIN issued to the borrower)
     → active (lender entered the PIN; rental fee released to lender)
     → return_pending (borrower returned it with a condition photo)
     → completed (lender inspected; deposit refunded)   or → disputed (Module 5)
   Before handover either party may cancel → cancelled (full refund).
   Declined requests/counter-offers → declined (full refund).
   Admin/system can void a meetup that never happened → voided (full refund).
   ============================================================ */

const crypto  = require('node:crypto');
const express = require('express');
const { db } = require('../db');
const {
  config, CATEGORIES, COMMITTED, OPEN, FINAL, sqlList, rm, sqlNow,
  cleanText, cleanMultiline, today, addDays, daysBetween, isDateStr, isDateTimeStr, now,
  fail, handle, transaction, imageUrl, requireAuth, requireStudent, requireAdmin,
  notify, logEvent, adjustTrust, addTransaction, escrowBalance, refundAll, saveImage,
} = require('../helpers');

const router = express.Router();

const LOAN_SELECT = `
  SELECT l.*,
    t.name AS tool_name, t.category AS tool_category, t.location AS tool_location, t.status AS tool_status,
    (SELECT path FROM tool_photos p WHERE p.tool_id = t.id ORDER BY position, id LIMIT 1) AS tool_image,
    b.full_name AS borrower_name, b.avatar_path AS borrower_avatar, b.email AS borrower_email, b.phone AS borrower_phone, b.whatsapp AS borrower_whatsapp, b.trust_points AS borrower_trust,
    o.full_name AS owner_name,    o.avatar_path AS owner_avatar,    o.email AS owner_email,    o.phone AS owner_phone,    o.whatsapp AS owner_whatsapp,    o.trust_points AS owner_trust,
    (SELECT id FROM disputes d WHERE d.loan_id = l.id ORDER BY id DESC LIMIT 1) AS dispute_id,
    (SELECT status FROM disputes d WHERE d.loan_id = l.id ORDER BY id DESC LIMIT 1) AS dispute_status
  FROM loans l
  JOIN tools t ON t.id = l.tool_id
  JOIN users b ON b.id = l.borrower_id
  JOIN users o ON o.id = l.owner_id`;

const loanRef = id => 'BK-' + String(id).padStart(5, '0');
const localDate = sqlDateTime => new Date(sqlDateTime.replace(' ', 'T') + 'Z').toLocaleDateString('en-CA');
const isOverdue = row => row.status === 'active' && row.end_date < today();
const getLoanRow = id => db.prepare(`${LOAN_SELECT} WHERE l.id = ?`).get(Number(id));

function serializeLoan(row, viewer) {
  const isBorrower = viewer.id === row.borrower_id;
  const isOwner    = viewer.id === row.owner_id;
  const isAdmin    = viewer.role === 'admin';
  const myRole     = isBorrower ? 'borrower' : isOwner ? 'lender' : 'admin';
  // Contact details only once the booking is confirmed.
  const showContact = isAdmin || [...COMMITTED, 'completed'].includes(row.status);
  const party = prefix => ({
    id: row[prefix + '_id'],
    name: row[prefix + '_name'],
    avatar: imageUrl(row[prefix + '_avatar']),
    trustPoints: row[prefix + '_trust'],
    email: showContact ? row[prefix + '_email'] : null,
    phone: showContact ? row[prefix + '_phone'] : null,
    whatsapp: showContact ? row[prefix + '_whatsapp'] : null,
  });
  const status = isOverdue(row) ? 'overdue' : row.status;
  const pending = row.status === 'pending';
  const myTurn = pending && row.awaiting === myRole;
  const disputeOpen = row.dispute_status === 'open';
  const unread = isAdmin ? 0 : db.prepare('SELECT COUNT(*) AS n FROM messages WHERE loan_id = ? AND sender_id != ? AND read_at IS NULL').get(row.id, viewer.id).n;

  return {
    id: row.id,
    ref: loanRef(row.id),
    tool: {
      id: row.tool_id,
      name: row.tool_name,
      image: imageUrl(row.tool_image),
      categoryName: CATEGORIES[row.tool_category] || 'Others',
      location: row.tool_location,
    },
    borrower: party('borrower'),
    owner: party('owner'),
    viewerRole: myRole,
    startDate: row.start_date,
    endDate: row.end_date,
    days: row.days,
    daysLeft: ['active', 'confirmed'].includes(row.status) ? daysBetween(today(), row.end_date) : null,
    cost: { dailyRate: row.daily_rate, rental: row.rental_total, deposit: row.deposit, total: row.rental_total + row.deposit, escrow: escrowBalance(row.id) },
    message: row.message,
    status,
    awaiting: pending ? row.awaiting : null,
    handover: { time: row.handover_time, location: row.handover_location },
    pin: isBorrower && row.status === 'confirmed' ? row.pin : null,
    pinLocked: row.pin_locked_until > now(),
    ownerNote: row.owner_note,
    cancelReason: row.cancel_reason,
    dispute: row.dispute_id ? { id: row.dispute_id, status: row.dispute_status } : null,
    unread,
    timestamps: {
      created: row.created_at, paid: row.paid_at, confirmed: row.confirmed_at, handedOver: row.handed_over_at,
      returned: row.returned_at, inspected: row.inspected_at, completed: row.completed_at, updated: row.updated_at,
    },
    returnPhoto: imageUrl(row.return_photo),
    returnNote: row.return_note,
    actions: {
      pay:          isBorrower && row.status === 'awaiting_payment',
      accept:       myTurn && !isAdmin,
      counter:      myTurn && !isAdmin,
      decline:      pending && (isOwner || (isBorrower && row.awaiting === 'borrower')),
      cancel:       (isBorrower || isOwner) && ['awaiting_payment', 'pending', 'confirmed'].includes(row.status),
      verifyPin:    isOwner && row.status === 'confirmed',
      markReturned: isBorrower && row.status === 'active',
      inspect:      isOwner && row.status === 'return_pending',
      dispute:      isOwner && !disputeOpen && (row.status === 'return_pending' || isOverdue(row)),
      review:       (isBorrower || isOwner) && row.status === 'completed',
      chat:         isBorrower || isOwner || isAdmin,
      receipt:      !!row.paid_at,
      void:         isAdmin && ['confirmed', 'pending'].includes(row.status),
    },
  };
}

/* ── Rules ────────────────────────────────────────── */
function borrowerBlockReason(borrowerId) {
  const overdue = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status = 'active' AND end_date < ?`).get(borrowerId, today()).n;
  if (overdue) return 'You have an overdue item. Return it before booking anything else.';
  const committed = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status IN (${sqlList(COMMITTED)})`).get(borrowerId).n;
  if (committed >= config.MAX_ACTIVE_BOOKINGS) return `You already have ${config.MAX_ACTIVE_BOOKINGS} confirmed or active bookings, which is the limit.`;
  return null;
}

/** A committed booking on this tool whose dates overlap [start, end). */
function findConflict(toolId, start, end, exceptId = 0) {
  return db.prepare(`SELECT id, start_date, end_date FROM loans WHERE tool_id = ? AND id != ? AND status IN (${sqlList(COMMITTED)})
                     AND start_date < ? AND end_date > ?`).get(toolId, exceptId, end, start);
}

function setLoan(loanId, fields) {
  const sets = ["updated_at = datetime('now')"];
  const values = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === 'NOW') sets.push(`${column} = datetime('now')`);
    else { sets.push(`${column} = ?`); values.push(value); }
  }
  db.prepare(`UPDATE loans SET ${sets.join(', ')} WHERE id = ?`).run(...values, loanId);
}

function loadForAction(req, roles, statuses) {
  const row = getLoanRow(req.params.id);
  if (!row) fail(404, 'Booking not found.');
  const role = req.user.id === row.borrower_id ? 'borrower' : req.user.id === row.owner_id ? 'lender' : null;
  if (!role || !roles.includes(role)) fail(403, 'You are not allowed to do this for this booking.');
  if (!statuses.includes(row.status)) fail(409, 'This booking has already moved on. Refresh the page to see its current status.');
  return { row, role };
}

const respond = (res, req, loanId, message, extra = {}) => res.json({ message, loan: serializeLoan(getLoanRow(loanId), req.user), ...extra });

function readHandover(body, startDate, endDate, errors) {
  const time = String(body.handoverTime || '').replace('T', ' ').slice(0, 16);
  const location = cleanText(body.handoverLocation, 120);
  if (!isDateTimeStr(time)) errors.handoverTime = 'Choose a handover date and time.';
  else {
    const date = time.slice(0, 10);
    if (new Date(time.replace(' ', 'T')) < new Date()) errors.handoverTime = 'Handover time cannot be in the past.';
    else if (date < addDays(startDate, -1) || date > startDate) errors.handoverTime = 'Handover must be on the pick-up date or the day before.';
  }
  if (location.length < 3) errors.handoverLocation = 'Enter a meeting place on campus.';
  return { time, location };
}

/** Full refund + final status, used by cancel / decline / void. */
function closeWithRefund(row, status, actorId, reason, notifyText) {
  const refund = refundAll(row, reason);
  setLoan(row.id, { status, cancelled_by: actorId, cancel_reason: reason, pin: null });
  db.prepare("UPDATE handover_proposals SET status = 'declined' WHERE loan_id = ? AND status = 'open'").run(row.id);
  logEvent(row.id, actorId, status, refund ? `${reason} · ${rm(refund.amount)} refunded` : reason);
  const refundText = refund ? ` ${rm(refund.amount)} has been refunded to the borrower.` : '';
  notifyText(refundText);
  return refund;
}

/** Finish a returned booking: settle the deposit and apply Trust Point rules. */
function completeLoan(row, { deduction = 0, actorId = null, viaDispute = false } = {}) {
  const held = escrowBalance(row.id);
  const toLender = Math.min(deduction, held);
  if (toLender > 0) addTransaction(row.id, row.owner_id, 'deposit_deduction', toLender, 'DED', { note: 'Deducted from deposit' });
  const refund = held - toLender;
  if (refund > 0) addTransaction(row.id, row.borrower_id, 'refund', refund, 'RFD', { note: 'Deposit refund' });

  setLoan(row.id, { status: 'completed', completed_at: 'NOW', inspected_at: row.inspected_at || 'NOW' });
  logEvent(row.id, actorId, 'completed', refund ? `${rm(refund)} deposit refunded` : null);

  const late = row.returned_at && localDate(row.returned_at) > row.end_date;
  if (late) adjustTrust(row.borrower_id, -config.TRUST_PENALTY.late_return, `Late return of ${row.tool_name}`, 'loan', row.id);
  else if (!viaDispute) adjustTrust(row.borrower_id, config.TRUST_BONUS_ON_TIME, `Returned ${row.tool_name} on time`, 'loan', row.id);
  return { refund, toLender };
}

/* ── Read ─────────────────────────────────────────── */
// as=borrower | owner | all (admin);  status=open | history | action | overdue | <status>
router.get('/', requireAuth, (req, res) => {
  const as = String(req.query.as || 'borrower');
  const where = [];
  const params = [];
  if (as === 'all') {
    if (req.user.role !== 'admin') fail(403, 'Admin access only.');
  } else {
    where.push(as === 'owner' ? 'l.owner_id = ?' : 'l.borrower_id = ?');
    params.push(req.user.id);
  }
  const status = String(req.query.status || '');
  const inList = list => { where.push(`l.status IN (${list.map(() => '?').join(',')})`); params.push(...list); };
  if (status === 'open') inList(OPEN);
  else if (status === 'history') inList(FINAL);
  else if (status === 'overdue') { where.push("l.status = 'active' AND l.end_date < ?"); params.push(today()); }
  else if (status) inList([status]);

  const q = cleanText(req.query.q, 60);
  if (q) { where.push('(t.name LIKE ? OR b.full_name LIKE ? OR o.full_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const rows = db.prepare(`${LOAN_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.updated_at DESC, l.id DESC LIMIT 300`).all(...params);
  res.json({ loans: rows.map(row => serializeLoan(row, req.user)) });
});

router.get('/eligibility', requireStudent, (req, res) => {
  res.json({
    blocked: borrowerBlockReason(req.user.id),
    maxLoanDays: config.MAX_LOAN_DAYS, maxStartAheadDays: config.MAX_START_AHEAD_DAYS, today: today(),
  });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = getLoanRow(req.params.id);
  if (!row || (req.user.role !== 'admin' && ![row.borrower_id, row.owner_id].includes(req.user.id))) fail(404, 'Booking not found.');
  const loan = serializeLoan(row, req.user);
  loan.events = db.prepare(`SELECT e.action, e.note, e.created_at AS createdAt, u.full_name AS actor
                            FROM loan_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.loan_id = ? ORDER BY e.id`).all(row.id);
  loan.proposals = db.prepare(`SELECT p.handover_time AS time, p.location, p.message, p.status, p.created_at AS createdAt,
                                      p.proposer_id AS proposerId, u.full_name AS proposer
                               FROM handover_proposals p JOIN users u ON u.id = p.proposer_id WHERE p.loan_id = ? ORDER BY p.id`).all(row.id);
  loan.transactions = db.prepare(`SELECT t.type, t.amount, t.method, t.card_last4 AS last4, t.reference, t.note, t.created_at AS createdAt, u.full_name AS party
                                  FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.loan_id = ? ORDER BY t.id`).all(row.id);
  if (row.status === 'completed') {
    loan.myReviews = db.prepare(`SELECT id, target_type AS targetType, rating, comment, created_at AS createdAt FROM reviews
                                 WHERE loan_id = ? AND reviewer_id = ? AND removed = 0`).all(row.id, req.user.id);
    loan.reviewWindowEnds = addDays(localDate(row.completed_at), config.REVIEW_EDIT_DAYS);
  }
  res.json({ loan });
});

/* ── Create: book + choose handover proposal ──────── */
router.post('/', requireStudent, (req, res) => {
  const body = req.body || {};
  const toolId    = Number(body.toolId);
  const startDate = String(body.startDate || '');
  const endDate   = String(body.endDate || '');
  const message   = cleanMultiline(body.message, 500);

  const tool = db.prepare(`SELECT t.*, u.status AS owner_status FROM tools t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`).get(toolId);
  if (!tool || tool.status === 'removed' || tool.owner_status !== 'active') fail(404, 'This listing is not available.');
  if (tool.status === 'maintenance') fail(409, 'This item is under maintenance and cannot be booked right now.');
  if (tool.owner_id === req.user.id) fail(400, 'You cannot book your own item.');

  const blocked = borrowerBlockReason(req.user.id);
  if (blocked) fail(409, blocked);
  const open = db.prepare(`SELECT COUNT(*) AS n FROM loans WHERE borrower_id = ? AND status IN ('awaiting_payment', 'pending')`).get(req.user.id).n;
  if (open >= config.MAX_PENDING_REQUESTS) fail(409, `You can have at most ${config.MAX_PENDING_REQUESTS} unconfirmed bookings at a time.`);
  if (db.prepare(`SELECT 1 FROM loans WHERE tool_id = ? AND borrower_id = ? AND status IN ('awaiting_payment', 'pending')`).get(toolId, req.user.id)) {
    fail(409, 'You already have an unconfirmed booking for this item. Check My Bookings.');
  }

  const errors = {};
  const maxDays = Math.min(tool.max_days, config.MAX_LOAN_DAYS);
  if (!isDateStr(startDate)) errors.startDate = 'Choose a pick-up date.';
  else if (startDate < today()) errors.startDate = 'Pick-up date cannot be in the past.';
  else if (startDate > addDays(today(), config.MAX_START_AHEAD_DAYS)) errors.startDate = `Pick-up must be within ${config.MAX_START_AHEAD_DAYS} days.`;
  if (!isDateStr(endDate)) errors.endDate = 'Choose a return date.';
  else if (isDateStr(startDate)) {
    const days = daysBetween(startDate, endDate);
    if (days < 1) errors.endDate = 'Return date must be after the pick-up date.';
    else if (days > maxDays) errors.endDate = `The lender allows at most ${maxDays} day${maxDays === 1 ? '' : 's'} for this item.`;
  }
  if (message.length < 5) errors.message = 'Tell the lender briefly what you need it for.';
  const handover = isDateStr(startDate) ? readHandover(body, startDate, endDate, errors) : null;
  if (Object.keys(errors).length) fail(400, 'Please fix the highlighted fields.', errors);

  const conflict = findConflict(toolId, startDate, endDate);
  if (conflict) fail(409, `These dates overlap another confirmed booking (${conflict.start_date} → ${conflict.end_date}). Choose different dates.`, { startDate: 'Dates unavailable.' });

  const days = daysBetween(startDate, endDate);
  const loanId = transaction(() => {
    const id = Number(db.prepare(`INSERT INTO loans (tool_id, borrower_id, owner_id, start_date, end_date, days, daily_rate, rental_total, deposit, message,
                                  handover_time, handover_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(toolId, req.user.id, tool.owner_id, startDate, endDate, days, tool.daily_rate, tool.daily_rate * days, tool.deposit, message, handover.time, handover.location)
      .lastInsertRowid);
    db.prepare('INSERT INTO handover_proposals (loan_id, proposer_id, handover_time, location) VALUES (?, ?, ?, ?)').run(id, req.user.id, handover.time, handover.location);
    logEvent(id, req.user.id, 'requested');
    return id;
  });
  res.status(201).json({ message: 'Booking created. Complete the payment to send it to the lender.', loan: serializeLoan(getLoanRow(loanId), req.user) });
});

/* ── Simulated payment gateway ────────────────────── */
const TEST_CARDS = { '4242424242424242': 'success', '5555555555554444': 'success', '4000000000000002': 'declined' };
const FPX_BANKS = ['CampusBank', 'Unity Bank', 'Harbour Bank', 'Metro Savings', 'Highland Bank'];
const luhn = num => num.split('').reverse().reduce((sum, d, i) => {
  let n = Number(d);
  if (i % 2) { n *= 2; if (n > 9) n -= 9; }
  return sum + n;
}, 0) % 10 === 0;

router.get('/payment/options', requireStudent, (req, res) => {
  res.json({ banks: FPX_BANKS, testCards: TEST_CARDS, windowMinutes: config.PAYMENT_WINDOW_MINUTES });
});

router.post('/:id/pay', requireStudent, (req, res) => {
  const { row } = loadForAction(req, ['borrower'], ['awaiting_payment']);
  const method = req.body?.method === 'fpx' ? 'fpx' : 'card';
  let last4 = null;

  if (method === 'card') {
    const number = String(req.body?.card?.number || '').replace(/\D/g, '');
    const expiry = String(req.body?.card?.expiry || '');
    const cvc    = String(req.body?.card?.cvc || '');
    const name   = cleanText(req.body?.card?.name, 60);
    const errors = {};
    if (name.length < 2) errors.cardName = 'Enter the name on the card.';
    if (number.length < 13 || !luhn(number)) errors.cardNumber = 'Card number is not valid.';
    else if (!TEST_CARDS[number]) errors.cardNumber = 'This is a simulated gateway: use one of the test card numbers shown.';
    const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || new Date(2000 + Number(m[2]), Number(m[1])) <= new Date()) errors.cardExpiry = 'Enter a future expiry date (MM/YY).';
    if (!/^\d{3,4}$/.test(cvc)) errors.cardCvc = 'Enter the 3-digit security code.';
    if (Object.keys(errors).length) fail(400, 'Please check your card details.', errors);
    if (TEST_CARDS[number] === 'declined') {
      logEvent(row.id, req.user.id, 'payment_failed', 'Card declined');
      fail(402, 'Payment declined by the card issuer. Try another card or online banking.');
    }
    last4 = number.slice(-4);
  } else if (!FPX_BANKS.includes(req.body?.bank)) {
    fail(400, 'Choose your bank.', { bank: 'Choose your bank.' });
  }

  const total = row.rental_total + row.deposit;
  const reference = transaction(() => {
    const txRef = addTransaction(row.id, row.borrower_id, 'payment', total, 'PAY', { method, last4, note: method === 'fpx' ? req.body.bank : null });
    setLoan(row.id, { status: 'pending', awaiting: 'lender', paid_at: 'NOW' });
    logEvent(row.id, req.user.id, 'paid', `${rm(total)} held in escrow`);
    notify(row.owner_id, 'New booking request', `${req.user.full_name} booked your ${row.tool_name} for ${row.start_date} → ${row.end_date} and paid ${rm(total)} into escrow.`, 'fa-inbox', 'requests.html');
    return txRef;
  });
  respond(res, req, row.id, `Payment successful. ${rm(total)} is held safely in escrow until the handover.`, { reference });
});

/* ── Lender / borrower negotiation ────────────────── */
router.post('/:id/accept', requireStudent, (req, res) => {
  const { row, role } = loadForAction(req, ['borrower', 'lender'], ['pending']);
  if (row.awaiting !== role) fail(409, 'Waiting for the other party to respond.');
  if (row.tool_status !== 'available') fail(409, 'This item is not available (under maintenance or removed).');
  const conflict = findConflict(row.tool_id, row.start_date, row.end_date, row.id);
  if (conflict) fail(409, 'Another booking for overlapping dates was already confirmed. Decline this one instead.');
  if (borrowerBlockReason(row.borrower_id)) fail(409, `${row.borrower_name} cannot take on another booking right now (limit reached or an overdue item).`);

  const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const note = cleanText(req.body?.note, 300) || row.owner_note;
  transaction(() => {
    setLoan(row.id, { status: 'confirmed', confirmed_at: 'NOW', pin, pin_attempts: 0, owner_note: note || null });
    db.prepare("UPDATE handover_proposals SET status = 'accepted' WHERE loan_id = ? AND status = 'open'").run(row.id);
    logEvent(row.id, req.user.id, 'confirmed', `Handover ${row.handover_time} at ${row.handover_location}`);

    // Overlapping unconfirmed requests for the same item are declined and refunded.
    const overlapping = db.prepare(`SELECT * FROM loans WHERE tool_id = ? AND id != ? AND status IN ('awaiting_payment', 'pending')
                                    AND start_date < ? AND end_date > ?`).all(row.tool_id, row.id, row.end_date, row.start_date);
    for (const other of overlapping) {
      closeWithRefund(other, 'declined', row.owner_id, 'Dates taken by another confirmed booking', refundText =>
        notify(other.borrower_id, 'Booking declined', `Your booking for ${row.tool_name} was declined because those dates were confirmed for someone else.${refundText}`, 'fa-circle-xmark', 'my-loans.html'));
    }
  });
  const when = `${row.handover_time} at ${row.handover_location}`;
  notify(row.borrower_id, 'Booking confirmed – your handover PIN is ready', `Meet ${row.owner_name} on ${when}. Show your 4-digit PIN from My Bookings only when you receive the item.`, 'fa-key', 'my-loans.html');
  notify(row.owner_id, 'Booking confirmed', `Meet ${row.borrower_name} on ${when}. Ask for their 4-digit PIN at the handover.`, 'fa-handshake', 'requests.html');
  respond(res, req, row.id, 'Booking confirmed. A handover PIN has been issued to the borrower.');
});

router.post('/:id/counter', requireStudent, (req, res) => {
  const { row, role } = loadForAction(req, ['borrower', 'lender'], ['pending']);
  if (row.awaiting !== role) fail(409, 'Waiting for the other party to respond.');
  const errors = {};
  const handover = readHandover(req.body || {}, row.start_date, row.end_date, errors);
  const message = cleanText(req.body?.message, 300);
  if (Object.keys(errors).length) fail(400, 'Please fix the highlighted fields.', errors);
  if (handover.time === row.handover_time && handover.location === row.handover_location) fail(400, 'Change the time or the place to make a counter-offer.');

  const other = role === 'lender' ? 'borrower' : 'lender';
  transaction(() => {
    db.prepare("UPDATE handover_proposals SET status = 'superseded' WHERE loan_id = ? AND status = 'open'").run(row.id);
    db.prepare('INSERT INTO handover_proposals (loan_id, proposer_id, handover_time, location, message) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, req.user.id, handover.time, handover.location, message || null);
    setLoan(row.id, { awaiting: other, handover_time: handover.time, handover_location: handover.location });
    logEvent(row.id, req.user.id, 'counter_offer', `${handover.time} at ${handover.location}${message ? ' – ' + message : ''}`);
  });
  notify(other === 'lender' ? row.owner_id : row.borrower_id, 'New handover proposal',
    `${req.user.full_name} proposed ${handover.time} at ${handover.location} for ${row.tool_name}. Accept, counter or decline.`, 'fa-arrows-rotate',
    other === 'lender' ? 'requests.html' : 'my-loans.html');
  respond(res, req, row.id, 'Counter-offer sent.');
});

router.post('/:id/decline', requireStudent, (req, res) => {
  const { row, role } = loadForAction(req, ['borrower', 'lender'], ['pending']);
  if (role === 'borrower' && row.awaiting !== 'borrower') fail(409, 'You can cancel this booking instead.');
  const note = cleanText(req.body?.note, 300);
  const reason = role === 'lender' ? `Declined by lender${note ? ': ' + note : ''}` : `Borrower declined the counter-offer${note ? ': ' + note : ''}`;
  transaction(() => closeWithRefund(row, 'declined', req.user.id, reason, refundText => {
    const target = role === 'lender' ? row.borrower_id : row.owner_id;
    notify(target, 'Booking declined', `${req.user.full_name} declined the booking for ${row.tool_name}.${note ? ' Note: ' + note : ''}${refundText}`, 'fa-circle-xmark', role === 'lender' ? 'my-loans.html' : 'requests.html');
  }));
  respond(res, req, row.id, 'Booking declined. Any payment has been fully refunded.');
});

router.post('/:id/cancel', requireStudent, (req, res) => {
  const { row, role } = loadForAction(req, ['borrower', 'lender'], ['awaiting_payment', 'pending', 'confirmed']);
  const note = cleanText(req.body?.reason, 300);
  const reason = `Cancelled by ${role}${note ? ': ' + note : ''}`;
  transaction(() => closeWithRefund(row, 'cancelled', req.user.id, reason, refundText => {
    const target = role === 'lender' ? row.borrower_id : row.owner_id;
    if (row.status !== 'awaiting_payment') {
      notify(target, 'Booking cancelled', `${req.user.full_name} cancelled the booking for ${row.tool_name}.${note ? ' Reason: ' + note : ''}${refundText}`, 'fa-ban', role === 'lender' ? 'my-loans.html' : 'requests.html');
    }
  }));
  respond(res, req, row.id, row.paid_at ? 'Booking cancelled. The payment has been fully refunded.' : 'Booking cancelled.');
});

/* ── Handover PIN ─────────────────────────────────── */
router.post('/:id/verify-pin', requireStudent, (req, res) => {
  const { row } = loadForAction(req, ['lender'], ['confirmed']);
  if (row.pin_locked_until > now()) {
    const minutes = Math.ceil((row.pin_locked_until - now()) / 60000);
    fail(423, `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
  if (today() < addDays(row.start_date, -1)) fail(409, 'The handover is not due yet. You can verify the PIN from the day before the pick-up date.');
  if (today() >= row.end_date) fail(409, 'The rental period has already ended. Cancel this booking so the borrower is refunded.');

  const pin = String(req.body?.pin || '');
  const ok = /^\d{4}$/.test(pin) && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(row.pin));
  if (!ok) {
    const attempts = row.pin_attempts + 1;
    if (attempts >= config.PIN_MAX_ATTEMPTS) {
      setLoan(row.id, { pin_attempts: 0, pin_locked_until: now() + config.PIN_LOCK_MINUTES * 60000 });
      logEvent(row.id, req.user.id, 'pin_locked');
      notify(row.borrower_id, 'Handover PIN locked', `Several wrong PINs were entered for ${row.tool_name}. PIN entry is locked for ${config.PIN_LOCK_MINUTES} minutes.`, 'fa-lock', 'my-loans.html');
      fail(423, `Wrong PIN. PIN entry is locked for ${config.PIN_LOCK_MINUTES} minutes.`);
    }
    setLoan(row.id, { pin_attempts: attempts });
    fail(400, `Wrong PIN. ${config.PIN_MAX_ATTEMPTS - attempts} attempt${config.PIN_MAX_ATTEMPTS - attempts === 1 ? '' : 's'} left.`, { pin: 'Wrong PIN.' });
  }

  transaction(() => {
    setLoan(row.id, { status: 'active', handed_over_at: 'NOW', pin_attempts: 0 });
    addTransaction(row.id, row.owner_id, 'release_fee', row.rental_total, 'REL', { note: 'Rental fee released after PIN verification' });
    logEvent(row.id, req.user.id, 'handed_over', `PIN verified · ${rm(row.rental_total)} released to lender`);
  });
  notify(row.borrower_id, 'Handover verified', `You now have ${row.tool_name}. Return it by ${row.end_date}. Your ${rm(row.deposit)} deposit stays in escrow until the return is inspected.`, 'fa-hand-holding', 'my-loans.html');
  notify(row.owner_id, 'Rental fee released', `${rm(row.rental_total)} for ${row.tool_name} has been released to you.`, 'fa-money-bill-wave', 'requests.html');
  respond(res, req, row.id, `PIN verified – handover complete. ${rm(row.rental_total)} has been released to you.`);
});

/* ── Return & inspection ──────────────────────────── */
router.post('/:id/return', requireStudent, handle(async (req, res) => {
  const { row } = loadForAction(req, ['borrower'], ['active']);
  if (!req.body?.photo) fail(400, 'Upload a photo showing the condition of the item.', { photo: 'A condition photo is required.' });
  const note  = cleanMultiline(req.body?.note, 300) || null;
  const photo = saveImage(req.body.photo, 'returns');
  setLoan(row.id, { status: 'return_pending', returned_at: 'NOW', return_photo: photo, return_note: note });
  logEvent(row.id, req.user.id, 'return_submitted', note);
  notify(row.owner_id, 'Item returned – please inspect', `${req.user.full_name} returned ${row.tool_name}. Inspect it and confirm, or report a problem within ${config.AUTO_COMPLETE_INSPECTION_DAYS} days.`, 'fa-rotate-left', 'requests.html');
  respond(res, req, row.id, 'Return confirmed on your side. The lender will inspect the item and release your deposit.');
}));

router.post('/:id/inspect', requireStudent, (req, res) => {
  const { row } = loadForAction(req, ['lender'], ['return_pending']);
  const note = cleanText(req.body?.note, 300) || null;
  const result = transaction(() => {
    if (note) setLoan(row.id, { owner_note: note });
    logEvent(row.id, req.user.id, 'inspected', note || 'No issues found');
    return completeLoan(getLoanRow(row.id), { actorId: req.user.id });
  });
  notify(row.borrower_id, 'Return confirmed – deposit refunded', `${req.user.full_name} confirmed ${row.tool_name} is fine. ${rm(result.refund)} deposit has been refunded. You can now rate this booking.`, 'fa-circle-check', 'history.html');
  respond(res, req, row.id, 'Return confirmed. The deposit has been refunded and the booking is complete.');
});

/* ── Admin: void a meetup that did not take place ─── */
router.post('/:id/void', requireAdmin, (req, res) => {
  const row = getLoanRow(req.params.id);
  if (!row) fail(404, 'Booking not found.');
  if (!['confirmed', 'pending'].includes(row.status)) fail(409, 'Only bookings that have not been handed over can be voided.');
  const reason = cleanText(req.body?.reason, 300);
  if (reason.length < 5) fail(400, 'Give a reason for voiding this handover.', { reason: 'Enter a reason.' });
  transaction(() => closeWithRefund(row, 'voided', req.user.id, `Voided by admin: ${reason}`, refundText => {
    for (const id of [row.borrower_id, row.owner_id]) notify(id, 'Handover voided', `The handover for ${row.tool_name} was voided by an admin. Reason: ${reason}.${refundText}`, 'fa-ban', 'history.html');
  }));
  res.json({ message: 'Handover voided and the borrower fully refunded. The record stays in the transaction history.' });
});

/* ── In-web chat ──────────────────────────────────── */
function chatLoan(req) {
  const row = db.prepare('SELECT id, borrower_id, owner_id, status FROM loans WHERE id = ?').get(Number(req.params.id));
  if (!row || (req.user.role !== 'admin' && ![row.borrower_id, row.owner_id].includes(req.user.id))) fail(404, 'Booking not found.');
  return row;
}

router.get('/:id/messages', requireAuth, (req, res) => {
  const row = chatLoan(req);
  const after = Number(req.query.after) || 0;
  const messages = db.prepare(`SELECT m.id, m.body, m.created_at AS createdAt, m.sender_id AS senderId, u.full_name AS sender, u.avatar_path AS avatar
                               FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.loan_id = ? AND m.id > ? ORDER BY m.id LIMIT 200`).all(row.id, after)
    .map(m => ({ ...m, avatar: imageUrl(m.avatar), mine: m.senderId === req.user.id }));
  if (req.user.role !== 'admin') db.prepare("UPDATE messages SET read_at = datetime('now') WHERE loan_id = ? AND sender_id != ? AND read_at IS NULL").run(row.id, req.user.id);
  res.json({ messages, canSend: req.user.role !== 'admin' && !FINAL.includes(row.status) });
});

router.post('/:id/messages', requireStudent, (req, res) => {
  const row = chatLoan(req);
  if (FINAL.includes(row.status)) fail(409, 'This booking is closed. The chat is read-only.');
  const body = cleanMultiline(req.body?.body, 1000);
  if (!body) fail(400, 'Type a message first.');
  const id = Number(db.prepare('INSERT INTO messages (loan_id, sender_id, body) VALUES (?, ?, ?)').run(row.id, req.user.id, body).lastInsertRowid);
  // Notify at most once per conversation until the other person opens it.
  const other = req.user.id === row.borrower_id ? row.owner_id : row.borrower_id;
  const unreadBefore = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE loan_id = ? AND sender_id = ? AND read_at IS NULL AND id != ?').get(row.id, req.user.id, id).n;
  if (!unreadBefore) notify(other, 'New message', `${req.user.full_name}: ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`, 'fa-comments', other === row.owner_id ? 'requests.html' : 'my-loans.html');
  res.status(201).json({ id });
});

/* ── Background jobs ──────────────────────────────── */
function runJobs() {
  // Unpaid bookings expire.
  const cutoff = new Date(Date.now() - config.PAYMENT_WINDOW_MINUTES * 60000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`${LOAN_SELECT} WHERE l.status = 'awaiting_payment' AND l.created_at < ?`).all(cutoff).forEach(row => {
    setLoan(row.id, { status: 'cancelled', cancel_reason: 'Payment not completed in time' });
    logEvent(row.id, null, 'cancelled', 'Payment window expired');
  });

  // Confirmed meetups that never happened are voided and refunded.
  db.prepare(`${LOAN_SELECT} WHERE l.status = 'confirmed' AND l.start_date < ?`).all(addDays(today(), -config.AUTO_VOID_AFTER_DAYS)).forEach(row => {
    transaction(() => closeWithRefund(row, 'voided', null, 'Handover did not take place', refundText => {
      for (const id of [row.borrower_id, row.owner_id]) notify(id, 'Handover voided automatically', `No handover was recorded for ${row.tool_name} by ${addDays(row.start_date, config.AUTO_VOID_AFTER_DAYS)}.${refundText}`, 'fa-ban', 'history.html');
    }));
  });

  // Returns the lender never inspected are completed (deposit back to borrower).
  const inspectCutoff = new Date(Date.now() - config.AUTO_COMPLETE_INSPECTION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`${LOAN_SELECT} WHERE l.status = 'return_pending' AND l.returned_at < ?`).all(inspectCutoff).forEach(row => {
    const result = transaction(() => completeLoan(row));
    notify(row.borrower_id, 'Deposit refunded', `The lender did not report any problem with ${row.tool_name}. ${rm(result.refund)} has been refunded.`, 'fa-circle-check', 'history.html');
    notify(row.owner_id, 'Booking completed automatically', `${row.tool_name} was not inspected within ${config.AUTO_COMPLETE_INSPECTION_DAYS} days, so the deposit was refunded to the borrower.`, 'fa-circle-info', 'history.html');
  });

  // Due-date reminders (once each).
  const remindOnce = (row, action, title, body, icon) => {
    if (db.prepare('SELECT 1 FROM loan_events WHERE loan_id = ? AND action = ?').get(row.id, action)) return;
    logEvent(row.id, null, action);
    notify(row.borrower_id, title, body, icon, 'my-loans.html');
  };
  db.prepare(`${LOAN_SELECT} WHERE l.status = 'active' AND l.end_date <= ?`).all(addDays(today(), 1)).forEach(row => {
    if (row.end_date < today()) {
      remindOnce(row, 'reminder_overdue', 'Item overdue', `${row.tool_name} was due on ${row.end_date}. Return it to ${row.owner_name} now – late returns cost ${config.TRUST_PENALTY.late_return} Trust Points.`, 'fa-triangle-exclamation');
    } else {
      remindOnce(row, 'reminder_due', 'Return reminder', `${row.tool_name} is due on ${row.end_date}.`, 'fa-clock');
    }
  });
}

module.exports = { router, serializeLoan, LOAN_SELECT, getLoanRow, completeLoan, runJobs, borrowerBlockReason, loanRef, setLoan };
