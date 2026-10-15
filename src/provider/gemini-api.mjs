import { randomUUID } from 'node:crypto';
import { compactSystem, trimDescription } from './protocol.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Documented placeholder for function calls whose original signature is unknown.
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

function apiError(status, body) {
  const detail = body?.error?.message ? `: ${String(body.error.message).slice(0, 300)}` : '';
  if (status === 400 && /api key/i.test(detail)) return new Error('Chave da API Gemini inválida.');
  if (status === 403) return new Error('Chave da API Gemini recusada ou sem permissão' + detail);
  if (status === 429) return new Error('Limite da API Gemini atingido (HTTP 429). Aguarde ou troque de modelo' + detail);
  return new Error(`A API Gemini retornou HTTP ${status}${detail}`);
}

export async function listApiModels(apiKey, fetcher = globalThis.fetch) {
  const response = await fetcher(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response.status, body);
  return (body.models ?? [])
    .filter(model => model.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(model.name) && !/embedding|image|tts|audio|live/i.test(model.name))
    .map(model => ({ id: model.name.replace(/^models\//, ''), label: model.displayName || model.name, inputTokenLimit: model.inputTokenLimit }));
}

function resultParts(content) {
  if (typeof content === 'string') return { text: content, media: [] };
  const texts = [], media = [];
  for (const block of content ?? []) {
    if (block?.type === 'text') texts.push(block.text);
    else if (['image', 'document'].includes(block?.type) && block.source?.type === 'base64') media.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
  }
  return { text: texts.join('\n'), media };
}

export function toGeminiRequest(request, { signatures = new Map(), compact = true } = {}) {
  const names = new Map(), contents = [];
  for (const message of request.messages ?? []) {
    const parts = [];
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
    let firstCall = true;
    for (const block of blocks) {
      if (block.type === 'text' && block.text) parts.push({ text: block.text });
      else if (block.type === 'tool_use') {
        names.set(block.id, block.name);
        const part = { functionCall: { name: block.name, args: block.input ?? {}, id: block.id } };
        const signature = signatures.get(block.id) ?? (firstCall ? SKIP_SIGNATURE : undefined);
        if (signature) part.thoughtSignature = signature;
        firstCall = false;
        parts.push(part);
      } else if (block.type === 'tool_result') {
        const { text, media } = resultParts(block.content);
        parts.push({ functionResponse: { name: names.get(block.tool_use_id) ?? 'tool', id: block.tool_use_id, response: block.is_error ? { error: text } : { output: text } } });
        parts.push(...media);
      } else if (['image', 'document'].includes(block.type) && block.source?.type === 'base64') {
        parts.push({ inlineData: { mimeType: block.source.media_type, data: block.source.data } });
      }
    }
    if (!parts.length) continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
    else contents.push({ role, parts });
  }
  const payload = { contents };
  const system = compactSystem(request.system, compact);
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const tools = (request.tools ?? []).filter(tool => tool?.name && tool.input_schema);
  if (tools.length) {
    payload.tools = [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: compact ? trimDescription(tool.description, 1200) : tool.description ?? '', parametersJsonSchema: tool.input_schema })) }];
    const choice = request.tool_choice;
    if (choice?.type === 'any') payload.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
    else if (choice?.type === 'tool') payload.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } };
    else if (choice?.type === 'none') payload.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }
  if (request.max_tokens) payload.generationConfig = { maxOutputTokens: Math.min(Number(request.max_tokens) || 8192, 65536) };
  return payload;
}

// Streams with SSE and aggregates into a single generateContent-like response.
export async function callGemini({ apiKey, model, payload, signal, onText, fetcher = globalThis.fetch }) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw new Error('Modelo da API inválido.');
  const response = await fetcher(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000),
  });
  if (!response.ok) throw apiError(response.status, await response.json().catch(() => ({})));
  const parts = [];
  let finishReason, usageMetadata, promptFeedback, text = '', buffer = '';
  const decoder = new TextDecoder();
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    let chunk; try { chunk = JSON.parse(line.slice(5).trim()); } catch { return; }
    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
    if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback;
    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      const last = parts.at(-1);
      if (typeof part.text === 'string' && !part.functionCall) {
        if (last && typeof last.text === 'string' && !!last.thought === !!part.thought) {
          last.text += part.text;
          if (part.thoughtSignature) last.thoughtSignature = part.thoughtSignature;
        } else parts.push({ ...part });
        if (!part.thought) { text += part.text; try { onText?.(text); } catch {} }
      } else parts.push({ ...part });
    }
  };
  const reader = response.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, index).trim()); buffer = buffer.slice(index + 1); }
  }
  handle((buffer + decoder.decode()).trim());
  return { candidates: parts.length || finishReason ? [{ content: { role: 'model', parts }, finishReason }] : [], usageMetadata, promptFeedback };
}

export function fromGeminiResponse(data, signatures = new Map(), tools) {
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error(data.promptFeedback?.blockReason ? `A API Gemini bloqueou a solicitação (${data.promptFeedback.blockReason}).` : 'A API Gemini não retornou resposta.');
  const allowed = tools ? new Set(tools.filter(t => t?.name).map(t => t.name)) : null;
  const content = [];
  for (const part of candidate.content?.parts ?? []) {
    if (part.thought) continue;
    if (typeof part.text === 'string' && part.text) {
      const last = content.at(-1);
      if (last?.type === 'text') last.text += part.text; else content.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      if (allowed && !allowed.has(part.functionCall.name)) throw new Error('O Gemini solicitou uma ferramenta inválida. Nenhuma ação foi executada.');
      const id = `toolu_${randomUUID().replaceAll('-', '')}`;
      if (part.thoughtSignature) signatures.set(id, part.thoughtSignature);
      content.push({ type: 'tool_use', id, name: part.functionCall.name, input: part.functionCall.args ?? {} });
    }
  }
  if (!content.length) content.push({ type: 'text', text: candidate.finishReason === 'MAX_TOKENS' ? '(Resposta interrompida pelo limite de tokens.)' : '(Resposta vazia.)' });
  const usage = data.usageMetadata ?? {};
  return { content, usage: { input_tokens: usage.promptTokenCount ?? 0, output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) } };
}
