const Agent = require('../models/Agent');
const Knowledge = require('../models/Knowledge');
const Conversation = require('../models/Conversation');
const { TOOLS } = require('../utils/toolRegistry');
const { logAudit } = require('../utils/audit');
const { wrap, fail, isId, same, esc } = require('../utils/http');

const canEdit = (a, u) => u.role === 'admin' || same(a.ownerId, u._id);

const dto = (a, u) => ({
  id: a._id, name: a.name, purpose: a.purpose, color: a.color, status: a.status, ownerName: a.ownerName,
  toolsCount: a.tools.length, knowledgeCount: a.knowledgeIds.length, updatedAt: a.updatedAt,
  canEdit: canEdit(a, u),
  // Instructions are only shown to the people who can edit the agent
  ...(canEdit(a, u) ? { instructions: a.instructions, knowledgeIds: a.knowledgeIds, tools: a.tools } : {})
});

async function clean(body, user) {
  const name = String(body.name || '').trim();
  if (!name || name.length > 80) return { error: 'Give the agent a name (80 characters at most).' };
  const color = String(body.color || '#4338ca');
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: 'Choose a valid colour.' };
  const instructions = String(body.instructions || '');
  if (instructions.length > 8000) return { error: 'Instructions are too long (8000 characters at most).' };

  const knowledgeIds = [...new Set((Array.isArray(body.knowledgeIds) ? body.knowledgeIds : []).map(String))];
  if (knowledgeIds.some(i => !isId(i))) return { error: 'One of the selected documents is not valid.' };
  if (knowledgeIds.length) {
    const q = { _id: { $in: knowledgeIds } };
    if (user.role !== 'admin') q.ownerId = user._id;
    if ((await Knowledge.countDocuments(q)) !== knowledgeIds.length) return { error: 'One of the selected documents is not available.' };
  }

  const seen = new Set();
  const tools = [];
  for (const t of Array.isArray(body.tools) ? body.tools : []) {
    const key = String(t && t.key);
    if (!TOOLS[key]) return { error: `Unknown tool: ${key}` };
    if (seen.has(key)) continue;
    seen.add(key);
    tools.push({ key, mode: t.mode === 'allowed' ? 'allowed' : 'ask' });
  }

  return { value: { name, purpose: String(body.purpose || '').trim().slice(0, 200), color, instructions, knowledgeIds, tools } };
}

async function load(req, res, { edit = false } = {}) {
  const id = req.body.id || req.query.id;
  if (!isId(id)) { fail(res, 400, 'validation', 'Missing or invalid agent id.'); return null; }
  const agent = await Agent.findById(id);
  const visible = agent && (agent.status === 'published' || canEdit(agent, req.user));
  if (!visible) { fail(res, 404, 'not_found', 'Agent not found.'); return null; }
  if (edit && !canEdit(agent, req.user)) { fail(res, 403, 'forbidden', 'Only the owner can change this agent.'); return null; }
  return agent;
}

// GET /agents/list?q=&status=
exports.list = wrap(async (req, res) => {
  const u = req.user;
  const filter = u.role === 'admin' ? {} : u.role === 'builder' ? { $or: [{ ownerId: u._id }, { status: 'published' }] } : { status: 'published' };
  if (req.query.status === 'draft' || req.query.status === 'published') filter.status = req.query.status;
  if (req.query.q) filter.name = new RegExp(esc(String(req.query.q).slice(0, 60)), 'i');
  const agents = await Agent.find(filter).sort({ updatedAt: -1 }).limit(200);
  res.json({ agents: agents.map(a => dto(a, u)) });
});

// GET /agents/get?id=
exports.get = wrap(async (req, res) => {
  const agent = await load(req, res);
  if (agent) res.json({ agent: dto(agent, req.user) });
});

// POST /agents/create
exports.create = wrap(async (req, res) => {
  const c = await clean(req.body, req.user);
  if (c.error) return fail(res, 400, 'validation', c.error);
  const agent = await Agent.create({ ...c.value, ownerId: req.user._id, ownerName: req.user.name });
  await logAudit({ user: req.user, action: 'agent_created', target: agent.name, details: 'Created as a draft.' });
  res.status(201).json({ agent: dto(agent, req.user) });
});

