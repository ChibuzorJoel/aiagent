const Run = require('../models/Run');
const { runScope } = require('../utils/access');
const { getLimits, monthStart } = require('../utils/limits');
const { wrap } = require('../utils/http');

const round = n => Math.round(n * 10000) / 10000;

// GET /usage/summary?days=7|30|90
exports.summary = wrap(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = new Date(); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - (days - 1));

  const scope = await runScope(req.user);
  const match = { ...scope, createdAt: { $gte: since } };
  const group = (id, name) => [
    { $match: match },
    { $group: { _id: id, name: { $first: name }, messages: { $sum: 1 }, cost: { $sum: '$cost' } } },
    { $sort: { cost: -1 } },
    { $limit: 100 }
  ];

  const [daily, byAgent, byPerson, month, limits] = await Promise.all([
    Run.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, messages: { $sum: 1 }, cost: { $sum: '$cost' } } }
    ]),
    Run.aggregate(group('$agentId', '$agentName')),
    Run.aggregate(group('$userId', '$userName')),
    Run.aggregate([{ $match: { ...scope, createdAt: { $gte: monthStart() } } }, { $group: { _id: null, cost: { $sum: '$cost' } } }]),
    getLimits()
  ]);

  // One entry per day, including days with no activity
  const byDay = new Map(daily.map(d => [d._id, d]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since); d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    series.push({ date: key, messages: hit ? hit.messages : 0, cost: hit ? round(hit.cost) : 0 });
  }

  const fmt = r => ({ id: r._id, name: r.name, messages: r.messages, cost: round(r.cost) });
  res.json({
    days: series,
    byAgent: byAgent.map(fmt),
    byPerson: byPerson.map(fmt),
    monthCost: round(month[0] ? month[0].cost : 0),
    monthlyCostCap: limits.monthlyCostCap,
    dailyMessageCap: limits.dailyMessageCap
  });
});
