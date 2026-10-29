// Talks to a local Ollama server (https://ollama.com). Free: runs on your own computer.
// Conversation history is kept in the app's existing format and converted here on every call.
const fetchImpl = require('./fetchPolyfill');

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');

// Converts stored messages (text / tool_use / tool_result blocks) to Ollama's chat format.
function toOllamaMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  const toolNames = {};
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = blocks.filter(b => b.type === 'tool_use');
      calls.forEach(b => { toolNames[b.id] = b.name; });
      out.push({
        role: 'assistant', content: text,
        ...(calls.length ? { tool_calls: calls.map(b => ({ function: { name: b.name, arguments: b.input || {} } })) } : {})
      });
    } else {
      const results = blocks.filter(b => b.type === 'tool_result');
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      results.forEach(b => out.push({
        role: 'tool', tool_name: toolNames[b.tool_use_id] || 'tool',
        content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
      }));
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

/**
 * Streams one model turn. Returns { text, toolCalls: [{id,name,input}], inTok, outTok }.
 * onText(chunk) is called for every piece of text as it arrives.
 */
async function chatStream({ model, system, messages, tools, signal, onText }) {
  if (process.env.GROQ_API_KEY) return require('./groq').chatStream({ system, messages, tools, signal, onText });
  const body = {
    model,
    stream: true,
    think: process.env.OLLAMA_THINK === 'true',
    keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    messages: toOllamaMessages(system, messages),
    options: { num_ctx: Number(process.env.OLLAMA_NUM_CTX || 4096) },
    ...(tools && tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    } : {})
  };

  let res;
  try {
    res = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Cannot reach Ollama at ${OLLAMA_URL}. Is it running? (${e.message})`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Ollama answered ${res.status}: ${detail}`);
  }

  let text = ''; let inTok = 0; let outTok = 0; let buf = '';
  const toolCalls = [];
  const decoder = new TextDecoder();

  const handle = line => {
    if (!line.trim()) return;
    const j = JSON.parse(line);
    if (j.error) throw new Error(j.error);
    const m = j.message || {};
    if (m.content) { text += m.content; if (onText) onText(m.content); }
    for (const c of m.tool_calls || []) {
      let args = c.function && c.function.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      toolCalls.push({ id: `call_${Date.now().toString(36)}_${toolCalls.length}`, name: c.function.name, input: args || {} });
    }
    if (j.done) { inTok = j.prompt_eval_count || 0; outTok = j.eval_count || 0; }
  };

  for await (const chunk of res.body) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);
  return { text, toolCalls, inTok, outTok };
}

module.exports = { chatStream };
