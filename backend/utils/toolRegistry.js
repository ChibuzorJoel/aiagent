const { sendMail } = require('./mailer');
const Record = require('../models/Record');
const Knowledge = require('../models/Knowledge');
const KnowledgeChunk = require('../models/KnowledgeChunk');
const ToolConnection = require('../models/ToolConnection');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Every tool an agent can use. To add a tool, add an entry here; the Tools page, the agent editor,
 * the approval flow and the policies pick it up automatically.
 *   readOnly: true  -> runs straight away
 *   readOnly: false -> has side effects, so it asks for approval (unless the builder marked it "allowed")
 *   run(input, ctx) -> returns text for the model. ctx = { user, agent, dryRun }
 */
const TOOLS = {
  search_knowledge: {
    name: 'Search the knowledge base',
    description: 'Search the documents attached to this agent. Returns the best matching passages with their source names.',
    readOnly: true,
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Words to search for' } }, required: ['query'] },
    describe: i => `Search the knowledge base for "${String(i.query || '').slice(0, 80)}"`,
    testInput: { query: 'test' },
    async run(input, ctx) {
      const ids = (ctx.agent && ctx.agent.knowledgeIds) || [];
      if (!ids.length) return 'No documents are attached to this agent.';
      const q = String(input.query || '').slice(0, 200).trim();
      if (!q) throw new Error('A search query is required.');
      const hits = await KnowledgeChunk.find({ knowledgeId: { $in: ids }, $text: { $search: q } }, { score: { $meta: 'textScore' }, text: 1, knowledgeId: 1 })
        .sort({ score: { $meta: 'textScore' } }).limit(5).lean();
      if (!hits.length) return 'No matching passages were found.';
      const docs = await Knowledge.find({ _id: { $in: hits.map(h => h.knowledgeId) } }).select('name').lean();
      const names = new Map(docs.map(d => [String(d._id), d.name]));
      return hits.map(h => `[Source: ${names.get(String(h.knowledgeId)) || 'unknown'}]\n${h.text}`).join('\n\n---\n\n');
    }
  },

  get_current_time: {
    name: 'Get the current date and time',
    description: 'Returns the current date and time (UTC).',
    readOnly: true,
    input_schema: { type: 'object', properties: {} },
    describe: () => 'Read the current date and time',
    testInput: {},
    async run() { return new Date().toISOString(); }
  },

  send_email: {
    name: 'Send e-mail',
    description: 'Send an e-mail to one recipient. Use only when the user asked for an e-mail to be sent.',
    readOnly: false,
    input_schema: {
      type: 'object',
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
      required: ['to', 'subject', 'body']
    },
    describe: i => `Send an e-mail to ${i.to} with the subject "${String(i.subject || '').slice(0, 80)}"`,
    testInput: { to: 'test@example.com', subject: 'Test', body: 'Test' },
    async run(input, ctx) {
      const to = String(input.to || '').trim();
      if (!EMAIL_RE.test(to)) throw new Error('The recipient address is not valid.');
      const subject = String(input.subject || '').slice(0, 200);
      const body = String(input.body || '').slice(0, 10000);
      if (ctx.dryRun) return `Dry run only. Would send an e-mail to ${to}.`;
      const r = await sendMail({ to, subject, text: body });
      return r.sent ? `E-mail sent to ${to}.` : 'Mail is not configured on this server, so the e-mail was not delivered.';
    }
  },

  create_record: {
    name: 'Create a record',
    description: 'Save a new record (a title plus any fields) in the workspace.',
    readOnly: false,
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, fields: { type: 'object', description: 'Extra key/value details' } },
      required: ['title']
    },
    describe: i => `Create a record titled "${String(i.title || '').slice(0, 80)}"`,
    testInput: { title: 'Test record' },
    async run(input, ctx) {
      const title = String(input.title || '').trim().slice(0, 200);
      if (!title) throw new Error('A title is required.');
      if (ctx.dryRun) return `Dry run only. Would create a record titled "${title}".`;
      const fields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : {};
      const rec = await Record.create({ title, data: JSON.parse(JSON.stringify(fields)), createdBy: ctx.user._id, agentId: ctx.agent && ctx.agent._id });
      return `Record created with id ${rec._id}.`;
    }
  }
};
Object.entries(TOOLS).forEach(([key, def]) => { def.key = key; });

// Read-only tools are connected by default; tools with side effects must be connected by a builder
async function connectedKeys() {
  const rows = await ToolConnection.find().lean();
  const state = new Map(rows.map(r => [r.key, r.connected]));
  return new Set(Object.keys(TOOLS).filter(k => (state.has(k) ? state.get(k) : TOOLS[k].readOnly)));
}

module.exports = { TOOLS, connectedKeys };
