const Run = require('../models/Run');
const { runScope } = require('../utils/access');
const { wrap, fail, isId, paging, pageCount } = require('../utils/http');

const row = r => ({
  id: r._id, time: r.createdAt, agentId: r.agentId, agentName: r.agentName, person: r.userName,
  status: r.status, durationMs: r.durationMs, cost: r.cost
});

// GET /runs/list?status=&agentId=&page=
exports.list = wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req);
  const filter = await runScope(req.user);
  if (['running', 'waiting', 'done', 'failed', 'stopped'].includes(req.query.status)) filter.status = req.query.status;
  if (isId(req.query.agentId)) filter.agentId = req.query.agentId;

  const [rows, total] = await Promise.all([
    Run.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Run.countDocuments(filter)
  ]);
  res.json({ runs: rows.map(row), total, page, pages: pageCount(total, pageSize) });
});

// GET /runs/get?id=   (the step-by-step timeline)
exports.get = wrap(async (req, res) => {
  if (!isId(req.query.id)) return fail(res, 400, 'validation', 'Missing or invalid id.');
  const r = await Run.findOne({ ...(await runScope(req.user)), _id: req.query.id }).lean();
  if (!r) return fail(res, 404, 'not_found', 'Run not found.');
  res.json({
    run: { ...row(r), inputTokens: r.inputTokens, outputTokens: r.outputTokens, error: r.error, steps: r.steps }
  });
});
