# Campus Hardware Lending System

A peer-to-peer platform where students rent out the hardware and tools they own to other
students. Payments go into escrow, the handover is verified face to face with a 4-digit PIN,
disputes are settled by admins from the held deposit, and every student has Trust Points
that rise and fall with their behaviour.

## Running it

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`).

```bash
npm install
npm run dev        # http://localhost:3000
```

The database (`data/campus.db`) and uploaded photos (`uploads/`) are created on first run.
Delete both folders to start again with fresh demo data.

```bash
npm test           # API tests on a temporary database (escrow flow, auth, paging, demo mode)
```

### Settings (environment variables)

| Variable | Purpose |
|----------|---------|
| `DEMO_MODE=true` | Public demo: shows a "data resets" notice and one-click demo sign-in buttons |
| `ADMIN_SECRET_CODE` | Secret code required to register an admin account |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Email password-reset codes. Without `SMTP_HOST`, production hides "Forgot password?"; locally the code is shown on screen |
| `DATA_DIR`, `UPLOAD_DIR` | Where the database and photos are stored |

### Deploying on Render

`render.yaml` uses the **free plan**, which has no persistent disk: the database and photos
reset to the demo data whenever the service restarts or wakes from sleep. `DEMO_MODE` is on so
users are told this. For permanent data, switch to a paid plan and mount a disk at `DATA_DIR`
and `UPLOAD_DIR`.

### Demo accounts

| Role    | Email                        | Password         | Notes |
|---------|------------------------------|------------------|-------|
| Admin   | `admin@admin.com`            | `Admin#Lab2026`  | |
| Student | `ahmad@student.tarc.edu.my`  | `Borrow#Tools26` | Has a paid booking waiting for Sara |
| Student | `sara@student.tarc.edu.my`   | `Lend#Gadget26`  | Lender of that booking |
| Student | `daniel@student.tarc.edu.my` | `Probe#Scope26`  | 45 Trust Points (flagged) with an open dispute |

**Admin registration secret code:** `CHH-ADMIN-2026` (change it with the `ADMIN_SECRET_CODE`
environment variable). **Test payment cards:** `4242 4242 4242 4242` (success),
`4000 0000 0000 0002` (declined) – any future expiry and any 3-digit CVC.

## The six modules

| # | Module | Where | Create / Read / Update / Delete + unique feature |
|---|--------|-------|-----------------------------------------------|
| 1 | User Authentication & Profile | `register.html`, `profile.html`, admin **Manage Users** | Register students (university email enforced) or admins (server-checked secret code, 5 tries then 15-min lock) · view profile, role, active bookings, Trust Points & history · update profile, phone, WhatsApp, password · deactivate own account when nothing is in progress · **accounts below 50 Trust Points are auto-flagged; admin suspends or clears** |
| 2 | Hardware Inventory & Listing | **My Listings**, **Browse Hardware** | Add listings with up to 5 photos, category, specs, condition, daily rate, deposit · search/filter by category, price, availability, condition · edit details/photos/price, mark *Available* or *Under Maintenance* (*On Loan* is automatic) · remove with a reason · **per-item rate and deposit** |
| 3 | Booking & Online Payment | tool details → **Checkout**, **My Bookings**, **Lending Requests** | Choose dates, propose handover time & place, see the total, pay rental + deposit (simulated gateway) · view status, receipt, handover details · lender accepts or counter-proposes · either side cancels before handover (full refund, kept in history) · **escrow, structured counter-offers with automatic refund on decline, in-booking chat** |
| 4 | Handover Verification & Status Tracking | booking cards | 4-digit PIN issued to the borrower when the booking is confirmed · stage tracker (Payment completed → Handed over → Returned, pending inspection → Completed) · lender enters the PIN at pickup; after the return the lender inspects and the deposit is refunded · admin/system voids meetups that never happened · **PIN releases the rental fee; deposit held until the return or dispute is settled** |
| 5 | Dispute & Damage Management | **Disputes** | Lender files a damage / lost / not-returned claim with photos · both sides add statements and evidence; full decision history · admin decides the deposit deduction; confirmed violations deduct Trust Points automatically · dismiss invalid claims or close settled ones · **deposit-based settlement + automatic penalties** |
| 6 | Rating, Review & Feedback | **History & Reviews**, profiles, tool details | 1–5★ + comment for the other person (and the item, for borrowers) once per booking · averages and comments on listings and profiles · edit within 7 days (bonus recalculated); admins hide abusive comments (rating kept) · admins remove fake reviews (excluded from average, bonus reversed) · **5★ +3, 4★ +1 Trust Points; ≤2★ triggers a reputation warning** |

## How a booking flows

```
Borrower books & pays ──► escrow holds rental + deposit
Lender accepts the handover (or counter-offers; decline = full refund)
        ──► booking confirmed, borrower receives a 4-digit PIN
Meet face to face: lender types the borrower's PIN
        ──► loan starts, rental fee released to the lender
Borrower returns the item + condition photo
Lender inspects ──► all good: deposit refunded, +2 Trust Points if on time
               └──► problem: dispute → admin decides deduction and penalty
```

Background jobs (every 5 minutes): unpaid bookings expire after 30 minutes; confirmed bookings
with no handover 2 days after the start date are voided and refunded; returns not inspected
within 3 days are completed with the deposit refunded; due-date and overdue reminders.

All rule numbers (Trust Points, limits, time windows) live in **`server/config.js`**.

## Security

- Passwords hashed with bcrypt; strength rules shared by browser and server (`js/password-rules.js`).
- HttpOnly, SameSite session cookies; 5 failed logins lock an account for 15 minutes.
- Every page and API route checks the session and role on the server; JSON-only API (CSRF defence).
- Handover PIN compared in constant time, 5 wrong tries lock PIN entry for 15 minutes.
- Images resized in the browser, verified by file signature on the server, served only to signed-in users.
- The payment gateway is a **simulation**: only published test cards are accepted, and card numbers are never stored (only the last 4 digits).

## Project structure

```
server.js               Express app: pages, API mounting, background jobs
server/config.js        All business rules (Trust Points, limits, windows, admin code)
server/db.js            SQLite schema and demo data
server/helpers.js       Sessions, guards, notifications, Trust Points, escrow ledger, uploads
server/routes/          auth · tools · loans · disputes · reviews · account · admin
js/app.js               App shell + shared UI (modals, uploads, chat, receipts, profiles)
js/tools-ui.js          Listing cards and the booking form
js/loans-ui.js          Booking cards and every workflow action
js/pages/*.js           One script per page
css/                    style.css (auth + theme) · dashboard.css (layout) · app.css (components)
```