// POST /agents/update   { id, ...fields }
exports.update = wrap(async (req, res) => {
  const agent = await load(req, res, { edit: true });
  if (!agent) return;
  const c = await clean(req.body, req.user);
  if (c.error) return fail(res, 400, 'validation', c.error);
  Object.assign(agent, c.value);
  await agent.save();
  await logAudit({ user: req.user, action: 'agent_updated', target: agent.name });
  res.json({ agent: dto(agent, req.user) });
});

// POST /agents/publish   { id, published: true|false }
exports.publish = wrap(async (req, res) => {
  const agent = await load(req, res, { edit: true });
  if (!agent) return;
  const publish = req.body.published !== false;
  if (publish && !agent.instructions.trim()) return fail(res, 400, 'validation', 'Add instructions before publishing.');
  agent.status = publish ? 'published' : 'draft';
  await agent.save();
  await logAudit({ user: req.user, action: 'agent_published', target: agent.name, details: publish ? 'Published.' : 'Unpublished.' });
  res.json({ agent: dto(agent, req.user) });
});

// POST /agents/delete   { id }
exports.remove = wrap(async (req, res) => {
  const agent = await load(req, res, { edit: true });
  if (!agent) return;
  await agent.deleteOne();
  await logAudit({ user: req.user, action: 'agent_deleted', target: agent.name, details: 'Deleted.' });
  res.json({ ok: true });
});

// POST /agents/test: tries an UNSAVED draft. Nothing is stored and tools only do a dry run.
exports.test = wrap(async (req, res) => {
  const c = await clean(req.body, req.user);
  if (c.error) return fail(res, 400, 'validation', c.error);
  const { chatStream } = require('../utils/ollama');
  const { buildSystem } = require('../utils/agentRunner');

  const draft = { ...c.value, _id: null };
  const system = buildSystem(draft, req.user) + '\nThis is a test chat. Tools only do a dry run.';
  const tools = c.value.tools.filter(t => TOOLS[t.key]).map(t => ({
    name: t.key, description: TOOLS[t.key].description, input_schema: TOOLS[t.key].input_schema
  }));
  if (c.value.knowledgeIds.length && !tools.some(t => t.name === 'search_knowledge')) {
    tools.push({ name: 'search_knowledge', description: TOOLS.search_knowledge.description, input_schema: TOOLS.search_knowledge.input_schema });
  }

  const messages = (Array.isArray(req.body.messages) ? req.body.messages : []).slice(-20)
    .filter(m => m && typeof m.text === 'string' && m.text.trim())
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text).slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return fail(res, 400, 'validation', 'Send a message to test.');
  }

  const chips = [];
  let reply = '';
  for (let turn = 0; turn < 4; turn++) {
    const out = await chatStream({ model: process.env.OLLAMA_MODEL || 'qwen2.5:7b', system, messages, tools });
    if (!out.toolCalls.length) { reply = out.text.trim(); break; }
    messages.push({ role: 'assistant', content: [
      ...(out.text.trim() ? [{ type: 'text', text: out.text }] : []),
      ...out.toolCalls.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input }))
    ] });
    const results = [];
    for (const t of out.toolCalls) {
      const def = TOOLS[t.name];
      const t0 = Date.now();
      let content; let ok = true;
      try {
        if (!def) throw new Error('Unknown tool.');
        content = String(await def.run(t.input || {}, { user: req.user, agent: draft, dryRun: true })).slice(0, 4000);
      } catch (e) { content = `Tool error: ${e.message}`; ok = false; }
      chips.push({ name: def ? def.name : t.name, ms: Date.now() - t0, ok });
      results.push({ type: 'tool_result', tool_use_id: t.id, content, ...(ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
  }
  res.json({ reply: reply || '(The agent did not produce an answer.)', tools: chips });
});
