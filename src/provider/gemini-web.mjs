import { randomUUID } from 'node:crypto';
import { bootstrapGemini } from './session-common.mjs';

export function parseFrames(text) {
  const result = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('[')) continue;
    try { const frame = JSON.parse(line); if (Array.isArray(frame)) result.push(...frame); } catch {}
  }
  return result.filter(Array.isArray);
}

export class GeminiWeb {
  constructor(session, fetcher = globalThis.fetch) {
    this.session = session; this.fetcher = fetcher;
    this.requestId = 10000 + Math.floor(Math.random() * 90000);
    this.clientSession = randomUUID();
  }
  params(extra = {}) {
    this.requestId += 100000;
    return new URLSearchParams({ hl: 'pt-BR', _reqid: String(this.requestId), rt: 'c',
      ...(this.bootstrap.buildLabel ? { bl: this.bootstrap.buildLabel } : {}),
      ...(this.bootstrap.sessionId ? { 'f.sid': this.bootstrap.sessionId } : {}), ...extra });
  }
  async post(path, params, payload, headers = {}, signal, onFrame) {
    const url = `https://gemini.google.com${path}?${params}`;
    const response = await this.fetcher(url, {
      method: 'POST', redirect: 'manual', signal: signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000),
      headers: { Cookie: this.session.cookieHeader(url), Origin: 'https://gemini.google.com',
        Referer: 'https://gemini.google.com/app', 'X-Same-Domain': '1',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', ...headers },
      body: new URLSearchParams({ at: this.bootstrap.csrf, 'f.req': JSON.stringify(payload) }),
    });
    if (!response.ok) throw new Error(response.status===429?'O Gemini recusou por excesso de solicitações (HTTP 429). Aguarde ou troque de modelo.':`O Gemini retornou HTTP ${response.status}.`);
    if (!onFrame || !response.body?.getReader) { const frames=parseFrames(await response.text()); frames.forEach(f=>onFrame?.(f)); return frames; }
    const reader = response.body.getReader(), decoder = new TextDecoder(), frames = [];
    let buffer = '';
    const flush = (text) => { for (const frame of parseFrames(text)) { frames.push(frame); onFrame(frame); } };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { flush(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    flush(buffer + decoder.decode());
    return frames;
  }
  async initialize() {
    this.bootstrap = await bootstrapGemini(this.session, this.fetcher);
    const frames = await this.post('/_/BardChatUi/data/batchexecute', this.params({ rpcids: 'otAQ7b', 'source-path': '/app' }), [[['otAQ7b', '[]', null, 'generic']]], {
      'x-goog-ext-525001261-jspb': JSON.stringify([1,null,null,null,null,null,null,null,[4,5,6,8],null,null,null,null,null,null,null,this.clientSession]),
      'x-goog-ext-73010989-jspb': '[0]',
    });
    const frame = frames.find(f => f[0] === 'wrb.fr' && f[1] === 'otAQ7b' && typeof f[2] === 'string');
    if (!frame) throw new Error('O protocolo de descoberta de modelos do Gemini mudou.');
    const status = JSON.parse(frame[2]);
    this.accountStatus = status[14];
    const tier = status[16] ?? [], capabilities = status[17] ?? [];
    const capacity = tier.includes(21) ? [1,13] : tier.includes(22) ? [2,13] : capabilities.includes(115) ? [4,12]
      : tier.includes(16) || capabilities.includes(106) ? [3,12] : tier.includes(8) || capabilities.includes(19) ? [2,12] : [1,12];
    this.models = (status[15] ?? []).filter(m => Array.isArray(m) && typeof m[0] === 'string').map(m => ({
      id: m[0], category: m[1] || m[10] || '', label: m[11] || m[19] || m[1] || '',
      number: Number.isInteger(m[17]) ? m[17] : Number.isInteger(m[9]) ? m[9] : 1,
      capacity: capacity[0], capacityField: capacity[1],
    }));
    if (!this.models.length) throw new Error('A conta não retornou modelos disponíveis.');
    return this;
  }
  selectArgon() {
    const matches = this.models.filter(m => /argon/i.test(`${m.category} ${m.label}`));
    if (matches.length !== 1) throw new Error('Argon não foi identificado de forma inequívoca no catálogo desta sessão.');
    return matches[0];
  }
  // Models exposed to the interface. Flash and Argon keep stable aliases.
  publicModels() {
    return this.models.map(m => {
      const category = m.category.toLowerCase();
      const id = category === 'flash' ? 'gemini-3.8-flash' : /argon/.test(category) ? 'gemini-4-argon' : `gemini-web-${m.id}`;
      return { id, label: m.label || m.category || m.id, category: m.category };
    }).filter((m, index, all) => all.findIndex(other => other.id === m.id) === index);
  }
  resolveModel(requested = 'gemini-4-argon') {
    const name = requested.toLowerCase();
    let matches;
    if (name.startsWith('gemini-web-')) matches = this.models.filter(m=>m.id.toLowerCase()===name.slice(11));
    else if (/argon|sonnet|opus/.test(name)) matches = this.models.filter(m=>/argon/i.test(m.category));
    else if (/flash-lite/.test(name)) matches = this.models.filter(m=>/flash-lite/i.test(m.category));
    else if (/flash|haiku/.test(name)) matches = this.models.filter(m=>m.category.toLowerCase()==='flash');
    else matches=this.models.filter(m=>m.id.toLowerCase()===name||m.category.toLowerCase()===name||m.label.toLowerCase()===name);
    if(matches.length!==1) throw new Error(`Modelo solicitado não identificado no catálogo: ${requested}.`);
    return matches[0];
  }
  // metadata = [conversationId, responseId, choiceId] from a previous reply.
  async generate(prompt, model, signal, { metadata, onText } = {}) {
    const request = Array(81).fill(null);
    request[0] = [prompt,0,null,[],null,null,0]; request[1] = ['pt-BR'];
    request[2] = [metadata?.[0] || '', metadata?.[1] || '', metadata?.[2] || '', null, null, null, null, null, null, ''];
    for (const index of [7,10,27,45,68]) request[index] = 1;
    request[6]=[1]; request[11]=0; request[17]=[[0]]; request[18]=0;
    request[30]=[4]; request[41]=[1]; request[53]=0; request[61]=[];
    request[59]=randomUUID().toUpperCase(); request[79]=model.number; request[80]=1;
    const modelHeader = [1,null,null,null,model.id,null,null,0,[4,5,6,8],null,null];
    if (model.capacityField === 13) modelHeader.push(null);
    modelHeader.push(model.capacity,null,null,model.number,1,this.clientSession);
    let text = '', candidateId, conversation = [];
    const onFrame = (frame) => {
      const errorCode = frame[5]?.[2]?.[0]?.[1]?.[0];
      if (errorCode) throw new Error(`O Gemini recusou a geração (código ${errorCode}).`);
      if (typeof frame[2] !== 'string') return;
      let body; try { body=JSON.parse(frame[2]); } catch { return; }
      if (Array.isArray(body?.[1]) && typeof body[1][0] === 'string') conversation = body[1];
      const candidate = body?.[4]?.[0];
      if (candidate && typeof candidate[1]?.[0] === 'string') {
        const changed = candidate[1][0] !== text;
        text = candidate[1][0]; candidateId = candidate[0];
        if (changed) { try { onText?.(text); } catch {} }
      }
    };
    await this.post('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate', this.params(), [null,JSON.stringify(request)], {
      'x-goog-ext-525001261-jspb': JSON.stringify(modelHeader),
      'x-goog-ext-73010989-jspb': '[0]', 'x-goog-ext-73010990-jspb': '[0,0,0]',
      'x-goog-ext-525005358-jspb': JSON.stringify([request[59],1]),
    }, signal, onFrame);
    if (!text) throw new Error('O Gemini não retornou texto; a geração não foi validada.');
    const nextMetadata = conversation[0] ? [conversation[0], conversation[1] || '', candidateId || ''] : undefined;
    return { text, metadata: nextMetadata, selectedModel: { id: model.id, label: model.label, category: model.category }, candidatePresent: !!candidateId };
  }
}
