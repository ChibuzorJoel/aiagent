const User = require('../models/User');
const { logAudit } = require('../utils/audit');
const { wrap, fail, isId, same, esc, paging, pageCount } = require('../utils/http');

const ROLES = ['member', 'builder', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s-]{7,15}$/;
const dto = u => ({ id: u._id, name: u.name, email: u.email, phone: u.phone || '', role: u.role, active: u.active !== false, lastActive: u.lastLoginAt || null, createdAt: u.createdAt });

// GET /users/list?q=&role=&page=
exports.list = wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req);
  const filter = {};
  if (ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (req.query.q) {
    const rx = new RegExp(esc(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [rows, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize), User.countDocuments(filter)]);
  res.json({ users: rows.map(dto), total, page, pages: pageCount(total, pageSize) });
});

// POST /users/create   { email, name?, role }
exports.create = wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = ROLES.includes(req.body.role) ? req.body.role : 'member';
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'validation', 'Enter a valid e-mail address.');
  if (await User.exists({ email })) return fail(res, 409, 'exists', 'That person already has an account.');
  const phone = String(req.body.phone || '').trim();
  if (phone && !PHONE_RE.test(phone)) return fail(res, 400, 'validation', 'Enter a valid phone number.');
  const user = await User.create({ email, name: String(req.body.name || '').trim().slice(0, 80) || email.split('@')[0], phone, role });
  await logAudit({ user: req.user, action: 'user_changed', target: email, details: `Added as ${role}.` });
  res.status(201).json({ user: dto(user) });
});

// POST /users/update   { id, name?, role?, active? }
exports.update = wrap(async (req, res) => {
  if (!isId(req.body.id)) return fail(res, 400, 'validation', 'Missing or invalid id.');
  const user = await User.findById(req.body.id);
  if (!user) return fail(res, 404, 'not_found', 'User not found.');

  const changes = [];
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim().slice(0, 80);
    if (!name) return fail(res, 400, 'validation', 'Name cannot be empty.');
    if (name !== user.name) { changes.push(`name → ${name}`); user.name = name; }
  }
  if (req.body.phone !== undefined) {
    const phone = String(req.body.phone).trim();
    if (phone && !PHONE_RE.test(phone)) return fail(res, 400, 'validation', 'Enter a valid phone number.');
    if (phone !== (user.phone || '')) { changes.push('phone changed'); user.phone = phone; }
  }
  if (req.body.role !== undefined) {
    if (!ROLES.includes(req.body.role)) return fail(res, 400, 'validation', 'Invalid role.');
    if (req.body.role !== user.role) { changes.push(`role → ${req.body.role}`); user.role = req.body.role; }
  }
  if (req.body.active !== undefined && Boolean(req.body.active) !== (user.active !== false)) {
    user.active = Boolean(req.body.active);
    changes.push(user.active ? 'reactivated' : 'deactivated');
  }

  // Never leave the system without an active admin
  const losesAdmin = user.isModified('role') || user.isModified('active');
  if (losesAdmin && (user.role !== 'admin' || user.active === false)) {
    const otherAdmins = await User.countDocuments({ role: 'admin', active: { $ne: false }, _id: { $ne: user._id } });
    const wasAdmin = (await User.findById(user._id).lean()).role === 'admin';
    if (wasAdmin && otherAdmins === 0) return fail(res, 400, 'last_admin', 'There must be at least one active admin.');
  }
  if (same(user._id, req.user._id) && user.active === false) return fail(res, 400, 'validation', 'You cannot deactivate yourself.');

  if (!changes.length) return res.json({ user: dto(user) });
  await user.save();
  await logAudit({ user: req.user, action: 'user_changed', target: user.email, details: changes.join(', ') });
  res.json({ user: dto(user) });
});
