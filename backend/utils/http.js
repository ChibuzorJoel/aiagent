const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, code, message) => res.status(status).json({ code, message });
const isId = v => /^[a-f\d]{24}$/i.test(String(v));
const same = (a, b) => String(a) === String(b);
const isBuilder = u => u.role === 'builder' || u.role === 'admin';
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function paging(req, def = 20) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || def, 1), 100);
  return { page, pageSize, skip: (page - 1) * pageSize };
}
const pageCount = (total, pageSize) => Math.max(Math.ceil(total / pageSize), 1);

module.exports = { wrap, fail, isId, same, isBuilder, esc, paging, pageCount };
