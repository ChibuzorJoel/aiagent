const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Knowledge = require('../models/Knowledge');
const KnowledgeChunk = require('../models/KnowledgeChunk');
const Agent = require('../models/Agent');
const { TYPES, extractFile, chunk, signatureOk, fetchPageText } = require('../utils/extract');
const { logAudit } = require('../utils/audit');
const { wrap, fail, isId, same, esc, paging, pageCount } = require('../utils/http');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    TYPES[path.extname(file.originalname).toLowerCase()] ? cb(null, true) : cb(new Error('That file type is not allowed. Use PDF, Word, text or an image.'))
}).single('file');

exports.handleUpload = (req, res, next) =>
  upload(req, res, err => err
    ? fail(res, 400, 'validation', err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (10 MB at most).' : err.message)
    : next());

const canSee = (k, u) => u.role === 'admin' || same(k.ownerId, u._id);
const dto = (k, agents = []) => ({
  id: k._id, name: k.name, type: k.type, size: k.size, status: k.status, error: k.error,
  chunks: k.chunks, url: k.url, createdAt: k.createdAt, ownerName: k.ownerName, agents
});

// Reads the source, splits it into pieces and stores them for searching
async function index(k) {
  try {
    await KnowledgeChunk.deleteMany({ knowledgeId: k._id });
    const text = k.type === 'web' ? await fetchPageText(k.url) : await extractFile(k.filePath, k.type);
    const parts = chunk(text);
    if (!parts.length) throw new Error('No readable text was found.');
    await KnowledgeChunk.insertMany(parts.map(t => ({ knowledgeId: k._id, text: t })));
    k.status = 'Ready'; k.error = ''; k.chunks = parts.length;
  } catch (e) {
    k.status = 'Failed'; k.error = e.message; k.chunks = 0;
  }
  await k.save();
}

async function loadOwned(req, res) {
  if (!isId(req.body.id)) { fail(res, 400, 'validation', 'Missing or invalid id.'); return null; }
  const k = await Knowledge.findById(req.body.id);
  if (!k || !canSee(k, req.user)) { fail(res, 404, 'not_found', 'Source not found.'); return null; }
  return k;
}

// GET /knowledge/list?q=&status=&page=
exports.list = wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req);
  const filter = req.user.role === 'admin' ? {} : { ownerId: req.user._id };
  if (req.query.q) filter.name = new RegExp(esc(String(req.query.q).slice(0, 60)), 'i');
  if (['Indexing', 'Ready', 'Failed'].includes(req.query.status)) filter.status = req.query.status;

  const [rows, total] = await Promise.all([
    Knowledge.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize),
    Knowledge.countDocuments(filter)
  ]);
  const agents = await Agent.find({ knowledgeIds: { $in: rows.map(r => r._id) } }).select('name knowledgeIds').lean();
  const used = id => agents.filter(a => a.knowledgeIds.some(k => same(k, id))).map(a => a.name);

  res.json({ sources: rows.map(r => dto(r, used(r._id))), total, page, pages: pageCount(total, pageSize) });
});

// POST /knowledge/add   multipart field "file"  OR  JSON { url }
exports.add = wrap(async (req, res) => {
  const url = String((req.body && req.body.url) || '').trim();
  let doc;

  if (req.file) {
    const type = TYPES[path.extname(req.file.originalname).toLowerCase()];
    if (!(await signatureOk(req.file.path, type))) {
      await fs.unlink(req.file.path).catch(() => {});
      return fail(res, 400, 'validation', 'That file does not look like a real ' + type + ' file.');
    }
    doc = await Knowledge.create({ name: req.file.originalname.slice(0, 120), type, size: req.file.size, filePath: req.file.path, ownerId: req.user._id, ownerName: req.user.name });
  } else if (url) {
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw new Error(); } catch (e) { return fail(res, 400, 'validation', 'Enter a valid web address starting with http or https.'); }
    doc = await Knowledge.create({ name: url.slice(0, 120), type: 'web', url, ownerId: req.user._id, ownerName: req.user.name });
  } else {
    return fail(res, 400, 'validation', 'Upload a file or add a web page link.');
  }

  await logAudit({ user: req.user, action: 'knowledge_added', target: doc.name });
  res.status(201).json({ source: dto(doc) });
  index(doc); // runs in the background; the page polls the list for the status
});

// POST /knowledge/reindex   { id }
exports.reindex = wrap(async (req, res) => {
  const k = await loadOwned(req, res);
  if (!k) return;
  k.status = 'Indexing'; k.error = '';
  await k.save();
  res.json({ source: dto(k) });
  index(k);
});

// POST /knowledge/delete   { id }
exports.remove = wrap(async (req, res) => {
  const k = await loadOwned(req, res);
  if (!k) return;
  await Promise.all([
    KnowledgeChunk.deleteMany({ knowledgeId: k._id }),
    Agent.updateMany({ knowledgeIds: k._id }, { $pull: { knowledgeIds: k._id } }),
    k.filePath ? fs.unlink(k.filePath).catch(() => {}) : null
  ]);
  await k.deleteOne();
  await logAudit({ user: req.user, action: 'knowledge_deleted', target: k.name });
  res.json({ ok: true });
});
