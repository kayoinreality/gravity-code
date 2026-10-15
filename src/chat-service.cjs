'use strict';

class ChatSession {
  constructor({ provider, getGoogleSession, getApiKey, getWebClient, models }) {
    this.provider = provider || 'web'; // 'web' or 'api'
    this.getGoogleSession = getGoogleSession;
    this.getApiKey = getApiKey;
    this.getWebClient = getWebClient;
    this.models = models;
    this.conversationMetadata = null; // [cid, rid, rcid] for Web
    this.abortController = null;
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async send({ messages = [], model, skillsPrompt = '', onText }) {
    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const apiKey = this.getApiKey?.();
    const isApi = this.provider === 'api' || (!this.provider && Boolean(apiKey));

    if (isApi) {
      const { callGemini } = await import('./provider/gemini-api.mjs');
      if (!apiKey) throw new Error('Configure a chave da API Gemini nas configurações.');

      const apiModel = (model || 'gemini-2.5-flash')
        .replace(/^gemini-3\.8-flash$/, 'gemini-2.5-flash')
        .replace(/^gemini-4-argon$/, 'gemini-2.5-pro');

      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text || '' }],
      }));

      const payload = { contents };
      if (skillsPrompt) {
        payload.systemInstruction = { parts: [{ text: skillsPrompt }] };
      }

      let accumulated = '';
      const result = await callGemini({
        apiKey,
        model: apiModel,
        payload,
        signal,
        onText: (chunk) => {
          accumulated = chunk;
          onText?.(accumulated);
        },
        fetcher: globalThis.fetch,
      });

      const candidate = result.candidates?.[0];
      const part = candidate?.content?.parts?.find(p => typeof p.text === 'string');
      const text = part?.text || accumulated || '(Sem resposta)';
      return { text, model: apiModel };
    }

    // Gemini Web mode
    const webClient = await this.getWebClient();
    const selected = webClient.resolveModel(model || 'gemini-3.8-flash');

    // Build prompt: in conversational mode, if metadata is available, send just the last user message;
    // otherwise send the messages sequence.
    const lastUserMsg = messages.filter(m => m.role === 'user').at(-1)?.text || '';
    let prompt;
    if (this.conversationMetadata) {
      prompt = lastUserMsg;
    } else {
      const formatted = messages.map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.text}`).join('\n\n');
      prompt = skillsPrompt ? `${skillsPrompt}\n\n${formatted}` : formatted;
    }

    let accumulated = '';
    const generated = await webClient.generate(
      prompt,
      selected,
      signal,
      {
        metadata: this.conversationMetadata,
        onText: (text) => {
          accumulated = text;
          onText?.(accumulated);
        },
      }
    );

    if (generated.metadata) {
      this.conversationMetadata = generated.metadata;
    }

    return { text: generated.text || accumulated, model: generated.selectedModel.label || selected.label };
  }
}

module.exports = { ChatSession };
