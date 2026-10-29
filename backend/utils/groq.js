// Free hosted model through Groq (OpenAI-compatible API). Used automatically when GROQ_API_KEY is set.
const fetchImpl = require('./fetchPolyfill');

const URL_ = 'https://api.groq.com/openai/v1/chat/completions';

function toMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === 'assistant') {
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = blocks.filter(b => b.type === 'tool_use');
      out.push({
        role: 'assistant', content: text || null,
        ...(calls.length ? { tool_calls: calls.map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } })) } : {})
      });
    } else {
      blocks.filter(b => b.type === 'tool_result').forEach(b => out.push({
        role: 'tool', tool_call_id: b.tool_use_id,
        content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
      }));
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

async function chatStream({ system, messages, tools, signal, onText }) {
  const body = {
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    stream: true,
    stream_options: { include_usage: true },
    messages: toMessages(system, messages),
    ...(tools && tools.length ? {
      tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
    } : {})
  };

  let res;
  try {
    res = await fetchImpl(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify(body), signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`Cannot reach Groq (${e.message})`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Groq answered ${res.status}: ${detail}`);
  }

  let text = ''; let inTok = 0; let outTok = 0; let buf = '';
  const calls = {};
  const decoder = new TextDecoder();

  const handle = line => {
    line = line.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const j = JSON.parse(data);
    if (j.error) throw new Error(j.error.message || 'Groq error');
    const u = j.usage || (j.x_groq && j.x_groq.usage);
    if (u) { inTok = u.prompt_tokens || inTok; outTok = u.completion_tokens || outTok; }
    const d = j.choices && j.choices[0] && j.choices[0].delta;
    if (!d) return;
    if (d.content) { text += d.content; if (onText) onText(d.content); }
    for (const c of d.tool_calls || []) {
      const k = c.index || 0;
      calls[k] = calls[k] || { id: c.id, name: '', args: '' };
      if (c.id) calls[k].id = c.id;
      if (c.function && c.function.name) calls[k].name += c.function.name;
      if (c.function && c.function.arguments) calls[k].args += c.function.arguments;
    }
  };

  for await (const chunk of res.body) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  handle(buf);

  const toolCalls = Object.keys(calls).sort((a, b) => a - b).map((k, n) => {
    let input = {}; try { input = JSON.parse(calls[k].args || '{}'); } catch (e) { /* keep empty */ }
    return { id: calls[k].id || `call_${Date.now().toString(36)}_${n}`, name: calls[k].name, input };
  });
  return { text, toolCalls, inTok, outTok };
}

module.exports = { chatStream };
