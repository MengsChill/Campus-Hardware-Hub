/* ============================================================
   Campus Hardware Lending System – Server
   Express + SQLite (node:sqlite) + bcrypt + HttpOnly sessions
   Run: npm run dev   →  http://localhost:3000
   ============================================================ */

const path    = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { db } = require('./server/db');
const { UPLOAD_DIR, HttpError, getSessionUser, now } = require('./server/helpers');
const auth    = require('./server/routes/auth');
const tools   = require('./server/routes/tools');
const loans   = require('./server/routes/loans');
const account = require('./server/routes/account');
const admin   = require('./server/routes/admin');
const disputes = require('./server/routes/disputes');
const reviews = require('./server/routes/reviews');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

/* ── API ──────────────────────────────────────────── */
// CSRF protection: state-changing API calls must be JSON, which a cross-site
// HTML form cannot send. Combined with SameSite=Lax cookies.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must be sent as JSON.' });
  }
  next();
});
app.use('/api', express.json({ limit: '8mb' }));   // room for one resized photo

app.use('/api/auth',  auth.router);
app.use('/api/tools', tools.router);
app.use('/api/loans', loans.router);
app.use('/api/me',    account.router);
app.use('/api/users', account.usersRouter);
app.use('/api/disputes', disputes.router);
app.use('/api/reviews', reviews.router);
app.use('/api/admin', admin.router);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Errors from route handlers → consistent JSON responses.
app.use('/api', (err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

/* ── Uploaded images (signed-in users only) ───────── */
app.use('/uploads', (req, res, next) => (getSessionUser(req) ? next() : res.status(401).end()),
  express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));

/* ── Pages ────────────────────────────────────────── */
const sendPage = name => (req, res) => res.sendFile(path.join(ROOT, name));

const STUDENT_PAGES = ['my-tools', 'requests', 'my-loans', 'history', 'checkout'];
const ADMIN_PAGES   = ['manage-tools', 'manage-users', 'bookings', 'reports'];
const SHARED_PAGES  = ['dashboard', 'catalog', 'disputes', 'notifications', 'profile'];

// Signed in → skip the auth pages.
const redirectIfSignedIn = (req, res, next) => (getSessionUser(req) ? res.redirect('/dashboard.html') : next());

// Pages behind the login; the Back button can't show them after logout.
const guardPage = role => (req, res, next) => {
  const user = getSessionUser(req);
  if (!user) return res.redirect('/login.html');
  if (role && user.role !== role) return res.redirect('/dashboard.html');
  res.set('Cache-Control', 'no-store');
  next();
};

app.get(['/', '/index.html'], (req, res) => res.redirect(getSessionUser(req) ? '/dashboard.html' : '/login.html'));
app.get('/login.html',    redirectIfSignedIn, sendPage('login.html'));
app.get('/register.html', redirectIfSignedIn, sendPage('register.html'));
SHARED_PAGES.forEach(p  => app.get(`/${p}.html`, guardPage(null),      sendPage(`${p}.html`)));
STUDENT_PAGES.forEach(p => app.get(`/${p}.html`, guardPage('student'), sendPage(`${p}.html`)));
ADMIN_PAGES.forEach(p   => app.get(`/${p}.html`, guardPage('admin'),   sendPage(`${p}.html`)));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js',  express.static(path.join(ROOT, 'js')));

/* ── Background jobs ──────────────────────────────── */
loans.runJobs();
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now());
  loans.runJobs();
}, 5 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Campus Hardware Lending System running at http://localhost:${PORT}`);
});
