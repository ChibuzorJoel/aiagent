const Approval = require('../models/Approval');
const Agent = require('../models/Agent');
const { resumeAfterDecision, msgDto, approvalDto } = require('../utils/agentRunner');
const { approvalScope } = require('../utils/access');
const { logAudit } = require('../utils/audit');
const { wrap, fail, isId, same, paging, pageCount } = require('../utils/http');

// GET /approvals/list?tab=pending|history&page=
exports.list = wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req);
  const scope = await approvalScope(req.user);
  const filter = { ...scope, status: req.query.tab === 'history' ? { $ne: 'pending' } : 'pending' };

  const [rows, total, pendingCount] = await Promise.all([
    Approval.find(filter).sort({ createdAt: req.query.tab === 'history' ? -1 : 1 }).skip(skip).limit(pageSize),
    Approval.countDocuments(filter),
    Approval.countDocuments({ ...scope, status: 'pending' }) // for the menu badge
  ]);
  res.json({ approvals: rows.map(approvalDto), total, page, pages: pageCount(total, pageSize), pendingCount });
});

// POST /approvals/decide   { id, decision: 'approve' | 'reject', reason? }
// Approving runs the action and lets the agent finish; the reply carries the agent's final message.
exports.decide = wrap(async (req, res) => {
  const { id, decision } = req.body;
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!isId(id) || !['approve', 'reject'].includes(decision)) return fail(res, 400, 'validation', 'Choose approve or reject.');

  const found = await Approval.findById(id);
  if (!found) return fail(res, 404, 'not_found', 'Approval not found.');

  let allowed = req.user.role === 'admin' || same(found.requestedBy, req.user._id);
  if (!allowed) allowed = !!(await Agent.exists({ _id: found.agentId, ownerId: req.user._id }));
  if (!allowed) return fail(res, 403, 'forbidden', 'You cannot decide this one.');

  // Atomic: only the first decision wins
  const approval = await Approval.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { status: decision === 'approve' ? 'approved' : 'rejected', reason, decidedBy: req.user._id, decidedByName: req.user.name, decidedAt: new Date() },
    { new: true }
  );
  if (!approval) return fail(res, 409, 'already_decided', 'This action has already been decided.');

  await logAudit({
    user: req.user, action: 'approval_decided', target: approval.toolName,
    details: `${approval.status} (${approval.description})${reason ? ` – ${reason}` : ''}`
  });

  let result;
  try {
    result = await resumeAfterDecision({ approval, approved: decision === 'approve', reason });
  } catch (e) {
    console.error('Resume failed:', e.message);
    return res.json({ approval: approvalDto(approval), error: 'The decision was saved, but the agent could not continue.' });
  }

  res.json({
    approval: approvalDto(approval),
    status: result.status,
    message: result.message ? msgDto(result.message) : null,
    nextApproval: result.approval ? approvalDto(result.approval) : null // the agent may ask for another approval
  });
});
