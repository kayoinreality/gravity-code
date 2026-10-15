import { randomUUID, createHash } from 'node:crypto';

const FORMAT = `Responda com um único objeto JSON válido, sem bloco de código, exatamente no formato {"text":"sua mensagem","tool_calls":[{"name":"nome exato da ferramenta","input":{}}]}. Use tool_calls vazio para a resposta final. Agrupe no mesmo objeto todas as chamadas independentes possíveis (por exemplo, várias leituras ou buscas), porque cada resposta consome uma solicitação da cota. Solicite as chamadas em vez de apenas descrever o procedimento. Nunca solicite ferramentas ausentes da lista.`;

const AGENT_NOTE = `Roteamento de agentes: model="haiku" encaminha a tarefa para Gemini Flash; model="opus" ou model="sonnet" seguem o modelo principal. Delegue apenas quando realmente economizar etapas; cada agente consome solicitações próprias.`;

// Replaces the very long native harness prompt. The dynamic environment
// sections (<env>, git status) are preserved by compactSystem().
export const COMPACT_SYSTEM = `Você é um engenheiro de software sênior trabalhando no projeto do usuário por meio das ferramentas declaradas.
- Entenda antes de alterar: use Glob/Grep para localizar e Read para ler apenas o necessário.
- Prefira Edit com trechos exatos a reescrever arquivos com Write. Preserve estilo, comentários e convenções do projeto.
- Faça a menor mudança correta; não crie arquivos, dependências ou documentação sem necessidade.
- Use Bash para executar testes, builds e git. Evite comandos destrutivos e nunca exponha segredos.
- Não invente resultados. Se faltar informação essencial, pergunte ao usuário.
- Ao terminar, resuma em poucas linhas o que foi feito e como verificar. Responda no idioma do usuário (padrão: português do Brasil).`;

function systemText(system) {
  if (typeof system === 'string') return system;
  return (system ?? []).map(block => typeof block === 'string' ? block : block?.text ?? '').join('\n\n');
}

export function compactSystem(system, enabled = true) {
  const text = systemText(system).replace(/^x-anthropic-billing-header:.*$/gm, '').trim();
  if (!enabled || text.length <= 6000) return text;
  const keep = [];
  for (const tag of ['env', 'gravity-skills']) {
    for (const match of text.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))) keep.push(match[0]);
  }
  const git = text.match(/gitStatus:[\s\S]{0,1500}/);
  if (git) keep.push(git[0]);
  return [COMPACT_SYSTEM, ...keep].join('\n\n');
}

export function trimDescription(text = '', limit = 400) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const sentence = cut.lastIndexOf('. ');
  return (sentence > limit * 0.4 ? cut.slice(0, sentence + 1) : cut) + '…';
}

function compactSchema(schema) {
  if (Array.isArray(schema)) return schema.map(compactSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const output = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || (key === 'additionalProperties' && value === false)) continue;
    if (key === 'description') output[key] = trimDescription(value, 160);
    else if (key === 'properties' && value && typeof value === 'object') {
      output[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compactSchema(child)]));
    } else output[key] = compactSchema(value);
  }
  return output;
}

export function compactTools(tools = [], enabled = true) {
  const valid = (tools ?? []).filter(tool => tool?.name && tool.input_schema);
  if (!enabled) return valid.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  return valid.map(tool => ({ name: tool.name, description: trimDescription(tool.description, 400), input_schema: compactSchema(tool.input_schema) }));
}

function stripBlock(block) {
  if (!block || typeof block !== 'object') return block;
  const { cache_control, citations, ...rest } = block;
  if (Array.isArray(rest.content)) rest.content = rest.content.map(stripBlock);
  return rest;
}

export function cleanMessages(messages = []) {
  return (messages ?? []).map(message => {
    const content = typeof message.content === 'string' ? message.content
      : (message.content ?? []).filter(block => !['thinking', 'redacted_thinking'].includes(block.type)).map(stripBlock);
    if (Array.isArray(content)) {
      const nested = content.flatMap(block => [block, ...(Array.isArray(block.content) ? block.content : [])]);
      if (nested.some(block => ['image', 'document'].includes(block?.type))) {
        throw new Error('Imagens e documentos não são suportados pelo provedor Gemini Web. Use o provedor Gemini API.');
      }
    }
    return { role: message.role, content };
  });
}

