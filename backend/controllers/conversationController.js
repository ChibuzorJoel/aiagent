const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Approval = require('../models/Approval');
const { msgDto, approvalDto } = require('../utils/agentRunner');
const { logAudit } = require('../utils/audit');
const { wrap, fail, isId, esc, paging, pageCount } = require('../utils/http');

// GET /conversations/list?q=&agentId=&page=
exports.list = wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req);
  const filter = { userId: req.user._id };
  if (req.query.q) filter.title = new RegExp(esc(String(req.query.q).slice(0, 60)), 'i');
  if (isId(req.query.agentId)) filter.agentId = req.query.agentId;

  const [rows, total] = await Promise.all([
    Conversation.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(pageSize).lean(),
    Conversation.countDocuments(filter)
  ]);
  res.json({
    conversations: rows.map(c => ({ id: c._id, title: c.title, agentId: c.agentId, agentName: c.agentName, updatedAt: c.updatedAt })),
    total, page, pages: pageCount(total, pageSize)
  });
});

// GET /conversations/get?id=   (members: their own only, admins: any)
exports.get = wrap(async (req, res) => {
  if (!isId(req.query.id)) return fail(res, 400, 'validation', 'Missing or invalid id.');
  const filter = { _id: req.query.id };
  if (req.user.role !== 'admin') filter.userId = req.user._id;
  const c = await Conversation.findOne(filter).lean();
  if (!c) return fail(res, 404, 'not_found', 'Conversation not found.');

  const [messages, pending] = await Promise.all([
    Message.find({ conversationId: c._id }).sort({ createdAt: 1 }).limit(500),
    Approval.find({ conversationId: c._id, status: 'pending' })
  ]);
  res.json({
    conversation: { id: c._id, title: c.title, agentId: c.agentId, agentName: c.agentName },
    messages: messages.map(msgDto),
    pendingApprovals: pending.map(approvalDto)
  });
});

// POST /conversations/rename   { id, title }
exports.rename = wrap(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!isId(req.body.id) || !title) return fail(res, 400, 'validation', 'A title is required.');
  const c = await Conversation.findOneAndUpdate({ _id: req.body.id, userId: req.user._id }, { title }, { new: true });
  if (!c) return fail(res, 404, 'not_found', 'Conversation not found.');
  res.json({ ok: true, title: c.title });
});

// POST /conversations/delete   { id }
exports.remove = wrap(async (req, res) => {
  if (!isId(req.body.id)) return fail(res, 400, 'validation', 'Missing or invalid id.');
  const c = await Conversation.findOneAndDelete({ _id: req.body.id, userId: req.user._id });
  if (!c) return fail(res, 404, 'not_found', 'Conversation not found.');
  await Message.deleteMany({ conversationId: c._id });
  await logAudit({ user: req.user, action: 'conversation_deleted', target: c.title });
  res.json({ ok: true });
});
