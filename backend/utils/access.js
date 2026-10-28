const Agent = require('../models/Agent');
const { same } = require('./http');

const canUseAgent = (agent, user) =>
  agent.status === 'published' || same(agent.ownerId, user._id) || user.role === 'admin';

const ownedAgentIds = user => Agent.find({ ownerId: user._id }).distinct('_id');

// Mongo filters limiting what a person may see. Admins see everything.
async function runScope(user) {
  if (user.role === 'admin') return {};
  return { $or: [{ agentId: { $in: await ownedAgentIds(user) } }, { userId: user._id }] };
}

async function approvalScope(user) {
  if (user.role === 'admin') return {};
  return { $or: [{ requestedBy: user._id }, { agentId: { $in: await ownedAgentIds(user) } }] };
}

module.exports = { canUseAgent, runScope, approvalScope };
