/* ============================================================
   API tests: escrow money flow, auth, paging.
   Run: npm test   (uses a fresh temporary database)
   ============================================================ */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chh-test-'));
process.env.DATA_DIR   = path.join(tmp, 'data');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
delete process.env.NODE_ENV;
delete process.env.SMTP_HOST;

const app = require('../server');

let server, base;
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A signed-in client with its own cookie. */
async function signIn(email, password) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (url, body, method) => {
    const r = await fetch(base + url, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  };
}

const localDate = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA');
const CARD = { number: '4242 4242 4242 4242', expiry: '12/39', cvc: '123', name: 'Ahmad Ridhwan' };
// Smallest byte sequence that passes the server's JPEG signature check.
const PHOTO = 'data:image/jpeg;base64,' + Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46]).toString('base64');

let borrower, lender, admin, tool;
before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  borrower = await signIn('ahmad@student.tarc.edu.my', 'Borrow#Tools26');
  lender   = await signIn('sara@student.tarc.edu.my', 'Lend#Gadget26');
  admin    = await signIn('admin@admin.com', 'Admin#Lab2026');
  const { data } = await borrower('/api/tools?q=Arduino');
  tool = data.tools.find(t => t.owner.name === 'Sara Wong' && t.availability === 'available');
  assert.ok(tool, 'seeded Arduino listing');
});

async function book(days = 2) {
  const { status, data } = await borrower('/api/loans', {
    toolId: tool.id,
    startDate: localDate(1),
    endDate: localDate(1 + days),
    handoverTime: `${localDate(1)} 10:00`,
    handoverLocation: 'Library foyer',
    message: 'Needed for a lab assignment.',
  });
  assert.equal(status, 201, JSON.stringify(data));
  return data.loan;
}

test('full rental: escrow holds, PIN releases the fee, inspection refunds the deposit', async () => {
  const loan = await book(2);
  const rental = tool.dailyRate * 2;

  const paid = await borrower(`/api/loans/${loan.id}/pay`, { method: 'card', card: CARD });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  let { data: { loan: l } } = await borrower(`/api/loans/${loan.id}`);
  assert.equal(l.status, 'pending');
  assert.equal(l.cost.escrow, rental + tool.deposit, 'rental + deposit held');

  assert.equal((await lender(`/api/loans/${loan.id}/accept`, {})).status, 200);
  ({ data: { loan: l } } = await borrower(`/api/loans/${loan.id}`));
  assert.match(l.pin, /^\d{4}$/, 'borrower sees the PIN');
  const { data: { loan: lenderView } } = await lender(`/api/loans/${loan.id}`);
  assert.equal(lenderView.pin, null, 'lender never sees the PIN');

  const wrong = l.pin === '0000' ? '1111' : '0000';
  assert.equal((await lender(`/api/loans/${loan.id}/verify-pin`, { pin: wrong })).status, 400);
  assert.equal((await lender(`/api/loans/${loan.id}/verify-pin`, { pin: l.pin })).status, 200);
  ({ data: { loan: l } } = await borrower(`/api/loans/${loan.id}`));
  assert.equal(l.status, 'active');
  assert.equal(l.cost.escrow, tool.deposit, 'only the deposit is still held');

  const before = (await borrower('/api/auth/me')).data.user.trustPoints;
  assert.equal((await borrower(`/api/loans/${loan.id}/return`, { photo: PHOTO })).status, 200);
  assert.equal((await lender(`/api/loans/${loan.id}/inspect`, {})).status, 200);
  ({ data: { loan: l } } = await borrower(`/api/loans/${loan.id}`));
  assert.equal(l.status, 'completed');
  assert.equal(l.cost.escrow, 0, 'escrow emptied');
  const refund = l.transactions?.find(t => t.type === 'refund');
  if (refund) assert.equal(refund.amount, tool.deposit);
  assert.equal((await borrower('/api/auth/me')).data.user.trustPoints, before + 2, '+2 Trust Points for an on-time return');
});

test('declined card leaves the booking unpaid', async () => {
  const loan = await book(1);
  const res = await borrower(`/api/loans/${loan.id}/pay`, { method: 'card', card: { ...CARD, number: '4000 0000 0000 0002' } });
  assert.equal(res.status, 402);
  const { data: { loan: l } } = await borrower(`/api/loans/${loan.id}`);
  assert.equal(l.status, 'awaiting_payment');
  assert.equal(l.cost.escrow, 0);
  assert.equal((await borrower(`/api/loans/${loan.id}/cancel`, {})).status, 200);
});

test('cancelling a paid booking refunds everything', async () => {
  const loan = await book(1);
  assert.equal((await borrower(`/api/loans/${loan.id}/pay`, { method: 'card', card: CARD })).status, 200);
  assert.equal((await borrower(`/api/loans/${loan.id}/cancel`, { reason: 'Plans changed' })).status, 200);
  const { data: { loan: l } } = await borrower(`/api/loans/${loan.id}`);
  assert.equal(l.status, 'cancelled');
  assert.equal(l.cost.escrow, 0);
});

test('lender decline refunds the borrower in full', async () => {
  const loan = await book(1);
  assert.equal((await borrower(`/api/loans/${loan.id}/pay`, { method: 'fpx', bank: 'CampusBank' })).status, 200);
  assert.equal((await lender(`/api/loans/${loan.id}/decline`, { note: 'Not free that day' })).status, 200);
  const { data: { loan: l } } = await borrower(`/api/loans/${loan.id}`);
  assert.equal(l.status, 'declined');
  assert.equal(l.cost.escrow, 0);
});

test('tool list supports paging', async () => {
  const all = (await borrower('/api/tools')).data;
  assert.ok(all.total >= 3);
  const page1 = (await borrower('/api/tools?limit=2')).data;
  const page2 = (await borrower('/api/tools?limit=2&offset=2')).data;
  assert.equal(page1.tools.length, 2);
  assert.equal(page1.total, all.total);
  assert.notDeepEqual(page1.tools.map(t => t.id), page2.tools.map(t => t.id));
});

test('role checks: students cannot use admin APIs or pages', async () => {
  assert.equal((await borrower('/api/admin/users')).status, 403);
  assert.equal((await admin('/api/admin/users')).status, 200);
  const res = await fetch(base + '/reports.html', { redirect: 'manual' });
  assert.equal(res.status, 302);
});

test('sign-in config and password reset outside production', async () => {
  const config = await (await fetch(base + '/api/auth/config')).json();
  assert.equal(config.passwordReset, true);
  assert.equal(config.demo, false);
  assert.deepEqual(config.demoAccounts, []);

  const res = await fetch(base + '/api/auth/forgot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'daniel@student.tarc.edu.my' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(body.devCode, /^\d{6}$/);
});

test('visitors see the landing page', async () => {
  const visitor = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(visitor.status, 200);
  assert.match(await visitor.text(), /How a rental works/);
});
