const fs = require('fs/promises');
const dns = require('dns').promises;
const net = require('net');

const TYPES = {
  '.pdf': 'pdf', '.docx': 'docx', '.txt': 'text', '.md': 'text', '.csv': 'text',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image'
};

async function extractFile(filePath, type) {
  if (type === 'text') return fs.readFile(filePath, 'utf8');
  if (type === 'pdf') {
    const pdf = require('pdf-parse');
    return (await pdf(await fs.readFile(filePath))).text;
  }
  if (type === 'docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ path: filePath })).value;
  }
  throw new Error('Images are stored but cannot be searched yet (no OCR is configured).');
}

// Split text into overlapping pieces for searching
function chunk(text, size = 1000, overlap = 150) {
  const clean = String(text).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    const piece = clean.slice(i, i + size).trim();
    if (piece.length > 20) out.push(piece);
    if (i + size >= clean.length) break;
  }
  return out;
}

// Magic-byte check so a renamed file cannot pass as a PDF or Word document
async function signatureOk(filePath, type) {
  if (type === 'text') return true;
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    if (type === 'pdf') return buf.toString('latin1') === '%PDF';
    if (type === 'docx') return buf[0] === 0x50 && buf[1] === 0x4b;
    if (type === 'image') return (buf[0] === 0x89 && buf[1] === 0x50) || (buf[0] === 0xff && buf[1] === 0xd8) || buf.toString('latin1') === 'RIFF';
    return false;
  } finally {
    await fh.close();
  }
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref();
  return c.signal;
}

// Fetches a public web page and returns its readable text. Refuses private/internal addresses and redirects.
async function fetchPageText(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https links are allowed.');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('That address is not allowed.');

  const res = await fetch(u, { redirect: 'error', signal: timeoutSignal(15000), headers: { 'User-Agent': 'AgentWorkspaceBot/1.0' } });
  if (!res.ok) throw new Error(`The page answered with status ${res.status}.`);
  if (!/text\/|html/i.test(res.headers.get('content-type') || '')) throw new Error('That link is not a web page.');

  const html = (await res.text()).slice(0, 2000000);
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { TYPES, extractFile, chunk, signatureOk, fetchPageText };
