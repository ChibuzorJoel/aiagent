const AuditLog = require('../models/AuditLog');

/**
 * Call this from any controller after something changes.
 * It never throws, so a logging problem cannot break the main request.
 */
async function logAudit({ user, action, target = '-', details = '' }) {
  try {
    await AuditLog.create({ person: user.name, personId: user._id, action, target, details });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logAudit };
