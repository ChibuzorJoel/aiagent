const Conversation = require('../models/Conversation');
const Agent = require('../models/Agent');
const Approval = require('../models/Approval');
const Run = require('../models/Run');
const Announcement = require('../models/Announcement');
const { runScope, approvalScope } = require('../utils/access');
const { monthStart } = require('../utils/limits');
const { wrap, fail, isId, isBuilder } = require('../utils/http');

// GET /dashboard
exports.dashboard = wrap(async (req, res) => {
  const u = req.user;
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const agentFilter = isBuilder(u) && u.role !== 'admin' ? { $or: [{ ownerId: u._id }, { status: 'published' }] } : u.role === 'admin' ? {} : { status: 'published' };

  const [chatsThisWeek, agentsAvailable, waiting, recent, agents] = await Promise.all([
    Conversation.countDocuments({ userId: u._id, createdAt: { $gte: weekAgo } }),
    Agent.countDocuments(agentFilter),
    approvalScope(u).then(s => Approval.countDocuments({ ...s, status: 'pending' })),
    Conversation.find({ userId: u._id }).sort({ updatedAt: -1 }).limit(3).lean(),
    Agent.find({ status: 'published' }).sort({ updatedAt: -1 }).limit(6).select('name purpose color').lean()
  ]);

  const colorRows = await Agent.find({ _id: { $in: recent.map(c => c.agentId) } }).select('color').lean();
  const colors = new Map(colorRows.map(a => [String(a._id), a.color]));

  let costThisMonth = null; // builders and admins only
  if (isBuilder(u)) {
    const [row] = await Run.aggregate([
      { $match: { ...(await runScope(u)), createdAt: { $gte: monthStart() } } },
      { $group: { _id: null, cost: { $sum: '$cost' } } }
    ]);
    costThisMonth = Math.round((row ? row.cost : 0) * 10000) / 10000;
  }

  res.json({
    greeting: { name: u.name, date: new Date().toISOString() },
    stats: { chatsThisWeek, agentsAvailable, waitingForApproval: waiting, costThisMonth },
    recentConversations: recent.map(c => ({ id: c._id, title: c.title, agentName: c.agentName, color: colors.get(String(c.agentId)) || '#4338ca', updatedAt: c.updatedAt })),
    agents: agents.map(a => ({ id: a._id, name: a.name, purpose: a.purpose, color: a.color }))
  });
});

// GET /announcements
exports.announcements = wrap(async (req, res) => {
  const rows = await Announcement.find().sort({ createdAt: -1 }).limit(10).lean();
  res.json({ announcements: rows.map(a => ({ id: a._id, title: a.title, body: a.body, createdBy: a.createdBy, createdAt: a.createdAt })) });
});

// POST /announcements/create   (admin)   { title, body }
exports.createAnnouncement = wrap(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) return fail(res, 400, 'validation', 'A title is required.');
  const a = await Announcement.create({ title, body: String(req.body.body || '').slice(0, 1000), createdBy: req.user.name });
  res.status(201).json({ announcement: { id: a._id, title: a.title, body: a.body, createdAt: a.createdAt } });
});

// POST /announcements/delete   (admin)   { id }
exports.deleteAnnouncement = wrap(async (req, res) => {
  if (!isId(req.body.id)) return fail(res, 400, 'validation', 'Missing or invalid id.');
  await Announcement.findByIdAndDelete(req.body.id);
  res.json({ ok: true });
});
