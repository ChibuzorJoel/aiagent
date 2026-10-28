const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { getLimits } = require('./limits');

// Removes conversations older than the retention period set in Limits and Policies (0 = keep forever)
async function purge() {
  const L = await getLimits();
  if (!L.retentionDays) return;
  const cutoff = new Date(Date.now() - L.retentionDays * 86400000);
  const ids = await Conversation.find({ updatedAt: { $lt: cutoff } }).distinct('_id');
  if (!ids.length) return;
  await Message.deleteMany({ conversationId: { $in: ids } });
  await Conversation.deleteMany({ _id: { $in: ids } });
  console.log(`Retention: removed ${ids.length} old conversation(s).`);
}

function startRetention() {
  const run = () => purge().catch(e => console.error('Retention failed:', e.message));
  run();
  setInterval(run, 6 * 3600 * 1000).unref();
}

module.exports = { startRetention };
