/* ============================================================
   Database: schema and demo seed data
   ============================================================ */

const path   = require('node:path');
const fs     = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE  = path.join(DATA_DIR, 'campus.db');
const SCHEMA_VERSION = 2;
const BCRYPT_ROUNDS = 12;

fs.mkdirSync(DATA_DIR, { recursive: true });

// A database from the first prototype has a different structure; keep it as a
// backup and start fresh rather than attempting a risky migration.
if (fs.existsSync(DB_FILE)) {
  const probe = new DatabaseSync(DB_FILE);
  const version = probe.prepare('PRAGMA user_version').get().user_version;
  const hasUsers = probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  probe.close();
  if (hasUsers && version < SCHEMA_VERSION) {
    const backup = path.join(DATA_DIR, `campus.v${version || 1}.backup.db`);
    fs.renameSync(DB_FILE, backup);
    for (const ext of ['-wal', '-shm']) fs.rmSync(DB_FILE + ext, { force: true });
    console.log(`Old database moved to ${path.relative(process.cwd(), backup)}; created a new one.`);
  }
}

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  /* ── Module 1: users & Trust Points ── */
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role          TEXT NOT NULL DEFAULT 'student',        -- student | admin
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    whatsapp      TEXT,
    campus_id     TEXT UNIQUE,
    department    TEXT,
    password_hash TEXT NOT NULL,
    avatar_path   TEXT,
    status        TEXT NOT NULL DEFAULT 'active',         -- active | suspended | deactivated
    trust_points  INTEGER NOT NULL DEFAULT ${config.TRUST_START},
    flagged       INTEGER NOT NULL DEFAULT 0,
    flagged_at    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS trust_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta      INTEGER NOT NULL,
    balance    INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    ref_type   TEXT,
    ref_id     INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    email TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0, last_failed_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS admin_code_attempts (
    key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0, last_failed_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
  );

  /* ── Module 2: listings ── */
  CREATE TABLE IF NOT EXISTS tools (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    category       TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    specs          TEXT NOT NULL DEFAULT '',
    condition      TEXT NOT NULL DEFAULT 'good',
    location       TEXT NOT NULL DEFAULT '',
    max_days       INTEGER NOT NULL DEFAULT 7,
    daily_rate     INTEGER NOT NULL DEFAULT 0,             -- sen (RM × 100)
    deposit        INTEGER NOT NULL DEFAULT 0,             -- sen
    status         TEXT NOT NULL DEFAULT 'available',      -- available | maintenance | removed
    removed_reason TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tool_photos (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id  INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    path     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  /* ── Modules 3 & 4: bookings, payment, handover ──
     awaiting_payment → pending (paid, negotiating handover) → confirmed (PIN issued)
       → active (PIN verified) → return_pending → completed
     ↘ cancelled / declined / voided (full refund)     ↘ disputed → completed            */
  CREATE TABLE IF NOT EXISTS loans (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id           INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    borrower_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date        TEXT NOT NULL,
    end_date          TEXT NOT NULL,                       -- due date
    days              INTEGER NOT NULL,
    daily_rate        INTEGER NOT NULL,
    rental_total      INTEGER NOT NULL,
    deposit           INTEGER NOT NULL,
    message           TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'awaiting_payment',
    awaiting          TEXT NOT NULL DEFAULT 'lender',      -- who must respond to the handover proposal
    handover_time     TEXT,
    handover_location TEXT,
    pin               TEXT,
    pin_attempts      INTEGER NOT NULL DEFAULT 0,
    pin_locked_until  INTEGER NOT NULL DEFAULT 0,
    owner_note        TEXT,
    paid_at           TEXT,
    confirmed_at      TEXT,
    handed_over_at    TEXT,
    returned_at       TEXT,
    return_photo      TEXT,
    return_note       TEXT,
    inspected_at      TEXT,
    completed_at      TEXT,
    cancelled_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    cancel_reason     TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS handover_proposals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id       INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    proposer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    handover_time TEXT NOT NULL,
    location      TEXT NOT NULL,
    message       TEXT,
    status        TEXT NOT NULL DEFAULT 'open',            -- open | accepted | declined | superseded
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Escrow ledger. payment = money in from the borrower; everything else = money out.
  CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id    INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,                              -- payment | release_fee | refund | deposit_deduction
    amount     INTEGER NOT NULL,                           -- sen
    method     TEXT,                                       -- card | fpx (payments only)
    card_last4 TEXT,
    reference  TEXT NOT NULL,
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id    INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    read_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* ── Module 5: disputes ── */
  CREATE TABLE IF NOT EXISTS disputes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id        INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    filed_by       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    against_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type           TEXT NOT NULL,                          -- damage | lost | not_returned
    description    TEXT NOT NULL,
    claim_amount   INTEGER NOT NULL DEFAULT 0,             -- sen requested from the deposit
    status         TEXT NOT NULL DEFAULT 'open',           -- open | resolved | dismissed | settled
    deduction      INTEGER,
    violation      INTEGER NOT NULL DEFAULT 0,
    penalty_points INTEGER NOT NULL DEFAULT 0,
    admin_note     TEXT,
    decided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS dispute_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS dispute_statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS dispute_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dispute_id INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  /* ── Module 6: reviews ── */
  CREATE TABLE IF NOT EXISTS reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id        INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    reviewer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type    TEXT NOT NULL,                          -- user | tool
    target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tool_id        INTEGER REFERENCES tools(id) ON DELETE CASCADE,
    rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT NOT NULL DEFAULT '',
    comment_hidden INTEGER NOT NULL DEFAULT 0,
    removed        INTEGER NOT NULL DEFAULT 0,
    removed_reason TEXT,
    bonus_points   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (loan_id, reviewer_id, target_type)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, body TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'fa-bell', link TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tools_owner    ON tools(owner_id);
  CREATE INDEX IF NOT EXISTS idx_photos_tool    ON tool_photos(tool_id, position);
  CREATE INDEX IF NOT EXISTS idx_loans_tool     ON loans(tool_id, status);
  CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_id, status);
  CREATE INDEX IF NOT EXISTS idx_loans_owner    ON loans(owner_id, status);
  CREATE INDEX IF NOT EXISTS idx_tx_loan        ON transactions(loan_id);
  CREATE INDEX IF NOT EXISTS idx_messages_loan  ON messages(loan_id, id);
  CREATE INDEX IF NOT EXISTS idx_disputes_loan  ON disputes(loan_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_user   ON reviews(target_user_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_tool   ON reviews(tool_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id, is_read);
  PRAGMA user_version = ${SCHEMA_VERSION};
`);

/* ── Demo data (only on a brand-new database) ─────── */
const DEMO_USERS = [
  { key: 'admin',  role: 'admin',   fullName: 'System Admin',  email: 'admin@admin.com',            password: 'Admin#Lab2026',  campusId: 'ADMIN001',   department: 'admin' },
  { key: 'ahmad',  role: 'student', fullName: 'Ahmad Ridhwan', email: 'ahmad@student.tarc.edu.my',  password: 'Borrow#Tools26', campusId: '21WMR12345', department: 'electrical' },
  { key: 'sara',   role: 'student', fullName: 'Sara Wong',     email: 'sara@student.tarc.edu.my',   password: 'Lend#Gadget26',  campusId: '22WMR54321', department: 'cs' },
  { key: 'daniel', role: 'student', fullName: 'Daniel Tan',    email: 'daniel@student.tarc.edu.my', password: 'Probe#Scope26',  campusId: '23WMR77777', department: 'mechanical' },
];

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  const day = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA');
  const ts  = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const run = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);

  const u = {};
  for (const x of DEMO_USERS) {
    u[x.key] = run(`INSERT INTO users (role, full_name, email, phone, whatsapp, campus_id, department, password_hash, created_at)
                    VALUES (?, ?, ?, '011-12345678', '011-12345678', ?, ?, ?, ?)`,
      x.role, x.fullName, x.email, x.campusId, x.department, bcrypt.hashSync(x.password, BCRYPT_ROUNDS), ts(-40));
  }

  const tool = (owner, name, category, description, specs, condition, location, maxDays, rate, deposit, status = 'available') =>
    run(`INSERT INTO tools (owner_id, name, category, description, specs, condition, location, max_days, daily_rate, deposit, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      owner, name, category, description, specs, condition, location, maxDays, rate * 100, deposit * 100, status, ts(-30));
  const t = {
    multimeter: tool(u.sara, 'Digital Multimeter UT33D', 'electrical', 'Auto-ranging multimeter with test leads and carry pouch.', 'DC/AC voltage up to 600V\nResistance up to 20MΩ\nContinuity buzzer, diode test', 'good', 'Block D, Library foyer', 7, 3, 30),
    arduino:    tool(u.sara, 'Arduino Uno Starter Kit', 'computing', 'Arduino Uno R3 with breadboard, jumper wires, LEDs, resistors and sensors in a storage box.', 'ATmega328P, 14 digital I/O\n830-point breadboard\nUSB cable included', 'good', 'Block D, Library foyer', 14, 4, 50),
    caliper:    tool(u.sara, 'Digital Vernier Caliper', 'measuring', '150 mm stainless steel caliper. Battery included.', 'Range 0–150 mm\nResolution 0.01 mm', 'new', 'Block D, Library foyer', 5, 2, 40),
    drill:      tool(u.ahmad, 'Cordless Drill 12V', 'mechanical', 'Includes 2 batteries, charger and a basic drill bit set. Please return charged.', '12V Li-ion, 2 speeds\n10 mm keyless chuck', 'fair', 'Block A, Engineering Lab 2', 3, 8, 150),
    solder:     tool(u.ahmad, 'Soldering Station 60W', 'electrical', 'Temperature-controlled soldering iron with stand, sponge and spare tips.', '200–480 °C\nCeramic heater', 'good', 'Block A, Engineering Lab 2', 7, 5, 60),
    rpi:        tool(u.ahmad, 'Raspberry Pi 4 (4GB)', 'computing', 'Comes with case, 32GB microSD card (Raspberry Pi OS) and USB-C power supply.', '4GB RAM, quad-core 1.5GHz\nWi-Fi + Bluetooth', 'good', 'Block A, Engineering Lab 2', 14, 6, 120),
    scope:      tool(u.daniel, 'Handheld Oscilloscope', 'measuring', 'Portable 2-channel oscilloscope. Currently being recalibrated.', '2 channels, 50 MHz\n2.8" display', 'good', 'Block C, Mechatronics Lab', 5, 15, 300, 'maintenance'),
  };

  const event = (loanId, actor, action, note, at) => run('INSERT INTO loan_events (loan_id, actor_id, action, note, created_at) VALUES (?, ?, ?, ?, ?)', loanId, actor, action, note, at);
  const tx = (loanId, user, type, amount, ref, at, extra = {}) =>
    run('INSERT INTO transactions (loan_id, user_id, type, amount, method, card_last4, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      loanId, user, type, amount, extra.method || null, extra.last4 || null, ref, at);
  const trust = (user, delta, reason, refType, refId, at) => {
    const row = db.prepare('SELECT trust_points FROM users WHERE id = ?').get(user);
    const balance = row.trust_points + delta;
    db.prepare('UPDATE users SET trust_points = ? WHERE id = ?').run(balance, user);
    run('INSERT INTO trust_events (user_id, delta, balance, reason, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', user, delta, balance, reason, refType, refId, at);
  };

  // 1) Ahmad → Sara's multimeter: paid, waiting for Sara to accept the handover proposal.
  const b1 = run(`INSERT INTO loans (tool_id, borrower_id, owner_id, start_date, end_date, days, daily_rate, rental_total, deposit, message,
                  status, awaiting, handover_time, handover_location, paid_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 3, 300, 900, 3000, ?, 'pending', 'lender', ?, ?, ?, ?, ?)`,
    t.multimeter, u.ahmad, u.sara, day(1), day(4), 'Hi Sara, I need this for my circuits lab assignment this week. Thanks!',
    `${day(1)} 14:00`, 'Block D, Library foyer', ts(0), ts(0), ts(0));
  run('INSERT INTO handover_proposals (loan_id, proposer_id, handover_time, location, message) VALUES (?, ?, ?, ?, ?)',
    b1, u.ahmad, `${day(1)} 14:00`, 'Block D, Library foyer', 'Tomorrow after my 1pm class?');
  tx(b1, u.ahmad, 'payment', 3900, 'PAY-DEMO0001', ts(0), { method: 'card', last4: '4242' });
  event(b1, u.ahmad, 'requested', null, ts(0));
  event(b1, u.ahmad, 'paid', 'RM 39.00 held in escrow', ts(0));
  run(`INSERT INTO notifications (user_id, title, body, icon, link) VALUES (?, ?, ?, 'fa-inbox', 'requests.html')`,
    u.sara, 'New booking request', 'Ahmad Ridhwan booked your Digital Multimeter UT33D and paid RM 39.00 into escrow.');
  run('INSERT INTO messages (loan_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)', b1, u.ahmad, 'Hi! Is 2pm tomorrow okay for pickup?', ts(0));

  // 2) Sara borrowed Ahmad's soldering station – completed, both reviewed.
  const b2 = run(`INSERT INTO loans (tool_id, borrower_id, owner_id, start_date, end_date, days, daily_rate, rental_total, deposit, message,
                  status, awaiting, handover_time, handover_location, pin, paid_at, confirmed_at, handed_over_at, returned_at, inspected_at, completed_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 4, 500, 2000, 6000, ?, 'completed', 'lender', ?, ?, '7351', ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.solder, u.sara, u.ahmad, day(-12), day(-8), 'Need it for my robotics club build.', `${day(-12)} 10:00`, 'Block A, Engineering Lab 2',
    ts(-13), ts(-13), ts(-12), ts(-9), ts(-9), ts(-9), ts(-13), ts(-9));
  tx(b2, u.sara, 'payment', 8000, 'PAY-DEMO0002', ts(-13), { method: 'fpx' });
  tx(b2, u.ahmad, 'release_fee', 2000, 'REL-DEMO0002', ts(-12));
  tx(b2, u.sara, 'refund', 6000, 'RFD-DEMO0002', ts(-9));
  for (const [a, actor, at] of [['requested', u.sara, ts(-13)], ['paid', u.sara, ts(-13)], ['confirmed', u.ahmad, ts(-13)], ['handed_over', u.ahmad, ts(-12)], ['return_submitted', u.sara, ts(-9)], ['completed', u.ahmad, ts(-9)]]) event(b2, actor, a, null, at);
  trust(u.sara, config.TRUST_BONUS_ON_TIME, 'Returned on time', 'loan', b2, ts(-9));
  const r1 = run(`INSERT INTO reviews (loan_id, reviewer_id, target_type, target_user_id, rating, comment, bonus_points, created_at, updated_at)
                  VALUES (?, ?, 'user', ?, 5, ?, 3, ?, ?)`, b2, u.ahmad, u.sara, 'Returned it clean and on time. Great borrower!', ts(-8), ts(-8));
  trust(u.sara, 3, '5★ rating received', 'review', r1, ts(-8));
  const r2 = run(`INSERT INTO reviews (loan_id, reviewer_id, target_type, target_user_id, rating, comment, bonus_points, created_at, updated_at)
                  VALUES (?, ?, 'user', ?, 5, ?, 3, ?, ?)`, b2, u.sara, u.ahmad, 'Very responsive and the handover was quick.', ts(-8), ts(-8));
  trust(u.ahmad, 3, '5★ rating received', 'review', r2, ts(-8));
  run(`INSERT INTO reviews (loan_id, reviewer_id, target_type, tool_id, rating, comment, created_at, updated_at)
       VALUES (?, ?, 'tool', ?, 4, ?, ?, ?)`, b2, u.sara, t.solder, 'Heats up fast. One spare tip is a bit worn.', ts(-8), ts(-8));

  // 3) Daniel borrowed Ahmad's drill, returned it damaged → open dispute. Daniel has a poor record (flagged).
  trust(u.daniel, -config.TRUST_PENALTY.damage, 'Confirmed violation: damaged item', 'dispute', null, ts(-25));
  trust(u.daniel, -config.TRUST_PENALTY.lost, 'Confirmed violation: lost item', 'dispute', null, ts(-18));
  trust(u.daniel, config.TRUST_BONUS_ON_TIME, 'Returned on time', 'loan', null, ts(-15));
  trust(u.daniel, 3, '5★ rating received', 'review', null, ts(-15));
  db.prepare("UPDATE users SET flagged = 1, flagged_at = ? WHERE id = ?").run(ts(-18), u.daniel);

  const b3 = run(`INSERT INTO loans (tool_id, borrower_id, owner_id, start_date, end_date, days, daily_rate, rental_total, deposit, message,
                  status, awaiting, handover_time, handover_location, pin, paid_at, confirmed_at, handed_over_at, returned_at, return_note, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 3, 800, 2400, 15000, ?, 'disputed', 'lender', ?, ?, '2468', ?, ?, ?, ?, ?, ?, ?)`,
    t.drill, u.daniel, u.ahmad, day(-5), day(-2), 'For my final year project chassis.', `${day(-5)} 16:00`, 'Block A, Engineering Lab 2',
    ts(-6), ts(-6), ts(-5), ts(-2), 'Chuck got stuck once but it works.', ts(-6), ts(-1));
  tx(b3, u.daniel, 'payment', 17400, 'PAY-DEMO0003', ts(-6), { method: 'card', last4: '4242' });
  tx(b3, u.ahmad, 'release_fee', 2400, 'REL-DEMO0003', ts(-5));
  for (const [a, actor, at] of [['requested', u.daniel, ts(-6)], ['paid', u.daniel, ts(-6)], ['confirmed', u.ahmad, ts(-6)], ['handed_over', u.ahmad, ts(-5)], ['return_submitted', u.daniel, ts(-2)], ['disputed', u.ahmad, ts(-1)]]) event(b3, actor, a, null, at);
  const d1 = run(`INSERT INTO disputes (loan_id, filed_by, against_id, type, description, claim_amount, created_at)
                  VALUES (?, ?, ?, 'damage', ?, 6000, ?)`, b3, u.ahmad, u.daniel,
    'The keyless chuck no longer tightens and one battery does not charge. Repair quote from the hardware shop is RM 60.', ts(-1));
  run("INSERT INTO dispute_events (dispute_id, actor_id, action, created_at) VALUES (?, ?, 'filed', ?)", d1, u.ahmad, ts(-1));
  run('INSERT INTO dispute_statements (dispute_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', d1, u.daniel,
    'The chuck was already stiff when I got it. I only used it for two days on plywood.', ts(-1));
  run("INSERT INTO dispute_events (dispute_id, actor_id, action, created_at) VALUES (?, ?, 'statement', ?)", d1, u.daniel, ts(-1));
  run(`INSERT INTO notifications (user_id, title, body, icon, link) VALUES (?, ?, ?, 'fa-scale-balanced', 'disputes.html')`,
    u.admin, 'New dispute filed', 'Ahmad Ridhwan filed a damage claim on Cordless Drill 12V (borrowed by Daniel Tan).');
  run(`INSERT INTO notifications (user_id, title, body, icon, link) VALUES (?, ?, ?, 'fa-flag', 'manage-users.html?filter=flagged')`,
    u.admin, 'Account flagged', 'Daniel Tan dropped below 50 Trust Points and needs review.');

  console.log('Seeded demo accounts:');
  DEMO_USERS.forEach(x => console.log(`  ${x.role.padEnd(8)} ${x.email.padEnd(28)} ${x.password}`));
  console.log(`  Admin registration secret code: ${config.ADMIN_SECRET_CODE}`);
}
seed();

module.exports = { db, BCRYPT_ROUNDS };
