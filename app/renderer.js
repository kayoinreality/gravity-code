'use strict';

(() => {
  const api = window.gravity;
  const $ = (id) => document.getElementById(id);

  const el = {
    sessionList: $('session-list'),
    count: $('session-count'),
    title: $('session-title'),
    eyebrow: $('session-eyebrow'),
    project: $('project-name'),
    folder: $('select-folder'),
    tabCode: $('tab-mode-code'),
    tabChat: $('tab-mode-chat'),
    gitBadge: $('project-git-badge'),
    gitBranch: $('git-branch-label'),
    gitDirty: $('git-dirty-count'),
    skillsButton: $('skills-button'),
    skillsButtonLabel: $('skills-button-label'),
    activeSkillsSummary: $('active-skills-summary'),
    connectionDot: $('connection-dot'),
    connectionLabel: $('connection-label'),
    connectionMessage: $('connection-message'),
    connect: $('connect'),
    githubDot: $('github-dot'),
    githubLabel: $('github-label'),
    usageWidget: $('usage-widget'),
    usageRequests: $('usage-requests'),
    usageProgressBar: $('usage-progress-bar'),
    usageTokens: $('usage-tokens'),
    engineBanner: $('engine-banner'),
    engineMessage: $('engine-message'),
    engineProgress: $('engine-progress'),
    prepareEngine: $('prepare-engine'),
    empty: $('empty-state'),
    emptyEyebrow: $('empty-eyebrow'),
    emptyTitle: $('empty-title'),
    emptySubtitle: $('empty-subtitle'),
    suggestions: $('suggestions-container'),
    messages: $('message-list'),
    scroll: $('conversation-scroll'),
    working: $('working-indicator'),
    workingText: $('working-text'),
    permissions: $('permissions'),
    notice: $('notice'),
    form: $('composer-form'),
    composer: $('composer-text'),
    model: $('model-select'),
    modelHint: $('model-hint'),
    quotaNote: $('composer-quota-note'),
    send: $('send'),
    cancel: $('cancel'),
    newCodeSession: $('new-code-session'),
    newChatSession: $('new-chat-session'),
    openSettings: $('open-settings'),
    version: $('version'),
    // Modals
    skillsModal: $('skills-modal'),
    skillsList: $('skills-list'),
    skillsCountInfo: $('skills-count-info'),
    closeSkillsModal: $('close-skills-modal'),
    skillsDoneBtn: $('skills-done-btn'),
    refreshSkillsBtn: $('refresh-skills-btn'),
    settingsModal: $('settings-modal'),
    closeSettingsModal: $('close-settings-modal'),
    saveSettingsBtn: $('save-settings-btn'),
    providerWeb: $('provider-web'),
    providerApi: $('provider-api'),
    apiKeyGroup: $('api-key-group'),
    apiKeyInput: $('gemini-api-key'),
    settingsGithubInfo: $('settings-github-info'),
    enableAgentToggle: $('setting-enable-agent'),
    maxRequestsSelect: $('setting-max-requests'),
    customSkillsPath: $('custom-skills-path'),
  };

  let state = { sessions: [], models: [], connection: {}, engine: {}, settings: {}, skills: [], git: {}, dailyUsage: {} };
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
    { id: 'gemini-3.8-flash', label: 'Gemini Flash' },
    { id: 'gemini-4-argon', label: 'Gemini Argon' },
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
    el.composer.style.height = `${Math.min(220, Math.max(64, el.composer.scrollHeight))}px`;
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
    state = {
      ...next,
      connection: next.connection || {},
      engine: next.engine || {},
      settings: next.settings || {},
      skills: next.skills || [],
      git: next.git || {},
      dailyUsage: next.dailyUsage || {},
    };
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

  // SESSIONS LIST
  function renderSessions() {
    const nodes = [];
    for (const session of state.sessions) {
      const button = element('button', `session-button${session.id === activeId ? ' active' : ''}`);
      button.type = 'button';
      button.dataset.sessionId = session.id;
      button.title = session.title || 'Nova conversa';
      button.setAttribute('aria-current', session.id === activeId ? 'page' : 'false');

      const modeBadge = element('span', 'session-mode-badge', session.mode === 'chat' ? '💬' : '⌨');
      modeBadge.setAttribute('aria-hidden', 'true');

      const label = element('span', 'session-label', session.title || 'Nova conversa');
      button.append(modeBadge, label);

      if (session.busy || [...permissions.values()].some((item) => item.sessionId === session.id)) {
        const dot = element('span', 'session-busy');
        dot.setAttribute('aria-label', 'Em andamento');
        button.append(dot);
      }

      const deleteBtn = element('button', 'session-delete-btn', '✕');
      deleteBtn.type = 'button';
      deleteBtn.title = 'Excluir conversa';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await api.deleteSession(session.id);
        acceptState(await api.getState());
      });
      button.append(deleteBtn);

      button.addEventListener('click', () => setActive(session.id));
      nodes.push(button);
    }

    if (!nodes.length) {
      nodes.push(element('p', 'session-empty', 'Suas conversas aparecem aqui. Escolha Modo Code para projetos ou Modo Chat para conversas diretas.'));
    }
    el.sessionList.replaceChildren(...nodes);
    el.count.textContent = String(state.sessions.length);
  }

  // SIMPLE MARKDOWN PARSER (Safe without HTML injection)
  function renderMarkdown(text) {
    const container = document.createElement('div');
    container.className = 'message-text';
    const lines = text.split('\n');
    let inCode = false;
    let codeBuffer = [];

    const flushCode = () => {
      if (!codeBuffer.length) return;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeBuffer.join('\n');
      pre.appendChild(code);
      container.appendChild(pre);
      codeBuffer = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        if (inCode) {
          inCode = false;
          flushCode();
        } else {
          inCode = true;
          codeBuffer = [];
        }
        continue;
      }
      if (inCode) {
        codeBuffer.push(line);
        continue;
      }

      if (line.startsWith('# ')) {
        const h1 = document.createElement('h1');
        h1.textContent = line.slice(2);
        container.appendChild(h1);
      } else if (line.startsWith('## ')) {
        const h2 = document.createElement('h2');
        h2.textContent = line.slice(3);
        container.appendChild(h2);
      } else if (line.startsWith('### ')) {
        const h3 = document.createElement('h3');
        h3.textContent = line.slice(4);
        container.appendChild(h3);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        const li = document.createElement('li');
        formatInline(line.slice(2), li);
        let ul = container.lastElementChild;
        if (!ul || ul.tagName !== 'UL') {
          ul = document.createElement('ul');
          container.appendChild(ul);
        }
        ul.appendChild(li);
      } else if (line.trim()) {
        const p = document.createElement('p');
        formatInline(line, p);
        container.appendChild(p);
      }
    }
    if (inCode) flushCode();
    return container;
  }

  function formatInline(text, parent) {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        const code = document.createElement('code');
        code.textContent = part.slice(1, -1);
        parent.appendChild(code);
      } else if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part) {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  function renderDiffView(detail) {
    let input;
    try { input = typeof detail === 'string' ? JSON.parse(detail) : detail; } catch { input = detail; }
    if (!input || typeof input !== 'object') return null;

    const filePath = input.file_path || input.path;
    const oldString = input.old_string;
    const newString = input.new_string;

    if (filePath && (oldString !== undefined || newString !== undefined)) {
      const card = element('div', 'diff-container');
      const header = element('div', 'diff-file-header', `📝 ${filePath}`);
      card.appendChild(header);

      if (oldString) {
        for (const line of String(oldString).split('\n')) {
          const l = element('div', 'diff-line del', `- ${line}`);
          card.appendChild(l);
        }
      }
      if (newString) {
        for (const line of String(newString).split('\n')) {
          const l = element('div', 'diff-line add', `+ ${line}`);
          card.appendChild(l);
        }
      }
      return card;
    }
    return null;
  }

  function formatDetail(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2) || ''; } catch { return String(value ?? ''); }
  }

  function renderMessages(session) {
    const messages = session?.messages || [];
    const signature = JSON.stringify([activeId, messages]);
    if (signature === messageSignature) return;

    const atBottom = el.scroll.scrollHeight - el.scroll.clientHeight - el.scroll.scrollTop < 95;
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

      if (message.text) {
        article.append(renderMarkdown(message.text));
      }

      if (Array.isArray(message.tools) && message.tools.length) {
        const tools = element('div', 'tool-list');
        message.tools.forEach((tool, index) => {
          const key = `${activeId}:${message.id || messageIndex}:${index}`;
          const failed = /error|fail|denied|rejected|erro|negado/i.test(tool.status || '');
          const card = element('details', `tool-card${failed ? ' error' : ''}`);
          card.open = toolOpenState.get(key) || false;

          const summary = element('summary');
          summary.append(
            element('span', 'tool-icon', '⌁'),
            element('span', 'tool-name', tool.name || 'Ferramenta'),
            element('span', 'tool-status', toolStatus(tool.status))
          );
          card.append(summary);

          const diffNode = renderDiffView(tool.detail);
          if (diffNode) card.append(diffNode);
          else card.append(element('pre', 'tool-detail', formatDetail(tool.detail) || 'Sem detalhes adicionais.'));

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
    const labels = {
      pending: 'Aguardando', running: 'Executando', completed: 'Concluído', complete: 'Concluído',
      success: 'Concluído', done: 'Concluído', error: 'Erro', failed: 'Falhou', denied: 'Negado',
    };
    return labels[status] || status || 'Atividade';
  }

  // PERMISSIONS QUEUE
  function renderPermissions() {
    const items = [...permissions.values()].filter((p) => p.sessionId === activeId);
    const signature = JSON.stringify([items, [...permissionDecisions]]);
    if (signature === permissionSignature) return;
    permissionSignature = signature;

    const nodes = items.map((permission) => {
      const card = element('section', 'permission-card');
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Permissão para ${permission.toolName || 'ferramenta'}`);

      card.append(element('h2', 'permission-title', `Permitir ${permission.toolName || 'esta ferramenta'}?`));
      card.append(element('p', 'permission-description', 'Revise os dados abaixo antes de autorizar a execução:'));

      const diffNode = renderDiffView(permission.input);
      if (diffNode) card.append(diffNode);
      else card.append(element('pre', 'permission-input', formatDetail(permission.input)));

      const actions = element('div', 'permission-actions');
      const deny = element('button', '', 'Negar');
      const always = element('button', 'always', `Sempre permitir ${permission.toolName}`);
      const allow = element('button', 'allow', 'Permitir uma vez');
      deny.type = always.type = allow.type = 'button';
      deny.disabled = always.disabled = allow.disabled = permissionDecisions.has(permission.id);

      deny.addEventListener('click', () => decidePermission(permission.id, false));
      allow.addEventListener('click', () => decidePermission(permission.id, true));
      always.addEventListener('click', async () => {
        await api.alwaysAllowTool({ sessionId: activeId, toolName: permission.toolName });
        decidePermission(permission.id, true);
      });

      actions.append(deny, always, allow);
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
    el.modelHint.textContent = el.model.value.includes('argon') ? 'Use com atenção à cota' : 'Rápido e econômico';
  }

  // SUGGESTIONS FOR CHAT VS CODE
  function renderSuggestions(isChat) {
    const codeSuggestions = [
      { prompt: 'Leia a estrutura deste projeto e explique como ele funciona. Comece pela documentação e pelos arquivos principais.', icon: '⌁', title: 'Entender o projeto', desc: 'Mapeie o código e arquitetura' },
      { prompt: 'Quero implementar uma funcionalidade neste projeto. Primeiro, me ajude a planejar e definir os passos.', icon: '✧', title: 'Criar funcionalidade', desc: 'Do plano ao código' },
      { prompt: 'Investigue um problema neste projeto. Vou descrever o comportamento atual e o esperado.', icon: '⌘', title: 'Investigar bug', desc: 'Encontre a causa raiz' },
    ];
    const chatSuggestions = [
      { prompt: 'Como funciona a arquitetura do Claude Code e como posso estruturar meus projetos de IA?', icon: '💬', title: 'Arquitetura e Design', desc: 'Tire dúvidas técnicas conceituais' },
      { prompt: 'Ajude-me a revisar este trecho de código para otimizar desempenho e consumo de cota.', icon: '⚡', title: 'Otimizar código', desc: 'Melhore lógica e legibilidade' },
      { prompt: 'Crie uma especificação de requisitos e backlog de tarefas para o meu próximo app.', icon: '📋', title: 'Planejar novo projeto', desc: 'Brainstorm e roadmap' },
    ];
    const active = isChat ? chatSuggestions : codeSuggestions;
    const nodes = active.map((s) => {
      const btn = element('button', 'suggestion');
      btn.dataset.prompt = s.prompt;
      btn.append(
        element('span', '', s.icon),
        element('strong', '', s.title),
        element('span', '', s.desc),
        element('b', '', '↗')
      );
      btn.addEventListener('click', () => {
        el.composer.value = s.prompt;
        drafts.set(activeId, el.composer.value);
        resizeComposer();
        renderControls();
        el.composer.focus();
      });
      return btn;
    });
    el.suggestions.replaceChildren(...nodes);
  }

  function renderControls() {
    const session = currentSession();
    const isChat = session?.mode === 'chat';
    const busy = Boolean(session?.busy || submitting);

    // Switcher tabs
    el.tabCode.classList.toggle('active', !isChat);
    el.tabCode.setAttribute('aria-selected', (!isChat).toString());
    el.tabChat.classList.toggle('active', isChat);
    el.tabChat.setAttribute('aria-selected', isChat.toString());

    // Eyebrow and placeholders
    el.eyebrow.textContent = isChat ? 'MODO CHAT · CONVERSA DIRETA (1 PROMPT POR MSG)' : 'MODO CODE · HARNESS COM FERRAMENTAS';
    el.composer.placeholder = isChat ? 'Pergunte ao Gemini ou cole um código para analisar...' : 'O que vamos construir no projeto?';
    el.quotaNote.textContent = isChat
      ? 'Modo Chat: 1 prompt direto por mensagem. Sem ferramentas locais.'
      : `Modo Code: Até ${state.settings?.maxRequestsPerTurn || 8} solicitações por envio. Continuidade de contexto ativada.`;

    // Folder button in header: hidden in chat mode
    el.folder.hidden = isChat;
    el.gitBadge.hidden = isChat || !state.git?.project?.isGit;

    // Engine banner: only shown in code mode when engine not ready
    el.engineBanner.hidden = isChat || Boolean(state.engine.ready);

    // Skills button label
    const selectedCount = session?.selectedSkills?.length || 0;
    el.skillsButtonLabel.textContent = `Skills (${selectedCount})`;
    el.activeSkillsSummary.hidden = selectedCount === 0;
    el.activeSkillsSummary.textContent = `✨ ${selectedCount} skill${selectedCount > 1 ? 's' : ''}`;

    // Buttons
    el.send.hidden = Boolean(session?.busy);
    const hasConnection = Boolean(state.connection.connected || state.settings?.apiKey);
    const canSend = !loading && !busy && el.composer.value.trim() && hasConnection && (isChat || state.engine.ready);
    el.send.disabled = !canSend;
    el.cancel.hidden = !session?.busy;
    el.model.disabled = busy;
    el.folder.disabled = busy || choosingFolder || loading;
    el.working.hidden = !session?.busy;
    el.workingText.textContent = isChat ? 'Gemini gerando resposta…' : 'Trabalhando no seu projeto…';
    el.connect.disabled = connecting || loading;
    el.newCodeSession.disabled = loading || submitting;
    el.newChatSession.disabled = loading || submitting;
  }

  function render() {
    const session = currentSession();
    const isChat = session?.mode === 'chat';

    el.version.textContent = `v${state.version || '0.2.0'}`;
    el.title.textContent = session?.title || (isChat ? 'Nova conversa de chat' : 'Novo projeto');

    const projectPath = session?.projectPath || '';
    el.project.textContent = projectPath ? projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath : 'Escolher pasta';
    el.folder.title = projectPath || 'Escolher pasta do projeto';

    // Git Status
    if (state.git?.project?.isGit) {
      el.gitBranch.textContent = state.git.project.branch || 'git';
      const dirty = state.git.project.dirty;
      el.gitDirty.textContent = dirty ? `+${dirty}` : '';
      el.gitDirty.hidden = !dirty;
      el.gitBadge.title = `Branch: ${state.git.project.branch} (${dirty} alterações não commitadas)`;
    }

    // GitHub Auth Status
    const gh = state.git?.github;
    if (gh?.connected) {
      el.githubDot.classList.add('connected');
      el.githubLabel.textContent = gh.username ? `@${gh.username}` : 'GitHub conectado';
      el.githubStatusPill.title = gh.message;
    } else {
      el.githubDot.classList.remove('connected');
      el.githubLabel.textContent = 'GitHub: desconectado';
      el.githubStatusPill.title = gh?.message || 'GitHub CLI não autenticado';
    }

    // Gemini connection
    const connected = Boolean(state.connection.connected || state.settings?.apiKey);
    el.connectionDot.classList.toggle('connected', connected);
    el.connectionLabel.textContent = state.settings?.provider === 'api' || state.settings?.apiKey
      ? 'Gemini API ativa'
      : (connected ? 'Gemini Web ativo' : 'Gemini desconectado');
    el.connectionMessage.textContent = state.connection.message || (connected ? 'Conta ou API conectada e pronta.' : 'Conecte sua conta para começar.');
    el.connect.querySelector('span:first-child').textContent = state.connection.connected ? 'Gerenciar Google' : 'Conta Google';

    // Daily Usage Widget
    const daily = state.dailyUsage || {};
    const reqCount = daily.requests || 0;
    el.usageRequests.textContent = `${reqCount} solicitação${reqCount !== 1 ? 'ões' : ''}`;
    const fillPercent = Math.min(100, Math.max(5, (reqCount / 50) * 100));
    el.usageProgressBar.style.width = `${fillPercent}%`;
    const tokens = (daily.inputTokens || 0) + (daily.outputTokens || 0);
    el.usageTokens.textContent = `${tokens > 0 ? tokens.toLocaleString('pt-BR') : '0'} tokens acumulados`;

    // Engine Banner
    el.engineBanner.classList.toggle('ready', Boolean(state.engine.ready));
    el.engineBanner.classList.toggle('error', Boolean(state.engine.error));
    el.engineMessage.textContent = state.engine.message || 'Preparando o motor local…';
    $('prepare-engine').hidden = Boolean(state.engine.ready);
    $('prepare-engine').disabled = Boolean(state.engine.busy);
    const progress = state.engine.progress;
    if (typeof progress === 'number' && Number.isFinite(progress)) el.engineProgress.value = Math.max(0, Math.min(100, progress));
    else el.engineProgress.removeAttribute('value');

    // Empty state text
    el.emptyEyebrow.textContent = isChat ? 'CONVERSA DIRETA · MENOS CUSTO DE COTA' : 'MENOS DISTÂNCIA ENTRE IDEIA E CÓDIGO';
    el.emptyTitle.innerHTML = isChat ? 'Pergunte, planeje ou<br><span>explore com o Gemini.</span>' : 'Vamos construir<br><span>alguma coisa boa.</span>';
    el.emptySubtitle.textContent = isChat
      ? 'Converse em markdown, tire dúvidas ou revise códigos diretamente sem executar ferramentas.'
      : 'Explore uma ideia, entenda seu projeto ou coloque a próxima mudança em movimento.';

    renderSuggestions(isChat);
    renderSessions();
    renderMessages(session);
    renderModels();
    renderPermissions();
    renderControls();
  }

  async function ensureSession(mode = 'code') {
    if (currentSession()) return activeId;
    const previousDraft = el.composer.value;
    const result = await api.createSession(mode);
    const id = typeof result === 'string' ? result : result?.id;
    if (!id) throw new Error('Não foi possível criar a conversa.');
    activeId = id;
    drafts.set(id, previousDraft);
    if (!state.sessions.some((session) => session.id === id)) acceptState(await api.getState());
    el.composer.value = previousDraft;
    return id;
  }

  async function createNewSession(mode = 'code') {
    if (loading || submitting) return;
    try {
      const result = await api.createSession(mode);
      const id = typeof result === 'string' ? result : result?.id;
      if (!id) throw new Error('Não foi possível criar a conversa.');
      acceptState(await api.getState());
      setActive(id);
    } catch (error) {
      showNotice(errorMessage(error), true);
    }
  }

  async function switchMode(mode) {
    const session = currentSession();
    if (!session || session.mode === mode) return;
    if (session.busy) {
      showNotice('Aguarde a finalização do processamento atual para mudar de modo.', true);
      return;
    }
    await api.setMode(activeId, mode);
    session.mode = mode;
    render();
  }

  // SKILLS MODAL LOGIC
  function openSkillsModal() {
    const session = currentSession();
    const skills = state.skills || [];
    el.skillsCountInfo.textContent = `${skills.length} disponíveis`;

    const nodes = skills.map((skill) => {
      const isSelected = session?.selectedSkills?.includes(skill.id) || session?.selectedSkills?.includes(skill.name);
      const card = element('div', `skill-item${isSelected ? ' active' : ''}`);

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'skill-checkbox';
      check.checked = Boolean(isSelected);

      check.addEventListener('change', async () => {
        card.classList.toggle('active', check.checked);
        await api.toggleSkill({ sessionId: activeId, skillId: skill.id });
        const updated = await api.getState();
        acceptState(updated);
      });

      const info = element('div', 'skill-info');
      const titleRow = element('div', 'skill-title-row');
      titleRow.append(element('span', 'skill-name', skill.name), element('span', 'skill-source', skill.source));
      info.append(titleRow, element('p', 'skill-desc', skill.description));

      card.append(check, info);
      return card;
    });

    if (!nodes.length) {
      nodes.push(element('p', 'session-empty', 'Nenhuma skill encontrada em ~/.claude/skills ou na pasta do projeto. Crie uma pasta de skill com SKILL.md para habilitar aqui.'));
    }

    el.skillsList.replaceChildren(...nodes);
    el.skillsModal.hidden = false;
  }

  function closeSkillsModal() {
    el.skillsModal.hidden = true;
  }

  // SETTINGS MODAL LOGIC
  function openSettingsModal() {
    const s = state.settings || {};
    el.providerWeb.checked = s.provider !== 'api';
    el.providerApi.checked = s.provider === 'api';
    el.apiKeyGroup.hidden = s.provider !== 'api';
    el.apiKeyInput.value = s.apiKey || '';
    el.enableAgentToggle.checked = Boolean(s.enableAgent);
    el.maxRequestsSelect.value = String(s.maxRequestsPerTurn || 8);
    el.customSkillsPath.value = s.customSkillsDir || '';

    const gh = state.git?.github;
    el.settingsGithubInfo.textContent = gh?.message || 'Verificando GitHub CLI...';

    el.settingsModal.hidden = false;
  }

  function closeSettingsModal() {
    el.settingsModal.hidden = true;
  }

  async function saveSettings() {
    const provider = el.providerApi.checked ? 'api' : 'web';
    const apiKey = el.apiKeyInput.value.trim();
    const enableAgent = el.enableAgentToggle.checked;
    const maxRequestsPerTurn = Number(el.maxRequestsSelect.value) || 8;
    const customSkillsDir = el.customSkillsPath.value.trim();

    await api.updateSettings({ provider, apiKey, enableAgent, maxRequestsPerTurn, customSkillsDir });
    acceptState(await api.getState());
    closeSettingsModal();
    showNotice('Configurações salvas com sucesso.');
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = el.composer.value.trim();
    const session = currentSession();
    if (!text || submitting || session?.busy || loading) return;

    const isChat = session?.mode === 'chat';
    const hasConnection = Boolean(state.connection.connected || state.settings?.apiKey);
    if (!hasConnection) {
      return showNotice('Conecte sua conta Google ou adicione uma chave da API Gemini nas Configurações.', true);
    }
    if (!isChat && !state.engine.ready) {
      return showNotice('Aguarde a preparação do motor oficial antes de enviar no modo Code.', true);
    }

    const selectedModel = el.model.value;
    const submittedDraft = el.composer.value;
    submitting = true;
    showNotice('');
    renderControls();

    try {
      const id = await ensureSession(session?.mode || 'code');
      modelChoices.set(id, selectedModel);
      checkResult(await api.send({ sessionId: id, text, model: selectedModel }));
      if (activeId === id && el.composer.value === submittedDraft) {
        el.composer.value = '';
        drafts.set(id, '');
        resizeComposer();
      }
    } catch (error) {
      showNotice(errorMessage(error), true);
    } finally {
      submitting = false;
      renderControls();
      el.composer.focus();
    }
  }

  async function decidePermission(id, allow) {
    if (permissionDecisions.has(id)) return;
    permissionDecisions.add(id);
    renderPermissions();
    try {
      checkResult(await api.decidePermission({ id, allow }));
      permissions.delete(id);
    } catch (error) {
      showNotice(errorMessage(error), true);
    } finally {
      permissionDecisions.delete(id);
      renderPermissions();
      renderSessions();
    }
  }

  // EVENT LISTENERS
  el.tabCode.addEventListener('click', () => switchMode('code'));
  el.tabChat.addEventListener('click', () => switchMode('chat'));
  el.newCodeSession.addEventListener('click', () => createNewSession('code'));
  el.newChatSession.addEventListener('click', () => createNewSession('chat'));

  el.skillsButton.addEventListener('click', openSkillsModal);
  el.closeSkillsModal.addEventListener('click', closeSkillsModal);
  el.skillsDoneBtn.addEventListener('click', closeSkillsModal);
  el.refreshSkillsBtn.addEventListener('click', async () => {
    await api.refreshSkills();
    acceptState(await api.getState());
    openSkillsModal();
  });

  el.openSettings.addEventListener('click', openSettingsModal);
  el.closeSettingsModal.addEventListener('click', closeSettingsModal);
  el.saveSettingsBtn.addEventListener('click', saveSettings);
  el.providerWeb.addEventListener('change', () => { el.apiKeyGroup.hidden = true; });
  el.providerApi.addEventListener('change', () => { el.apiKeyGroup.hidden = false; });

  el.form.addEventListener('submit', sendMessage);
  el.composer.addEventListener('input', () => {
    drafts.set(activeId, el.composer.value);
    resizeComposer();
    renderControls();
  });
  el.composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (event.shiftKey) createNewSession('chat');
      else createNewSession('code');
    }
    if (event.key === 'Escape') {
      closeSkillsModal();
      closeSettingsModal();
    }
  });

  el.model.addEventListener('change', () => {
    modelChoices.set(activeId, el.model.value);
    renderModels();
  });

  el.folder.addEventListener('click', async () => {
    choosingFolder = true;
    renderControls();
    try {
      const id = await ensureSession('code');
      const result = await api.selectFolder(id);
      if (!result?.canceled) {
        showNotice('');
        acceptState(await api.getState());
      }
    } catch (error) {
      showNotice(errorMessage(error), true);
    } finally {
      choosingFolder = false;
      renderControls();
    }
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
      if (event.permission.closed) permissions.delete(event.permission.id);
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
