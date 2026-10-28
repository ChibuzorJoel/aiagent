// Makes sure a global fetch exists, even on older Node versions (before 18).
// Uses the built-in fetch when present, otherwise falls back to node-fetch v2.
if (typeof globalThis.fetch !== 'function') {
  const nf = require('node-fetch');
  globalThis.fetch = nf;
  globalThis.Headers = globalThis.Headers || nf.Headers;
  globalThis.Request = globalThis.Request || nf.Request;
  globalThis.Response = globalThis.Response || nf.Response;
  console.warn('[fetch] Global fetch missing (Node ' + process.version + '). Using node-fetch. Upgrading to Node 18+ is recommended.');
}
module.exports = globalThis.fetch;
