const AuditLog = require('../models/AuditLog');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /audit/list?person=&action=&from=yyyy-mm-dd&to=yyyy-mm-dd&limit=500
exports.list = async (req, res, next) => {
  try {
    const { person, action, from, to } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);

    const filter = {};

    if (person) filter.person = String(person);
    if (action && AuditLog.schema.path('action').enumValues.includes(action)) {
      filter.action = action;
    }

    const range = {};
    if (from && DATE_RE.test(from)) range.$gte = new Date(from + 'T00:00:00');
    if (to && DATE_RE.test(to)) range.$lte = new Date(to + 'T23:59:59.999');
    if (Object.keys(range).length) filter.time = range;

    const rows = await AuditLog.find(filter).sort({ time: -1 }).limit(limit).lean();

    const entries = rows.map(r => ({
      id: r._id.toString(),
      time: r.time,
      person: r.person,
      action: r.action,
      target: r.target,
      details: r.details
    }));

    res.json({ entries });
  } catch (err) {
    next(err);
  }
};
