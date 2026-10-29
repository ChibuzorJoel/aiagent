const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const LoginCode = require('../models/LoginCode');
const { logAudit } = require('../utils/audit');
const { sendMail } = require('../utils/mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s-]{7,15}$/;
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const publicUser = u => ({ id: u._id, name: u.name, email: u.email, phone: u.phone || '', role: u.role });

// POST /auth/request-code   { email }
exports.requestCode = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ code: 'validation', message: 'Enter a valid e-mail address.' });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    await LoginCode.deleteMany({ email });
    await LoginCode.create({
      email,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    // Without SMTP settings the code is printed in the server console (development only)
    sendMail({ to: email, subject: 'Your sign-in code', text: `Your sign-in code is ${code}. It expires in 10 minutes.` })
      .catch(err => console.error('Could not send login code:', err.message));

    // Same answer whether or not the address is known
    res.json({ message: 'If that address is valid, a code has been sent.' });
  } catch (err) {
    next(err);
  }
};

// POST /auth/verify-code   { email, code }
exports.verifyCode = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();

    const record = await LoginCode.findOne({ email });
    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ code: 'invalid_code', message: 'That code has expired. Request a new one.' });
    }

    if (record.attempts >= 5) {
      await record.deleteOne();
      return res.status(429).json({ code: 'too_many', message: 'Too many attempts. Request a new code.' });
    }

    if (record.codeHash !== hash(code)) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({ code: 'invalid_code', message: 'That code is not correct.' });
    }

    await record.deleteOne();

    // Find or create the user. The very first account becomes the admin.
    let user = await User.findOne({ email });
    if (!user) {
      const isFirst = (await User.countDocuments()) === 0;
      if (!isFirst && process.env.INVITE_ONLY === 'true') {
        return res.status(403).json({ code: 'not_invited', message: 'This e-mail address has not been added yet. Ask an admin.' });
      }
      user = await User.create({
        email,
        name: email.split('@')[0],
        role: isFirst ? 'admin' : 'member'
      });
    }

    if (user.active === false) {
      return res.status(403).json({ code: 'deactivated', message: 'This account has been deactivated.' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '8h' });

    await logAudit({ user, action: 'sign_in', target: '-', details: 'Signed in with an e-mail code.' });

    res.json({ token, role: user.role, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
};

// GET /auth/me
exports.me = (req, res) => {
  res.json(publicUser(req.user));
};

// POST /auth/profile   { name, phone }
exports.updateProfile = async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    if (!name || name.length > 80) {
      return res.status(400).json({ code: 'validation', message: 'Please enter your name (80 characters at most).' });
    }
    if (phone && !PHONE_RE.test(phone)) {
      return res.status(400).json({ code: 'validation', message: 'Please enter a valid phone number.' });
    }
    req.user.name = name;
    req.user.phone = phone;
    await req.user.save();
    res.json(publicUser(req.user));
  } catch (err) {
    next(err);
  }
};
