const Limit = require('../models/Limit');
const Message = require('../models/Message');
const Run = require('../models/Run');

const getLimits = () =>
  Limit.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true, new: true, setDefaultsOnInsert: true });

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

// Checked before every chat message
async function checkLimits(user) {
  const L = await getLimits();

  if (L.dailyMessageCap > 0) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const used = await Message.countDocuments({ userId: user._id, role: 'user', createdAt: { $gte: start } });
    if (used >= L.dailyMessageCap) {
      return { ok: false, limits: L, message: `You have reached today's limit of ${L.dailyMessageCap} messages.` };
    }
  }

  if (L.monthlyCostCap > 0) {
    const [row] = await Run.aggregate([
      { $match: { createdAt: { $gte: monthStart() } } },
      { $group: { _id: null, cost: { $sum: '$cost' } } }
    ]);
    if ((row ? row.cost : 0) >= L.monthlyCostCap) {
      return { ok: false, limits: L, message: 'The monthly spending limit has been reached.' };
    }
  }

  return { ok: true, limits: L };
}

module.exports = { getLimits, checkLimits, monthStart };
