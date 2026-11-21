/* ============================================================
   Outgoing email (password reset codes).
   Configure with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and
   MAIL_FROM. Without SMTP_HOST no email is sent.
   ============================================================ */

const nodemailer = require('nodemailer');

const enabled = !!process.env.SMTP_HOST;
const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@campus-hardware.local';

const transport = enabled
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

async function sendMail({ to, subject, text }) {
  if (!transport) throw new Error('Email is not configured.');
  await transport.sendMail({ from: FROM, to, subject, text });
}

module.exports = { enabled, sendMail };