export function toWebPrompt(request, modelLabel = '4 Argon', { compact = true } = {}) {
  const messages = cleanMessages(request.messages);
  const tools = compactTools(request.tools, compact);
  return `Você está conectado ao controlador de ferramentas do Gravity Code (harness do Claude Code). Provedor desta execução: Gemini ${modelLabel}.
O aplicativo executa as chamadas e devolve tool_result na próxima mensagem. Não invente resultados de ferramentas.
${FORMAT}
${tools.some(tool => tool.name === 'Agent') ? AGENT_NOTE + '\n' : ''}INSTRUÇÕES DO CONTROLADOR:
${compactSystem(request.system, compact)}
FERRAMENTAS DISPONÍVEIS:
${JSON.stringify(tools)}
ESCOLHA DE FERRAMENTA:
${JSON.stringify(request.tool_choice ?? { type: 'auto' })}
HISTÓRICO:
${JSON.stringify(messages)}`;
}

// Continuation of an existing Gemini conversation: only the messages added by
// the controller since our last reply are sent.
export function toDeltaPrompt(newMessages) {
  return `NOVAS MENSAGENS DO CONTROLADOR (continuação da mesma tarefa; instruções e ferramentas anteriores continuam valendo):
${JSON.stringify(cleanMessages(newMessages))}
${FORMAT}`;
}

function normalize(messages) {
  return (messages ?? []).map(message => [message.role, ...(typeof message.content === 'string'
    ? [['t', message.content.trim()]]
    : (message.content ?? []).flatMap(block => block.type === 'text' ? (String(block.text ?? '').trim() ? [['t', String(block.text).trim()]] : [])
      : block.type === 'tool_use' ? [['u', block.id]]
        : block.type === 'tool_result' ? [['r', block.tool_use_id]] : []))]);
}

export function fingerprint(messages) {
  return createHash('sha256').update(JSON.stringify(normalize(messages))).digest('hex');
}

export function findThread(threads, model, messages = []) {
  let best;
  for (const thread of threads ?? []) {
    if (thread?.model !== model || !Array.isArray(thread.metadata) || !thread.metadata[0]) continue;
    if (!(thread.count < messages.length) || messages[thread.count]?.role !== 'user') continue;
    if (best && thread.count <= best.count) continue;
    if (fingerprint(messages.slice(0, thread.count)) === thread.fingerprint) best = thread;
  }
  return best;
}

export function nextThread(model, messages, content, metadata) {
  const all = [...(messages ?? []), { role: 'assistant', content }];
  return { model, count: all.length, fingerprint: fingerprint(all), metadata, updatedAt: Date.now() };
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {} }
  return undefined;
}

export function parseReply(text, tools = []) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Resposta vazia do Gemini.');
  const reply = extractJson(raw);
  // Plain prose is accepted as a final answer: it executes nothing and avoids
  // wasting a quota request on a format error.
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) || !('tool_calls' in reply || 'text' in reply)) {
    return [{ type: 'text', text: raw }];
  }
  const calls = reply.tool_calls ?? [];
  if (!Array.isArray(calls) || (reply.text !== undefined && typeof reply.text !== 'string')) {
    throw new Error('Resposta do Gemini com formato inválido. Nenhuma ação foi executada.');
  }
  const allowed = new Map((tools ?? []).filter(t => t.name && t.input_schema).map(t => [t.name, t]));
  const content = reply.text ? [{ type: 'text', text: reply.text }] : [];
  for (const call of calls) {
    if (!allowed.has(call?.name) || !call.input || typeof call.input !== 'object' || Array.isArray(call.input)) {
      throw new Error('O Gemini solicitou uma ferramenta inválida. Nenhuma ação foi executada.');
    }
    content.push({ type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '')}`, name: call.name, input: call.input });
  }
  if (!content.length) throw new Error('Resposta vazia do Gemini.');
  return content;
}

// This is a local size estimate, not Google's usage or billing meter.
export function inputMetrics(request, modelLabel = '4 Argon', options) {
  const prompt = toWebPrompt(request, modelLabel, options);
  return {
    prompt, characters: prompt.length, estimatedInputTokens: Math.ceil(prompt.length / 4),
    systemCharacters: JSON.stringify(request.system ?? []).length,
    toolsCharacters: JSON.stringify((request.tools ?? []).filter(tool => tool.name && tool.input_schema)).length,
    messagesCharacters: JSON.stringify(request.messages ?? []).length,
  };
}

export function anthropicMessage(request, content, metrics = inputMetrics(request), usage) {
  return {
    id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', model: request.model ?? 'gemini-4-argon', content,
    stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: usage ?? { input_tokens: metrics.estimatedInputTokens, output_tokens: Math.ceil(JSON.stringify(content).length / 4) },
  };
}

export function asSSE(message) {
  const events = [];
  const emit = (type, value) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  emit('message_start', { message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } } });
  message.content.forEach((block, index) => {
    emit('content_block_start', { index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    emit('content_block_delta', { index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    emit('content_block_stop', { index });
  });
  emit('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } });
  emit('message_stop', {});
  return events.join('');
}
