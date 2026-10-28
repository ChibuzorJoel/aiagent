const nodemailer = require('nodemailer');
require('./fetchPolyfill');

// Option 1 (works on Render and other hosts that block SMTP): Brevo HTTP API. Set BREVO_API_KEY.
// Option 2: any SMTP server (Gmail app password, etc.). Set SMTP_HOST, SMTP_USER, SMTP_PASS.
let transport = null;
if (!process.env.BREVO_API_KEY && process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] } : { email: from.trim() };
}

async function sendViaBrevo({ to, subject, text }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: parseFrom(process.env.MAIL_FROM || 'no-reply@example.com'),
      to: [{ email: to }], subject, textContent: text
    })
  });
  if (!res.ok) throw new Error(`Brevo answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Resolves { sent: true }, or { sent: false } when mail is not configured
async function sendMail({ to, subject, text }) {
  if (process.env.BREVO_API_KEY) {
    await sendViaBrevo({ to, subject, text });
    return { sent: true };
  }
  if (!transport) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[mail not configured] To: ${to} | ${subject}\n${text}`);
    }
    return { sent: false };
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || 'no-reply@example.com', to, subject, text });
  return { sent: true };
}

module.exports = { sendMail };
