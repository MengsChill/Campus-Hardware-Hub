/* ============================================================
   Production / demo-mode settings, as deployed on Render.
   Starts a real server process so NODE_ENV is applied from boot.
   ============================================================ */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const tmp  = fs.mkdtempSync(path.join(os.tmpdir(), 'chh-prod-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  const env = { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true', PORT: String(PORT),
                DATA_DIR: path.join(tmp, 'data'), UPLOAD_DIR: path.join(tmp, 'uploads') };
  delete env.SMTP_HOST;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { if (String(chunk).includes('running at')) resolve(); });
    child.once('exit', code => reject(new Error(`server exited with ${code}`)));
  });
});
after(() => {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('demo mode exposes demo accounts that can sign in', async () => {
  const config = await (await fetch(base + '/api/auth/config')).json();
  assert.equal(config.demo, true);
  assert.equal(config.demoAccounts.length, 4);
  const admin = config.demoAccounts.find(a => a.role === 'admin');
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: admin.password }),
  });
  assert.equal(res.status, 200);
});

test('without an email service, password reset is switched off and never leaks a code', async () => {
  const config = await (await fetch(base + '/api/auth/config')).json();
  assert.equal(config.passwordReset, false);
  const res = await fetch(base + '/api/auth/forgot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ahmad@student.tarc.edu.my' }),
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).devCode, undefined);
});
