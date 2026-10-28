const Agent = require('../models/Agent');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Run = require('../models/Run');
const { drive } = require('../utils/agentRunner');
const { checkLimits } = require('../utils/limits');
const { canUseAgent } = require('../utils/access');
const { wrap, fail, isId } = require('../utils/http');

// The last messages of a conversation as the model expects them (alternating roles, starting with the user)
async function buildHistory(conversationId) {
  const rows = (await Message.find({ conversationId }).sort({ createdAt: -1 }).limit(20).lean()).reverse();
  const out = [];
  for (const m of rows) {
    if (!m.text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.text;
    else out.push({ role: m.role, content: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * POST /chat/send   { agentId, text, conversationId? }
 * Answers as a Server-Sent Events stream (read it with fetch + a stream reader, because EventSource
 * cannot send the Authorization header). Events:
 *   start {conversationId, runId} | thinking | delta {text} | tool {name, ms, ok}
 *   approval {...}   (the run pauses until POST /approvals/decide)
 *   done {message, runId} | error {message}
 * Closing the connection (the Stop button) cancels the run.
 */
exports.send = wrap(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 8000) return fail(res, 400, 'validation', 'Type a message (8000 characters at most).');
  if (!isId(req.body.agentId)) return fail(res, 400, 'validation', 'Choose an agent.');

  const agent = await Agent.findById(req.body.agentId);
  if (!agent || !canUseAgent(agent, req.user)) return fail(res, 404, 'not_found', 'Agent not found.');

  let convo = null;
  if (req.body.conversationId) {
    if (!isId(req.body.conversationId)) return fail(res, 400, 'validation', 'Invalid conversation.');
    convo = await Conversation.findOne({ _id: req.body.conversationId, userId: req.user._id });
    if (!convo) return fail(res, 404, 'not_found', 'Conversation not found.');
    if (String(convo.agentId) !== String(agent._id)) return fail(res, 400, 'validation', 'This conversation belongs to another agent.');
  }

  const check = await checkLimits(req.user);
  if (!check.ok) return fail(res, 429, 'limit', check.message);

  if (!convo) {
    convo = await Conversation.create({ title: text.slice(0, 60), userId: req.user._id, agentId: agent._id, agentName: agent.name });
  } else {
    await Conversation.updateOne({ _id: convo._id }, { $set: { updatedAt: new Date() } });
  }

  const userMsg = await Message.create({ conversationId: convo._id, userId: req.user._id, agentId: agent._id, role: 'user', text });

  const run = await Run.create({
    agentId: agent._id, agentName: agent.name, userId: req.user._id, userName: req.user.name, conversationId: convo._id,
    state: { messages: await buildHistory(convo._id), remaining: [], results: [], text: '', chips: [] }
  });

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  const emit = (event, data) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });

  emit('start', { conversationId: convo._id, runId: run._id });
  const result = await drive({ run, agent, user: req.user, emit, signal: ac.signal });
  // If the run failed, forget the question so the person's Retry does not ask it twice
  if (result && result.status === 'failed') await Message.deleteOne({ _id: userMsg._id }).catch(() => {});
  res.end();
});