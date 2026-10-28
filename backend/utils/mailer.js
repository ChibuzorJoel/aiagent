const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

// Resolves { sent: true }, or { sent: false } when mail is not configured
async function sendMail({ to, subject, text }) {
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
