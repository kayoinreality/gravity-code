'use strict';

(() => {
  const api = window.gravity;
  const $ = (id) => document.getElementById(id);
  const el = {
    sessionList: $('session-list'), count: $('session-count'), title: $('session-title'),
    project: $('project-name'), folder: $('select-folder'), connectionDot: $('connection-dot'),
    connectionLabel: $('connection-label'), connectionMessage: $('connection-message'),
    connect: $('connect'), engineBanner: $('engine-banner'), engineMessage: $('engine-message'),
    engineProgress: $('engine-progress'), empty: $('empty-state'), messages: $('message-list'),
    scroll: $('conversation-scroll'), working: $('working-indicator'), permissions: $('permissions'),
    notice: $('notice'), form: $('composer-form'), composer: $('composer-text'), model: $('model-select'),
    modelHint: $('model-hint'), send: $('send'), cancel: $('cancel'), newSession: $('new-session'),
    version: $('version'),
  };
  let state = { sessions: [], models: [], connection: {}, engine: {} };
  let activeId = null;
  let loading = true;
  let submitting = false;
  let connecting = false;
  let choosingFolder = false;
  let messageSignature = '';
  let permissionSignature = '';
  const drafts = new Map();
  const modelChoices = new Map();
  const permissions = new Map();
  const permissionDecisions = new Set();
  const toolOpenState = new Map();
  const fallbackModels = [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon' },
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function currentSession() {
    return state.sessions.find((session) => session.id === activeId) || null;
  }

  function currentModel() {
    return modelChoices.get(activeId) || currentSession()?.model || 'gemini-3.8-flash';
  }

  function showNotice(message, error = false) {
    el.notice.textContent = message || '';
    el.notice.hidden = !message;
    el.notice.classList.toggle('error', error);
  }

  function errorMessage(error) {
    const message = error?.message || String(error || 'Não foi possível concluir a operação.');
    return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  }

  function checkResult(result) {
    if (result?.ok === false) throw new Error(result.message || result.error || 'Não foi possível concluir a operação.');
    return result;
  }

  function resizeComposer() {
    el.composer.style.height = 'auto';
    el.composer.style.height = `${Math.min(200, Math.max(68, el.composer.scrollHeight))}px`;
  }

  function setActive(id) {
    drafts.set(activeId, el.composer.value);
    activeId = id;
    el.composer.value = drafts.get(activeId) || '';
    messageSignature = '';
    permissionSignature = '';
    showNotice('');
    render();
    resizeComposer();
    el.scroll.scrollTop = el.scroll.scrollHeight;
    el.composer.focus();
  }

  function acceptState(next) {
    if (!next || !Array.isArray(next.sessions)) return;
    const previousId = activeId;
    state = { ...next, connection: next.connection || {}, engine: next.engine || {} };
    if (!activeId || !state.sessions.some((session) => session.id === activeId)) {
      activeId = state.activeId || state.sessions[0]?.id || null;
    }
    if (previousId !== activeId) {
      drafts.set(previousId, el.composer.value);
      el.composer.value = drafts.get(activeId) || '';
      messageSignature = '';
      permissionSignature = '';
      resizeComposer();
    }
    loading = false;
    render();
  }

  function renderSessions() {
    const focused = document.activeElement;
    const focusedSessionId = focused?.dataset?.sessionId;
    const nodes = [];
    for (const session of state.sessions) {
      const button = element('button', `session-button${session.id === activeId ? ' active' : ''}`);
      button.type = 'button';
      button.dataset.sessionId = session.id;
      button.title = session.title || 'Nova conversa';
      button.setAttribute('aria-current', session.id === activeId ? 'page' : 'false');
      const glyph = element('span', 'session-glyph', '◇');
      glyph.setAttribute('aria-hidden', 'true');
      button.append(glyph, element('span', 'session-label', session.title || 'Nova conversa'));
      if (session.busy || [...permissions.values()].some((item) => item.sessionId === session.id)) {
        const dot = element('span', 'session-busy');
        dot.setAttribute('aria-label', 'Em andamento');
        button.append(dot);
      }
      button.addEventListener('click', () => setActive(session.id));
      nodes.push(button);
    }
    if (!nodes.length) nodes.push(element('p', 'session-empty', 'Suas conversas aparecem aqui. Cada projeto começa com uma ideia.'));
    el.sessionList.replaceChildren(...nodes);
    el.count.textContent = String(state.sessions.length);
    if (focusedSessionId) [...el.sessionList.children].find((node) => node.dataset.sessionId === focusedSessionId)?.focus();
  }

  function formatDetail(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2) || ''; } catch { return String(value ?? ''); }
  }

  function renderMessages(session) {
    const messages = session?.messages || [];
    const signature = JSON.stringify([activeId, messages]);
    if (signature === messageSignature) return;
    const atBottom = el.scroll.scrollHeight - el.scroll.clientHeight - el.scroll.scrollTop < 85;
    const switched = !messageSignature;
    messageSignature = signature;
    const nodes = [];
    messages.forEach((message, messageIndex) => {
      const role = ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'system';
      const article = element('article', `message ${role}`);
      const meta = element('div', 'message-meta');
      const avatar = element('span', 'message-avatar', role === 'user' ? 'V' : role === 'assistant' ? 'g' : '·');
      avatar.setAttribute('aria-hidden', 'true');
      meta.append(avatar, element('span', '', role === 'user' ? 'Você' : role === 'assistant' ? 'Gravity' : 'Sistema'));
      article.append(meta);
      if (message.text) article.append(element('div', 'message-text', message.text));
      if (Array.isArray(message.tools) && message.tools.length) {
        const tools = element('div', 'tool-list');
        message.tools.forEach((tool, index) => {
          const key = `${activeId}:${message.id || messageIndex}:${index}`;
          const failed = /error|fail|denied|rejected|erro|negado/i.test(tool.status || '');
          const card = element('details', `tool-card${failed ? ' error' : ''}`);
          card.open = toolOpenState.get(key) || false;
          const summary = element('summary');
          summary.append(element('span', 'tool-icon', '⌁'), element('span', 'tool-name', tool.name || 'Ferramenta'), element('span', 'tool-status', toolStatus(tool.status)));
          card.append(summary, element('pre', 'tool-detail', formatDetail(tool.detail) || 'Sem detalhes adicionais.'));
          card.addEventListener('toggle', () => toolOpenState.set(key, card.open));
          tools.append(card);
        });
        article.append(tools);
      }
      nodes.push(article);
    });
    el.messages.replaceChildren(...nodes);
    el.empty.hidden = messages.length > 0;
    el.messages.hidden = !messages.length;
    if (atBottom || switched) requestAnimationFrame(() => { el.scroll.scrollTop = el.scroll.scrollHeight; });
  }

  function toolStatus(status) {
    const labels = { pending: 'Aguardando', running: 'Executando', completed: 'Concluído', complete: 'Concluído', success: 'Concluído', done: 'Concluído', error: 'Erro', failed: 'Falhou', denied: 'Negado', canceled: 'Cancelado', cancelled: 'Cancelado' };
    return labels[status] || status || 'Atividade';
  }

  function renderPermissions() {
    const items = [...permissions.values()].filter((permission) => permission.sessionId === activeId);
    const signature = JSON.stringify([items, [...permissionDecisions]]);
    if (signature === permissionSignature) return;
    permissionSignature = signature;
    const nodes = items.map((permission) => {
      const card = element('section', 'permission-card');
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Permissão para ${permission.toolName || 'ferramenta'}`);
      card.append(element('h2', 'permission-title', `Permitir ${permission.toolName || 'esta ferramenta'}?`));
      card.append(element('p', 'permission-description', 'Revise a ação abaixo. A autorização vale apenas para esta solicitação.'));
      card.append(element('pre', 'permission-input', formatDetail(permission.input)));
      const actions = element('div', 'permission-actions');
      const deny = element('button', '', 'Negar');
      const allow = element('button', 'allow', 'Permitir esta vez');
      deny.type = allow.type = 'button';
      deny.disabled = allow.disabled = permissionDecisions.has(permission.id);
      deny.addEventListener('click', () => decidePermission(permission.id, false));
      allow.addEventListener('click', () => decidePermission(permission.id, true));
      actions.append(deny, allow);
      card.append(actions);
      return card;
    });
    el.permissions.replaceChildren(...nodes);
  }

  function renderModels() {
    const models = state.models?.length ? state.models : fallbackModels;
    const signature = JSON.stringify(models);
    if (el.model.dataset.signature !== signature) {
      el.model.replaceChildren(...models.map((model) => {
        const option = element('option', '', model.label);
        option.value = model.id;
        return option;
      }));
      el.model.dataset.signature = signature;
    }
    const selected = currentModel();
    el.model.value = models.some((model) => model.id === selected) ? selected : models[0].id;
    el.modelHint.textContent = el.model.value.includes('argon') ? 'Use com atenção à sua cota' : 'Mais leve para o dia a dia';
    if(currentSession()?.requests) el.modelHint.textContent = `${currentSession().requests}/8 solicitações neste envio`;
  }

  function renderControls() {
    const session = currentSession();
    const busy = Boolean(session?.busy || submitting);
    el.send.hidden = Boolean(session?.busy);
    el.send.disabled = loading || busy || !el.composer.value.trim() || !state.connection.connected || !state.engine.ready;
    el.cancel.hidden = !session?.busy;
    el.model.disabled = busy;
    el.folder.disabled = busy || choosingFolder || loading;
    el.working.hidden = !session?.busy;
    el.connect.disabled = connecting || loading;
    el.newSession.disabled = loading || submitting;
  }

  function render() {
    const session = currentSession();
    el.version.textContent = `v${state.version || '0.1.0'}`;
    el.title.textContent = session?.title || 'Uma ideia. Seu próximo projeto.';
    const projectPath = session?.projectPath || '';
    el.project.textContent = projectPath ? projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath : 'Escolher pasta';
    el.folder.title = projectPath || 'Escolher pasta do projeto';
    el.connectionDot.classList.toggle('connected', Boolean(state.connection.connected));
    el.connectionLabel.textContent = state.connection.connected ? 'Gemini conectado' : 'Gemini desconectado';
    el.connectionMessage.textContent = state.connection.message || (state.connection.connected ? 'Sua conta Google está pronta para usar.' : 'Conecte sua conta para começar.');
    el.connect.replaceChildren(document.createTextNode(connecting ? 'Abrindo conexão…' : state.connection.connected ? 'Gerenciar conexão' : 'Conectar conta Google'), element('span', '', '↗'));
    el.engineBanner.classList.toggle('ready', Boolean(state.engine.ready));
    el.engineBanner.classList.toggle('error', Boolean(state.engine.error));
    el.engineMessage.textContent = state.engine.message || 'Preparando o motor local…';
    $('prepare-engine').hidden = Boolean(state.engine.ready);
    $('prepare-engine').disabled = Boolean(state.engine.busy);
    const progress = state.engine.progress;
    if (typeof progress === 'number' && Number.isFinite(progress)) el.engineProgress.value = Math.max(0, Math.min(100, progress));
    else el.engineProgress.removeAttribute('value');
    renderSessions();
    renderMessages(session);
    renderModels();
    renderPermissions();
    renderControls();
  }

  async function ensureSession() {
    if (currentSession()) return activeId;
    const previousDraft = el.composer.value;
    const result = await api.createSession();
    const id = typeof result === 'string' ? result : result?.id;
    if (!id) throw new Error('Não foi possível criar a conversa.');
    activeId = id;
    drafts.set(id, previousDraft);
    // The state event may arrive after the IPC reply.
    if (!state.sessions.some((session) => session.id === id)) acceptState(await api.getState());
    el.composer.value = previousDraft;
    return id;
  }

  async function createSession() {
    if (loading || submitting) return;
    try {
      const result = await api.createSession();
      const id = typeof result === 'string' ? result : result?.id;
      if (!id) throw new Error('Não foi possível criar a conversa.');
      if (!state.sessions.some((session) => session.id === id)) acceptState(await api.getState());
      setActive(id);
    } catch (error) { showNotice(errorMessage(error), true); }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = el.composer.value.trim();
    if (!text || submitting || currentSession()?.busy || loading) return;
    if (!state.connection.connected) return showNotice('Conecte sua conta Google antes de enviar.');
    if (!state.engine.ready) return showNotice('Aguarde a preparação do motor local antes de enviar.');
    const selectedModel = el.model.value;
    const submittedDraft = el.composer.value;
    submitting = true;
    showNotice('');
    renderControls();
    try {
      const id = await ensureSession();
      modelChoices.set(id, selectedModel);
      checkResult(await api.send({ sessionId: id, text, model: selectedModel }));
      // A user can continue typing while the first response is starting.
      if (activeId === id && el.composer.value === submittedDraft) {
        el.composer.value = '';
        drafts.set(id, '');
        resizeComposer();
      }
    } catch (error) { showNotice(errorMessage(error), true); }
    finally { submitting = false; renderControls(); el.composer.focus(); }
  }

  async function decidePermission(id, allow) {
    if (permissionDecisions.has(id)) return;
    permissionDecisions.add(id);
    renderPermissions();
    try {
      checkResult(await api.decidePermission({ id, allow }));
      permissions.delete(id);
    } catch (error) { showNotice(errorMessage(error), true); }
    finally { permissionDecisions.delete(id); renderPermissions(); renderSessions(); }
  }

  el.newSession.addEventListener('click', createSession);
  el.form.addEventListener('submit', sendMessage);
  el.composer.addEventListener('input', () => { drafts.set(activeId, el.composer.value); resizeComposer(); renderControls(); });
  el.composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); createSession(); }
  });
  el.model.addEventListener('change', () => { modelChoices.set(activeId, el.model.value); renderModels(); });
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
    el.composer.value = button.dataset.prompt;
    drafts.set(activeId, el.composer.value);
    resizeComposer();
    renderControls();
    el.composer.focus();
  }));
  el.folder.addEventListener('click', async () => {
    choosingFolder = true;
    renderControls();
    try {
      const id = await ensureSession();
      const result = await api.selectFolder(id);
      if (!result?.canceled) { showNotice(''); acceptState(await api.getState()); }
    } catch (error) { showNotice(errorMessage(error), true); }
    finally { choosingFolder = false; renderControls(); }
  });
  el.connect.addEventListener('click', async () => {
    connecting = true;
    render();
    try { checkResult(await api.connect()); }
    catch (error) { showNotice(errorMessage(error), true); }
    finally { connecting = false; render(); }
  });
  $('prepare-engine').addEventListener('click', async () => {
    try { checkResult(await api.prepareEngine()); }
    catch (error) { showNotice(errorMessage(error), true); }
  });
  el.cancel.addEventListener('click', async () => {
    if (!activeId) return;
    el.cancel.disabled = true;
    try { checkResult(await api.cancel(activeId)); }
    catch (error) { showNotice(errorMessage(error), true); }
    finally { el.cancel.disabled = false; }
  });

  render();
  if (!api) {
    loading = false;
    showNotice('Abra o Gravity Code pelo aplicativo para conectar o motor local.', true);
    renderControls();
    return;
  }
  api.onEvent((event) => {
    if (event?.type === 'state') acceptState(event.state);
    if (event?.type === 'permission' && event.permission?.id) {
      if(event.permission.closed) permissions.delete(event.permission.id);
      else permissions.set(event.permission.id, event.permission);
      renderPermissions();
      renderSessions();
    }
  });
  api.getState().then(acceptState).catch((error) => {
    loading = false;
    showNotice(errorMessage(error), true);
    renderControls();
  });
})();
