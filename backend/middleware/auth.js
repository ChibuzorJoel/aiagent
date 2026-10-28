const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies the token AND re-reads the user, so a role change or deactivation takes effect immediately
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      return res.status(401).json({ code: 'auth', message: 'Please sign in.' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || user.active === false) {
      return res.status(401).json({ code: 'auth', message: 'Please sign in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ code: 'auth', message: 'Your session has expired. Please sign in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ code: 'forbidden', message: 'You do not have access to this.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
