const ToolConnection = require('../models/ToolConnection');
const { TOOLS, connectedKeys } = require('../utils/toolRegistry');
const { getLimits } = require('../utils/limits');
const { logAudit } = require('../utils/audit');
const { wrap, fail } = require('../utils/http');

// GET /tools/list
exports.list = wrap(async (req, res) => {
  const [connected, limits] = await Promise.all([connectedKeys(), getLimits()]);
  res.json({
    tools: Object.values(TOOLS).map(t => ({
      key: t.key, name: t.name, description: t.description, readOnly: t.readOnly,
      needsApproval: !t.readOnly || limits.alwaysApproveTools.includes(t.key),
      blocked: limits.blockedTools.includes(t.key),
      connected: connected.has(t.key)
    }))
  });
});

async function setConnected(req, res, connected) {
  const key = String(req.body.key || '');
  if (!TOOLS[key]) return fail(res, 404, 'not_found', 'Unknown tool.');
  await ToolConnection.findOneAndUpdate({ key }, { connected, updatedBy: req.user.name }, { upsert: true, new: true });
  await logAudit({ user: req.user, action: connected ? 'tool_connected' : 'tool_disconnected', target: TOOLS[key].name });
  res.json({ ok: true, key, connected });
}

// POST /tools/connect   { key }
exports.connect = wrap((req, res) => setConnected(req, res, true));
// POST /tools/disconnect   { key }
exports.disconnect = wrap((req, res) => setConnected(req, res, false));

// POST /tools/test   { key }  (a dry run: nothing is sent or changed)
exports.test = wrap(async (req, res) => {
  const def = TOOLS[String(req.body.key || '')];
  if (!def) return fail(res, 404, 'not_found', 'Unknown tool.');
  const t0 = Date.now();
  try {
    const result = await def.run(def.testInput || {}, { user: req.user, agent: null, dryRun: true });
    res.json({ ok: true, result: String(result).slice(0, 2000), ms: Date.now() - t0 });
  } catch (e) {
    res.json({ ok: false, result: e.message, ms: Date.now() - t0 });
  }
});
