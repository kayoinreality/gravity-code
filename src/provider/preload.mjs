import { loadDesktopSession, desktopSessionAvailable, notifyDesktopAuthRequired } from './engine-session.mjs';
import { GeminiWeb } from './gemini-web.mjs';
import { toGeminiRequest, callGemini, fromGeminiResponse } from './gemini-api.mjs';
import { inputMetrics, parseReply, anthropicMessage, asSSE, toWebPrompt, toDeltaPrompt, findThread, nextThread } from './protocol.mjs';

// The preload belongs to this client, not to unrelated Bun programs run by tools.
delete process.env.BUN_OPTIONS;
const projectDirectory = process.env.GRAVITY_PROJECT_DIR;
delete process.env.GRAVITY_PROJECT_DIR;
if (projectDirectory) {
  try { process.chdir(projectDirectory); } catch {}
}

const nativeFetch = globalThis.fetch.bind(globalThis);
let session, clientPromise, turn = 0;
const signatures = new Map();

function trace(event, details = {}) {
  if (process.env.GEMINI_NATIVE_TRACE !== '1') return;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, pid: process.pid, ...details });
  console.error(line);
}

async function getSession() {
  if (!session) {
    if (!desktopSessionAvailable) throw new Error('Inicie esta sessão pelo aplicativo Gravity Code.');
    session = await loadDesktopSession();
  }
  return session;
}

async function webClient() {
  if (!clientPromise) clientPromise = (async () => {
    const sess = await getSession();
    const value = await new GeminiWeb(sess, nativeFetch).initialize();
    trace('google_authenticated', { models: value.models.map(m => ({ id: m.id, label: m.label })) });
    return value;
  })().catch(async error => {
    session?.clear();
    clientPromise = undefined;
    if (error.code === 'GRAVITY_AUTH_REQUIRED') await notifyDesktopAuthRequired().catch(() => {});
    throw error;
  });
  return clientPromise;
}

process.on('exit', () => session?.clear());
trace('provider_loaded', { runtime: process.versions.bun || process.versions.node, transport: 'same-process-fetch' });

globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (url.hostname !== 'gemini-native.invalid') return nativeFetch(input, init);

  try {
    const rawBody = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : {};

    if (url.pathname.endsWith('/messages/count_tokens')) {
      return Response.json({ input_tokens: inputMetrics(body).estimatedInputTokens });
    }
    if (!url.pathname.endsWith('/messages')) {
      return Response.json({ error: { type: 'invalid_request_error', message: 'Endpoint não implementado.' } }, { status: 404 });
    }

    const sess = await getSession();
    await sess.refresh?.();
    const state = (await sess.state?.()) || {};
    const useApi = state.provider === 'api' || Boolean(state.apiKey);

    if (useApi) {
      // Official Gemini API mode
      const apiKey = state.apiKey || sess.apiKey?.();
      const model = (body.model || 'gemini-2.5-flash').replace(/^gemini-3\.8-flash$/, 'gemini-2.5-flash').replace(/^gemini-4-argon$/, 'gemini-2.5-pro');
      
      // Load saved thought signatures
      if (state.signatures) {
        for (const [id, sig] of Object.entries(state.signatures)) signatures.set(id, sig);
      }

      const payload = toGeminiRequest(body, { signatures, compact: true });
      const metrics = inputMetrics(body, model, { compact: true });
      await sess.consume({ model, estimatedInputTokens: metrics.estimatedInputTokens });

      trace('gemini_api_request', { model, tools: (body.tools ?? []).map(t => t.name) });
      const result = await callGemini({
        apiKey,
        model,
        payload,
        signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
        fetcher: nativeFetch,
      });

      const parsed = fromGeminiResponse(result, signatures, body.tools);
      if (signatures.size) {
        await sess.saveSignatures?.(Object.fromEntries(signatures)).catch(() => {});
      }
      await sess.report?.(parsed.usage).catch(() => {});

      const message = anthropicMessage(body, parsed.content, metrics, parsed.usage);
      trace('gemini_api_response', { turn: ++turn, model, toolCalls: parsed.content.filter(c => c.type === 'tool_use').map(c => c.name) });

      return body.stream
        ? new Response(asSSE(message), { headers: { 'Content-Type': 'text/event-stream', 'request-id': message.id } })
        : Response.json(message, { headers: { 'request-id': message.id } });
    }

    // Gemini Web mode with conversation continuation delta
    const provider = await webClient();
    const selected = provider.resolveModel(body.model);
    const existingThreads = state.threads || [];
    const thread = findThread(existingThreads, selected.id, body.messages);

    let prompt, metadata;
    if (thread) {
      // Re-use conversation context! Only send messages received since previous turn.
      const newMessages = body.messages.slice(thread.count);
      prompt = toDeltaPrompt(newMessages);
      metadata = thread.metadata;
      trace('gemini_conversation_continuation', { previousCount: thread.count, newMessages: newMessages.length });
    } else {
      prompt = toWebPrompt(body, selected.label, { compact: true });
      metadata = undefined;
      trace('gemini_conversation_fresh', { totalMessages: (body.messages ?? []).length });
    }

    const metrics = inputMetrics(body, selected.label, { compact: true });
    await sess.consume({ model: body.model, estimatedInputTokens: metrics.estimatedInputTokens });

    const generated = await provider.generate(
      prompt,
      selected,
      init?.signal ?? (input instanceof Request ? input.signal : undefined),
      { metadata }
    );

    const content = parseReply(generated.text, body.tools);
    const message = anthropicMessage(body, content, metrics);

    // Save continuation thread
    if (generated.metadata) {
      const next = nextThread(selected.id, body.messages, content, generated.metadata);
      await sess.saveThread?.(next).catch(() => {});
    }

    trace('gemini_response', {
      turn: ++turn,
      requestedModel: body.model,
      modelId: generated.selectedModel.id,
      toolCalls: content.filter(c => c.type === 'tool_use').map(c => c.name),
    });

    return body.stream
      ? new Response(asSSE(message), { headers: { 'Content-Type': 'text/event-stream', 'request-id': message.id } })
      : Response.json(message, { headers: { 'request-id': message.id } });
  } catch (error) {
    trace('provider_error', { message: error.message });
    const auth = error.code === 'GRAVITY_AUTH_REQUIRED';
    return Response.json(
      { type: 'error', error: { type: auth ? 'authentication_error' : 'invalid_request_error', message: error.message } },
      { status: auth ? 401 : 400 }
    );
  }
};
