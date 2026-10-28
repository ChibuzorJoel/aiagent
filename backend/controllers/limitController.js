const { TOOLS } = require('../utils/toolRegistry');
const { getLimits } = require('../utils/limits');
const { logAudit } = require('../utils/audit');
const { wrap, fail } = require('../utils/http');

const dto = L => ({
  monthlyCostCap: L.monthlyCostCap, dailyMessageCap: L.dailyMessageCap,
  blockedTools: L.blockedTools, alwaysApproveTools: L.alwaysApproveTools, retentionDays: L.retentionDays
});

// GET /limits/get
exports.get = wrap(async (req, res) => {
  res.json({ limits: dto(await getLimits()), tools: Object.values(TOOLS).map(t => ({ key: t.key, name: t.name })) });
});

// POST /limits/save
exports.save = wrap(async (req, res) => {
  const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
  const monthlyCostCap = num(req.body.monthlyCostCap, 1e7);
  const dailyMessageCap = num(req.body.dailyMessageCap, 1e6);
  const retentionDays = num(req.body.retentionDays, 3650);
  if (monthlyCostCap === null || dailyMessageCap === null || retentionDays === null) {
    return fail(res, 400, 'validation', 'Caps and retention must be numbers of 0 or more (0 means no limit).');
  }
  const list = v => [...new Set((Array.isArray(v) ? v : []).map(String))];
  const blockedTools = list(req.body.blockedTools);
  const alwaysApproveTools = list(req.body.alwaysApproveTools);
  if ([...blockedTools, ...alwaysApproveTools].some(k => !TOOLS[k])) return fail(res, 400, 'validation', 'Unknown tool in the list.');

  const L = await getLimits();
  const before = JSON.stringify(dto(L));
  Object.assign(L, { monthlyCostCap, dailyMessageCap, retentionDays: Math.floor(retentionDays), blockedTools, alwaysApproveTools });
  await L.save();
  await logAudit({ user: req.user, action: 'limit_changed', target: 'Limits and Policies', details: `From ${before} to ${JSON.stringify(dto(L))}` });
  res.json({ limits: dto(L) });
});
