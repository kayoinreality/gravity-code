'use strict';

(() => {
  const api = window.gravity;
  const $ = (id) => document.getElementById(id);

  const el = {
    app: $('app'),
    sidebar: $('sidebar'),
    toggleSidebar: $('toggle-sidebar'),
    openSidebar: $('open-sidebar'),
    modeChat: $('mode-chat'),
    modeCode: $('mode-code'),
    newChat: $('new-chat'),
    sessionList: $('session-list'),
    accountButton: $('account-button'),
    accountAvatar: $('account-avatar'),
    accountName: $('account-name'),
    accountSub: $('account-sub'),
    accountDot: $('account-dot'),
    accountMenu: $('account-menu'),
    menuStatusDot: $('menu-status-dot'),
    menuStatusText: $('menu-status-text'),
    accountConnect: $('account-connect'),
    accountConnectLabel: $('account-connect-label'),
    accountSettings: $('account-settings'),
    menuUsage: $('menu-usage'),
    menuGithub: $('menu-github'),
    menuVersion: $('menu-version'),
    workspace: $('workspace'),
    sessionTitle: $('session-title'),
    gitChip: $('git-chip'),
    gitBranch: $('git-branch'),
    gitDirty: $('git-dirty'),
    folderChip: $('folder-chip'),
    folderName: $('folder-name'),
    scroll: $('scroll'),
    messageList: $('message-list'),
    working: $('working'),
    workingText: $('working-text'),
    dock: $('dock'),
    hero: $('hero'),
    greeting: $('greeting'),
    engineBanner: $('engine-banner'),
    engineMessage: $('engine-message'),
    engineProgressTrack: $('engine-progress-track'),
    engineProgress: $('engine-progress'),
    prepareEngine: $('prepare-engine'),
    permissions: $('permissions'),
    notice: $('notice'),
    composer: $('composer'),
    composerText: $('composer-text'),
    attachButton: $('attach-button'),
    skillsButton: $('skills-button'),
    skillsCount: $('skills-count'),
    modelSelect: $('model-select'),
    send: $('send'),
    cancel: $('cancel'),
    attachMenu: $('attach-menu'),
    attachFolder: $('attach-folder'),
    attachSkills: $('attach-skills'),
    suggestions: $('suggestions'),
    footnote: $('footnote'),
    // Skills modal
    skillsModal: $('skills-modal'),
    closeSkillsModal: $('close-skills-modal'),
    skillsSearch: $('skills-search'),
    refreshSkillsBtn: $('refresh-skills-btn'),
    skillsCountInfo: $('skills-count-info'),
    skillsList: $('skills-list'),
    skillsDoneBtn: $('skills-done-btn'),
    // Settings modal
    settingsModal: $('settings-modal'),
    closeSettingsModal: $('close-settings-modal'),
    cancelSettingsBtn: $('cancel-settings-btn'),
    saveSettingsBtn: $('save-settings-btn'),
    settingDefaultMode: $('setting-default-mode'),
    customSkillsPath: $('custom-skills-path'),
    settingsConnectionDot: $('settings-connection-dot'),
    settingsConnectionStatus: $('settings-connection-status'),
    settingsConnect: $('settings-connect'),
    settingsDisconnect: $('settings-disconnect'),
    providerWeb: $('provider-web'),
    providerApi: $('provider-api'),
    apiKeyGroup: $('api-key-group'),
    geminiApiKey: $('gemini-api-key'),
    usageToday: $('usage-today'),
    settingEnableAgent: $('setting-enable-agent'),
    settingMaxRequests: $('setting-max-requests'),
    settingsGithubInfo: $('settings-github-info'),
    aboutVersion: $('about-version'),
  };

  // Verify all DOM keys exist
  for (const [k, v] of Object.entries(el)) {
    if (!v) console.warn('Elemento ausente no DOM:', k);
  }

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

  // SVG Antigravity Logo Generator
  function createLogoSVG(size = 24, animated = false) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `logo${animated ? ' animated' : ''}`);
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');

    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('class', 'arc');
    path1.setAttribute('d', 'M6 26 C10 14 13 8 16 8 C19 8 22 14 26 26');
    path1.setAttribute('stroke-width', '3.4');

    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('class', 'arc');
    path2.setAttribute('d', 'M10.5 20 H21.5');
    path2.setAttribute('stroke-width', '2.8');
    path2.setAttribute('opacity', '0.85');

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'orbit');

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'sat');
    circle.setAttribute('cx', '16');
    circle.setAttribute('cy', '3.6');
    circle.setAttribute('r', '2.2');

    g.appendChild(circle);
    svg.append(path1, path2, g);
    return svg;
  }

  function renderLogos() {
    document.querySelectorAll('.logo-slot').forEach((slot) => {
      const size = Number(slot.dataset.size) || 24;
      const animated = slot.dataset.animated === 'true';
      slot.replaceChildren(createLogoSVG(size, animated));
    });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function iconUse(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.appendChild(use);
    return svg;
  }

  function currentSession() {
    return state.sessions.find((s) => s.id === activeId) || null;
  }

  function currentModel() {
    return modelChoices.get(activeId) || currentSession()?.model || 'gemini-3.8-flash';
  }

  function showNotice(message, error = false) {
    if (!el.notice) return;
    el.notice.textContent = message || '';
    el.notice.hidden = !message;
    el.notice.classList.toggle('error', error);
  }

  function errorMessage(error) {
    const msg = error?.message || String(error || 'Não foi possível concluir a operação.');
    return msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  }

  function checkResult(result) {
    if (result?.ok === false) throw new Error(result.message || result.error || 'Não foi possível concluir a operação.');
    return result;
  }

  function resizeComposer() {
    if (!el.composerText) return;
    el.composerText.style.height = 'auto';
    el.composerText.style.height = `${Math.min(240, Math.max(26, el.composerText.scrollHeight))}px`;
  }

  function setActive(id) {
    if (activeId && el.composerText) drafts.set(activeId, el.composerText.value);
    activeId = id;
    if (el.composerText) el.composerText.value = drafts.get(activeId) || '';
    messageSignature = '';
    permissionSignature = '';
    showNotice('');
    api.setActive?.(id)?.catch?.(() => {});
    render();
    resizeComposer();
    if (el.scroll) el.scroll.scrollTop = el.scroll.scrollHeight;
    if (el.composerText) el.composerText.focus();
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
    if (!activeId || !state.sessions.some((s) => s.id === activeId)) {
      activeId = state.activeId || state.sessions[0]?.id || null;
    }
    if (previousId !== activeId && el.composerText) {
      if (previousId) drafts.set(previousId, el.composerText.value);
      el.composerText.value = drafts.get(activeId) || '';
      messageSignature = '';
      permissionSignature = '';
      resizeComposer();
    }
    loading = false;
    render();
  }

  // Greeting by time of day
  function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) return 'Boa madrugada';
    if (hour >= 5 && hour < 12) return 'Bom dia';
    if (hour >= 12 && hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  // Sidebar toggle
  function initSidebar() {
    const saved = localStorage.getItem('gravity:sidebar-collapsed');
    if (saved === 'true') {
      el.app.classList.add('sidebar-collapsed');
      if (el.openSidebar) el.openSidebar.hidden = false;
    }
    el.toggleSidebar?.addEventListener('click', () => {
      el.app.classList.add('sidebar-collapsed');
      if (el.openSidebar) el.openSidebar.hidden = false;
      localStorage.setItem('gravity:sidebar-collapsed', 'true');
    });
    el.openSidebar?.addEventListener('click', () => {
      el.app.classList.remove('sidebar-collapsed');
      if (el.openSidebar) el.openSidebar.hidden = true;
      localStorage.setItem('gravity:sidebar-collapsed', 'false');
    });
  }

  // SESSIONS LIST
  function renderSessions() {
    if (!el.sessionList) return;
    const nodes = [];

    for (const session of state.sessions) {
      const item = element('div', `session-item${session.id === activeId ? ' active' : ''}`);
      item.dataset.sessionId = session.id;

      const isChat = session.mode === 'chat';
      const modeIcon = iconUse(isChat ? 'i-message' : 'i-terminal');
      modeIcon.classList.add('mode-icon');
      item.appendChild(modeIcon);

      const label = element('span', 'label', session.title || 'Nova conversa');
      item.appendChild(label);

      if (session.busy || [...permissions.values()].some((p) => p.sessionId === session.id)) {
        const dot = element('span', 'busy-dot');
        dot.setAttribute('aria-label', 'Em andamento');
        item.appendChild(dot);
      }

      const more = element('button', 'more');
      more.type = 'button';
      more.title = 'Opções da conversa';
      more.appendChild(iconUse('i-more'));

      more.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Deseja excluir esta conversa?')) {
          await api.deleteSession(session.id);
          acceptState(await api.getState());
        }
      });
      item.appendChild(more);

      item.addEventListener('click', () => setActive(session.id));
      nodes.push(item);
    }

    if (!nodes.length) {
      nodes.push(element('div', 'session-empty', 'Nenhuma conversa recente.'));
    }
    el.sessionList.replaceChildren(...nodes);
  }

  // MARKDOWN RENDERER
  function renderMarkdown(text) {
    const container = document.createElement('div');
    container.className = 'md';
    const lines = text.split('\n');
    let inCode = false;
    let codeLang = '';
    let codeBuffer = [];

    const flushCode = () => {
      if (!codeBuffer.length && !inCode) return;
      const block = element('div', 'code-block');
      const head = element('div', 'code-head');
      head.append(element('span', '', codeLang || 'código'));
      const copyBtn = element('button', '', '');
      copyBtn.type = 'button';
      copyBtn.append(iconUse('i-copy'), element('span', '', 'Copiar'));
      const codeText = codeBuffer.join('\n');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeText);
        copyBtn.replaceChildren(iconUse('i-check'), element('span', '', 'Copiado'));
        setTimeout(() => copyBtn.replaceChildren(iconUse('i-copy'), element('span', '', 'Copiar')), 1800);
      });
      head.appendChild(copyBtn);
      const pre = element('pre');
      const code = element('code', '', codeText);
      pre.appendChild(code);
      block.append(head, pre);
      container.appendChild(block);
      codeBuffer = [];
      codeLang = '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        if (inCode) {
          inCode = false;
          flushCode();
        } else {
          inCode = true;
          codeLang = line.slice(3).trim();
          codeBuffer = [];
        }
        continue;
      }
      if (inCode) {
        codeBuffer.push(line);
        continue;
      }

      if (line.startsWith('# ')) {
        container.appendChild(element('h1', '', line.slice(2)));
      } else if (line.startsWith('## ')) {
        container.appendChild(element('h2', '', line.slice(3)));
      } else if (line.startsWith('### ')) {
        container.appendChild(element('h3', '', line.slice(4)));
      } else if (line.startsWith('> ')) {
        const bq = element('blockquote');
        formatInline(line.slice(2), bq);
        container.appendChild(bq);
      } else if (/^\s*[-*]\s+/.test(line)) {
        const li = element('li');
        formatInline(line.replace(/^\s*[-*]\s+/, ''), li);
        let ul = container.lastElementChild;
        if (!ul || ul.tagName !== 'UL') {
          ul = document.createElement('ul');
          container.appendChild(ul);
        }
        ul.appendChild(li);
      } else if (/^\s*\d+\.\s+/.test(line)) {
        const li = element('li');
        formatInline(line.replace(/^\s*\d+\.\s+/, ''), li);
        let ol = container.lastElementChild;
        if (!ol || ol.tagName !== 'OL') {
          ol = document.createElement('ol');
          container.appendChild(ol);
        }
        ol.appendChild(li);
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
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
    for (const part of parts) {
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        parent.appendChild(element('code', '', part.slice(1, -1)));
      } else if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        parent.appendChild(element('strong', '', part.slice(2, -2)));
      } else if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
        parent.appendChild(element('em', '', part.slice(1, -1)));
      } else if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
        const label = part.slice(1, part.indexOf(']('));
        parent.appendChild(element('span', 'link', label));
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
      const card = element('div', 'diff');
      const head = element('div', 'diff-file');
      head.append(iconUse('i-file'), element('span', '', filePath));
      card.appendChild(head);

      if (oldString) {
        for (const line of String(oldString).split('\n')) {
          card.appendChild(element('div', 'diff-line del', `- ${line}`));
        }
      }
      if (newString) {
        for (const line of String(newString).split('\n')) {
          card.appendChild(element('div', 'diff-line add', `+ ${line}`));
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

  function toolIconId(name = '') {
    const n = name.toLowerCase();
    if (/read|view|cat/.test(n)) return 'i-eye';
    if (/write|edit|replace|patch/.test(n)) return 'i-pencil';
    if (/bash|exec|run|command|terminal/.test(n)) return 'i-terminal';
    if (/grep|glob|find|search/.test(n)) return 'i-search';
    return 'i-wrench';
  }

  function toolTargetSummary(name, input) {
    if (!input) return '';
    let parsed;
    try { parsed = typeof input === 'string' ? JSON.parse(input) : input; } catch { return ''; }
    if (typeof parsed !== 'object') return '';
    return parsed.file_path || parsed.path || parsed.command || parsed.CommandLine || parsed.pattern || parsed.query || '';
  }

  // MESSAGES
  function renderMessages(session) {
    const messages = session?.messages || [];
    const signature = JSON.stringify([activeId, messages]);
    if (signature === messageSignature) return;

    const atBottom = el.scroll ? el.scroll.scrollHeight - el.scroll.clientHeight - el.scroll.scrollTop < 100 : true;
    messageSignature = signature;
    const nodes = [];

    messages.forEach((msg, idx) => {
      const role = ['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'system';
      const isLastAssistant = role === 'assistant' && idx === messages.length - 1;
      const article = element('article', `msg ${role}${isLastAssistant ? ' last' : ''}`);

      if (role === 'user') {
        const bubble = element('div', 'bubble', msg.text || '');
        article.appendChild(bubble);
      } else if (role === 'system') {
        article.append(iconUse('i-alert'), element('div', 'body', msg.text || ''));
      } else {
        // Assistant
        if (msg.text) {
          article.appendChild(renderMarkdown(msg.text));
        }

        if (Array.isArray(msg.tools) && msg.tools.length) {
          const tools = element('div', 'tool-list');
          msg.tools.forEach((tool, tIdx) => {
            const key = `${activeId}:${msg.id || idx}:${tIdx}`;
            const failed = /error|fail|denied|rejected|erro|negado/i.test(tool.status || '');
            const card = element('details', `tool${failed ? ' error' : ''}`);
            card.open = toolOpenState.get(key) || false;

            const summary = element('summary');
            const icon = iconUse(toolIconId(tool.name));
            icon.classList.add('tool-icon');

            const name = element('span', 'tool-name', tool.name || 'Ferramenta');
            const target = element('span', 'tool-target', toolTargetSummary(tool.name, tool.detail));

            const stateIcon = element('span', `tool-state${failed ? ' fail' : tool.status === 'Concluída' ? ' ok' : ''}`);
            if (tool.status === 'Solicitada') {
              stateIcon.appendChild(element('span', 'spinner'));
            } else if (failed) {
              stateIcon.appendChild(iconUse('i-x'));
            } else {
              stateIcon.appendChild(iconUse('i-check'));
            }

            const chevron = iconUse('i-chevron');
            chevron.classList.add('tool-chevron');

            summary.append(icon, name, target, stateIcon, chevron);
            card.appendChild(summary);

            const body = element('div', 'tool-body');
            const diffNode = renderDiffView(tool.detail);
            if (diffNode) body.appendChild(diffNode);
            else body.appendChild(element('pre', '', formatDetail(tool.detail) || 'Sem detalhes.'));
            card.appendChild(body);

            card.addEventListener('toggle', () => toolOpenState.set(key, card.open));
            tools.appendChild(card);
          });
          article.appendChild(tools);
        }

        const actions = element('div', 'msg-actions');
        const copyBtn = element('button', 'icon-btn');
        copyBtn.type = 'button';
        copyBtn.title = 'Copiar resposta';
        copyBtn.appendChild(iconUse('i-copy'));
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(msg.text || '');
          copyBtn.replaceChildren(iconUse('i-check'));
          setTimeout(() => copyBtn.replaceChildren(iconUse('i-copy')), 1600);
        });
        actions.appendChild(copyBtn);
        article.appendChild(actions);

        if (isLastAssistant) {
          const slot = element('div', 'msg-logo');
          slot.appendChild(createLogoSVG(20, Boolean(session.busy)));
          article.appendChild(slot);
        }
      }
      nodes.push(article);
    });

    el.messageList.replaceChildren(...nodes);

    const hasMessages = messages.length > 0;
    el.workspace.classList.toggle('is-empty', !hasMessages);

    if (atBottom && el.scroll) {
      requestAnimationFrame(() => { el.scroll.scrollTop = el.scroll.scrollHeight; });
    }
  }

  // PERMISSIONS
  function renderPermissions() {
    if (!el.permissions) return;
    const items = [...permissions.values()].filter((p) => p.sessionId === activeId);
    const signature = JSON.stringify([items, [...permissionDecisions]]);
    if (signature === permissionSignature) return;
    permissionSignature = signature;

    const nodes = items.map((permission) => {
      const card = element('div', 'permission');
      const head = element('div', 'permission-head');
      const iconWrap = element('span', 'banner-icon');
      iconWrap.appendChild(iconUse('i-alert'));
      const text = element('span', '', '');
      text.append(document.createTextNode('Permitir que o Gravity use '), element('b', '', permission.toolName || 'ferramenta'), document.createTextNode('?'));
      head.append(iconWrap, text);
      card.appendChild(head);

      const body = element('div', 'permission-body');
      const diffNode = renderDiffView(permission.input);
      if (diffNode) body.appendChild(diffNode);
      else body.appendChild(element('pre', '', formatDetail(permission.input)));
      card.appendChild(body);

      const actions = element('div', 'permission-actions');
      const hint = element('span', 'hint', 'Enter permite · Esc nega');
      const deny = element('button', 'btn btn-secondary', 'Negar');
      const always = element('button', 'btn btn-secondary', `Sempre permitir nesta conversa`);
      const allow = element('button', 'btn btn-primary', 'Permitir');
      deny.type = always.type = allow.type = 'button';

      const busy = permissionDecisions.has(permission.id);
      deny.disabled = always.disabled = allow.disabled = busy;

      deny.addEventListener('click', () => decidePermission(permission.id, false));
      allow.addEventListener('click', () => decidePermission(permission.id, true));
      always.addEventListener('click', async () => {
        await api.alwaysAllowTool({ sessionId: activeId, toolName: permission.toolName });
        decidePermission(permission.id, true);
      });

      actions.append(hint, deny, always, allow);
      card.appendChild(actions);
      return card;
    });

    el.permissions.replaceChildren(...nodes);
  }

  // SUGGESTIONS
  function renderSuggestions(isChat) {
    if (!el.suggestions) return;
    const codeSuggestions = [
      { text: 'Entender o projeto', prompt: 'Leia a estrutura deste projeto e explique como ele funciona. Comece pela documentação e pelos arquivos principais.', icon: 'i-eye' },
      { text: 'Criar funcionalidade', prompt: 'Quero implementar uma funcionalidade neste projeto. Primeiro, me ajude a planejar os passos.', icon: 'i-plus' },
      { text: 'Investigar bug', prompt: 'Investigue um problema neste projeto. Vou descrever o comportamento atual e o esperado.', icon: 'i-wrench' },
      { text: 'Escrever testes', prompt: 'Revise os módulos principais deste projeto e proponha testes unitários e de integração.', icon: 'i-check' },
    ];
    const chatSuggestions = [
      { text: 'Explicar um conceito', prompt: 'Como funciona a arquitetura do Claude Code e como estruturar agentes de IA?', icon: 'i-info' },
      { text: 'Revisar código', prompt: 'Ajude-me a revisar este trecho de código para otimizar desempenho e legibilidade:', icon: 'i-pencil' },
      { text: 'Planejar projeto', prompt: 'Crie uma especificação técnica e backlog de tarefas para o meu próximo aplicativo.', icon: 'i-list' },
    ];
    const active = isChat ? chatSuggestions : codeSuggestions;
    const nodes = active.map((s) => {
      const btn = element('button', 'suggestion');
      btn.type = 'button';
      btn.append(iconUse(s.icon), element('span', '', s.text));
      btn.addEventListener('click', () => {
        if (!el.composerText) return;
        el.composerText.value = s.prompt;
        drafts.set(activeId, el.composerText.value);
        resizeComposer();
        renderControls();
        el.composerText.focus();
      });
      return btn;
    });
    el.suggestions.replaceChildren(...nodes);
  }

  // MODELS
  function renderModels() {
    if (!el.modelSelect) return;
    const models = state.models?.length ? state.models : fallbackModels;
    const signature = JSON.stringify(models);
    if (el.modelSelect.dataset.signature !== signature) {
      el.modelSelect.replaceChildren(...models.map((model) => {
        const option = element('option', '', model.label);
        option.value = model.id;
        return option;
      }));
      el.modelSelect.dataset.signature = signature;
    }
    const selected = currentModel();
    el.modelSelect.value = models.some((m) => m.id === selected) ? selected : models[0].id;
  }

  // CONTROLS & HEADER
  function renderControls() {
    const session = currentSession();
    const isChat = session?.mode === 'chat';
    const busy = Boolean(session?.busy || submitting);

    // Mode tab buttons
    if (el.modeChat && el.modeCode) {
      el.modeChat.classList.toggle('active', isChat);
      el.modeChat.setAttribute('aria-selected', isChat.toString());
      el.modeCode.classList.toggle('active', !isChat);
      el.modeCode.setAttribute('aria-selected', (!isChat).toString());
    }

    // Topbar chips
    if (el.folderChip) {
      el.folderChip.hidden = isChat;
      el.folderChip.disabled = busy || choosingFolder || loading;
    }
    if (el.gitChip) {
      el.gitChip.hidden = isChat || !state.git?.project?.isGit;
    }

    // Engine banner (only in Code mode if not ready)
    if (el.engineBanner) {
      const showEngine = !isChat && !state.engine.ready;
      el.engineBanner.hidden = !showEngine;
      el.engineBanner.classList.toggle('error', Boolean(state.engine.error));
      if (el.engineMessage) el.engineMessage.textContent = state.engine.message || 'Prepare o motor oficial para começar no modo Code.';
      if (el.prepareEngine) {
        el.prepareEngine.disabled = Boolean(state.engine.busy);
        el.prepareEngine.textContent = 'Preparar motor';
      }
      if (el.engineProgressTrack && el.engineProgress) {
        const prog = state.engine.progress;
        if (typeof prog === 'number' && prog > 0 && prog < 100) {
          el.engineProgressTrack.hidden = false;
          el.engineProgress.style.width = `${prog}%`;
        } else {
          el.engineProgressTrack.hidden = true;
        }
      }
    }

    // Composer placeholder & footnotes
    if (el.composerText) {
      el.composerText.placeholder = isChat ? 'Como posso ajudar hoje?' : 'Como posso ajudar no seu projeto?';
    }
    if (el.footnote) {
      const maxReq = state.settings?.maxRequestsPerTurn || 8;
      el.footnote.textContent = isChat
        ? 'O Gravity pode errar. Revise as informações importantes.'
        : `O Gravity pode errar. Revise as alterações. · Até ${maxReq} solicitações por envio.`;
    }

    // Send / Cancel
    const hasConnection = Boolean(state.connection.connected || state.settings?.apiKey);
    const hasText = Boolean(el.composerText?.value.trim());
    const canSend = !loading && !busy && hasText && hasConnection && (isChat || state.engine.ready);

    if (el.send) {
      el.send.hidden = busy;
      el.send.disabled = !canSend;
    }
    if (el.cancel) {
      el.cancel.hidden = !busy;
    }
    if (el.modelSelect) {
      el.modelSelect.disabled = busy;
    }
    if (el.working) {
      el.working.hidden = !busy;
      if (el.workingText) {
        el.workingText.textContent = isChat ? 'Pensando…' : 'Trabalhando no seu projeto…';
      }
    }

    // Skills button count
    const skillsCount = session?.selectedSkills?.length || 0;
    if (el.skillsCount) {
      el.skillsCount.textContent = String(skillsCount);
      el.skillsCount.hidden = skillsCount === 0;
    }
    if (el.skillsButton) {
      el.skillsButton.classList.toggle('active', skillsCount > 0);
    }
  }

  // MAIN RENDER
  function render() {
    const session = currentSession();
    const isChat = session?.mode === 'chat';

    if (el.greeting) el.greeting.textContent = getGreeting();
    if (el.sessionTitle) el.sessionTitle.textContent = session?.title || 'Nova conversa';

    // Folder & Git
    if (el.folderName) {
      const p = session?.projectPath || '';
      el.folderName.textContent = p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : 'Escolher pasta';
      if (el.folderChip) el.folderChip.title = p || 'Escolher pasta do projeto';
    }
    if (state.git?.project?.isGit && el.gitBranch) {
      el.gitBranch.textContent = state.git.project.branch || 'main';
      const dirty = state.git.project.dirty;
      if (el.gitDirty) {
        el.gitDirty.textContent = dirty ? `+${dirty}` : '';
        el.gitDirty.hidden = !dirty;
      }
    }

    // Account sidebar status
    const connected = Boolean(state.connection.connected || state.settings?.apiKey);
    if (el.accountDot) el.accountDot.className = `status-dot${connected ? ' ok' : ''}`;
    if (el.accountAvatar) el.accountAvatar.className = `avatar${connected ? ' connected' : ''}`;
    if (el.accountSub) {
      el.accountSub.textContent = state.settings?.provider === 'api' || state.settings?.apiKey
        ? 'Gemini API ativa'
        : (connected ? 'Conectado' : 'Desconectado');
    }
    if (el.menuStatusDot) el.menuStatusDot.className = `status-dot${connected ? ' ok' : ''}`;
    if (el.menuStatusText) el.menuStatusText.textContent = state.connection.message || (connected ? 'Conectado e pronto' : 'Desconectado');
    if (el.accountConnectLabel) el.accountConnectLabel.textContent = connected ? 'Trocar de conta Google' : 'Conectar conta Google';

    // Usage & GitHub
    if (el.menuUsage) {
      const reqs = state.dailyUsage?.requests || 0;
      el.menuUsage.textContent = `Hoje: ${reqs} solicitação${reqs !== 1 ? 'ões' : ''}`;
    }
    if (el.menuGithub) {
      const gh = state.git?.github;
      el.menuGithub.textContent = gh?.connected ? `@${gh.username || 'conectado'}` : 'GitHub: desconectado';
    }
    if (el.menuVersion) {
      el.menuVersion.textContent = `Gravity Code v${state.version || '0.3.0'}`;
    }
    if (el.aboutVersion) {
      el.aboutVersion.textContent = `Versão ${state.version || '0.3.0'}`;
    }

    renderLogos();
    renderSessions();
    renderMessages(session);
    renderPermissions();
    renderSuggestions(isChat);
    renderModels();
    renderControls();
  }

  // SESSIONS
  async function ensureSession(mode = 'code') {
    if (currentSession()) return activeId;
    const prevDraft = el.composerText?.value || '';
    const result = await api.createSession(mode);
    const id = typeof result === 'string' ? result : result?.id;
    if (!id) throw new Error('Não foi possível criar a conversa.');
    activeId = id;
    drafts.set(id, prevDraft);
    acceptState(await api.getState());
    if (el.composerText) el.composerText.value = prevDraft;
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
    } catch (err) {
      showNotice(errorMessage(err), true);
    }
  }

  async function switchMode(mode) {
    const session = currentSession();
    if (!session) return createNewSession(mode);
    if (session.mode === mode) return;
    if (session.busy) {
      showNotice('Aguarde a operação em andamento terminar.', true);
      return;
    }
    if (session.messages && session.messages.length > 0) {
      return createNewSession(mode);
    }
    await api.setMode(activeId, mode);
    session.mode = mode;
    render();
  }

  // SKILLS MODAL
  function openSkillsModal() {
    const session = currentSession();
    const skills = state.skills || [];
    if (el.skillsCountInfo) el.skillsCountInfo.textContent = `${skills.length} disponíveis`;

    const filter = (el.skillsSearch?.value || '').toLowerCase().trim();
    const visible = skills.filter((s) => !filter || s.name.toLowerCase().includes(filter) || s.description.toLowerCase().includes(filter));

    const nodes = visible.map((skill) => {
      const isSelected = session?.selectedSkills?.includes(skill.id) || session?.selectedSkills?.includes(skill.name);
      const row = element('label', 'skill');

      const info = element('div', 'skill-info');
      const title = element('div', 'skill-title');
      title.append(element('strong', '', skill.name), element('span', 'skill-source', skill.source));
      info.append(title, element('p', 'skill-desc', skill.description));

      const sw = element('label', 'switch');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = Boolean(isSelected);
      check.addEventListener('change', async (e) => {
        e.stopPropagation();
        await api.toggleSkill({ sessionId: activeId, skillId: skill.id });
        acceptState(await api.getState());
      });
      sw.append(check, element('span'));

      row.append(info, sw);
      return row;
    });

    if (!nodes.length) {
      nodes.push(element('p', 'session-empty', 'Nenhuma skill encontrada. Crie uma pasta com SKILL.md no projeto ou na pasta adicional de skills.'));
    }
    el.skillsList.replaceChildren(...nodes);
    el.skillsModal.hidden = false;
  }

  function closeSkillsModal() {
    if (el.skillsModal) el.skillsModal.hidden = true;
  }

  // SETTINGS MODAL
  function openSettingsModal() {
    const s = state.settings || {};
    if (el.settingDefaultMode) el.settingDefaultMode.value = s.defaultMode || 'code';
    if (el.customSkillsPath) el.customSkillsPath.value = s.customSkillsDir || '';
    if (el.providerWeb) el.providerWeb.checked = s.provider !== 'api';
    if (el.providerApi) el.providerApi.checked = s.provider === 'api';
    if (el.apiKeyGroup) el.apiKeyGroup.hidden = s.provider !== 'api';
    if (el.geminiApiKey) el.geminiApiKey.value = s.apiKey || '';
    if (el.settingEnableAgent) el.settingEnableAgent.checked = Boolean(s.enableAgent);
    if (el.settingMaxRequests) el.settingMaxRequests.value = String(s.maxRequestsPerTurn || 8);

    const connected = Boolean(state.connection.connected || state.settings?.apiKey);
    if (el.settingsConnectionDot) el.settingsConnectionDot.className = `status-dot${connected ? ' ok' : ''}`;
    if (el.settingsConnectionStatus) el.settingsConnectionStatus.textContent = state.connection.message || (connected ? 'Conectado' : 'Desconectado');
    if (el.settingsConnect) el.settingsConnect.textContent = connected ? 'Trocar de conta' : 'Conectar conta Google';

    // Usage cards
    if (el.usageToday) {
      const u = state.dailyUsage || {};
      el.usageToday.replaceChildren(
        element('div', 'usage-cell', ''),
        element('div', 'usage-cell', ''),
        element('div', 'usage-cell', '')
      );
      const cells = el.usageToday.children;
      cells[0].append(element('b', '', u.requests || 0), element('span', '', 'Solicitações hoje'));
      cells[1].append(element('b', '', (u.inputTokens || 0).toLocaleString('pt-BR')), element('span', '', 'Tokens de entrada'));
      cells[2].append(element('b', '', (u.outputTokens || 0).toLocaleString('pt-BR')), element('span', '', 'Tokens de saída'));
    }

    if (el.settingsGithubInfo) {
      el.settingsGithubInfo.textContent = state.git?.github?.message || 'Verificando GitHub CLI…';
    }

    el.settingsModal.hidden = false;
  }

  function closeSettingsModal() {
    if (el.settingsModal) el.settingsModal.hidden = true;
  }

  async function saveSettings() {
    const provider = el.providerApi?.checked ? 'api' : 'web';
    const apiKey = el.geminiApiKey?.value.trim() || '';
    const defaultMode = el.settingDefaultMode?.value || 'code';
    const enableAgent = Boolean(el.settingEnableAgent?.checked);
    const maxRequestsPerTurn = Number(el.settingMaxRequests?.value) || 8;
    const customSkillsDir = el.customSkillsPath?.value.trim() || '';

    await api.updateSettings({ provider, apiKey, defaultMode, enableAgent, maxRequestsPerTurn, customSkillsDir });
    acceptState(await api.getState());
    closeSettingsModal();
    showNotice('Configurações salvas.');
  }

  // SEND MESSAGE
  async function sendMessage(event) {
    event?.preventDefault();
    const text = el.composerText?.value.trim();
    const session = currentSession();
    if (!text || submitting || session?.busy || loading) return;

    const isChat = session?.mode === 'chat';
    const hasConnection = Boolean(state.connection.connected || state.settings?.apiKey);
    if (!hasConnection) {
      return showNotice('Conecte sua conta Google ou configure a chave da API nas Configurações.', true);
    }
    if (!isChat && !state.engine.ready) {
      return showNotice('Prepare o motor oficial antes de enviar no modo Code.', true);
    }

    const selectedModel = el.modelSelect?.value || 'gemini-3.8-flash';
    const submittedDraft = el.composerText?.value || '';
    submitting = true;
    showNotice('');
    renderControls();

    try {
      const id = await ensureSession(session?.mode || 'code');
      modelChoices.set(id, selectedModel);
      checkResult(await api.send({ sessionId: id, text, model: selectedModel }));
      if (activeId === id && el.composerText?.value === submittedDraft) {
        el.composerText.value = '';
        drafts.set(id, '');
        resizeComposer();
      }
    } catch (err) {
      showNotice(errorMessage(err), true);
    } finally {
      submitting = false;
      renderControls();
      if (el.composerText) el.composerText.focus();
    }
  }

  // PERMISSION DECISION
  async function decidePermission(id, allow) {
    if (permissionDecisions.has(id)) return;
    permissionDecisions.add(id);
    renderPermissions();
    try {
      checkResult(await api.decidePermission({ id, allow }));
      permissions.delete(id);
    } catch (err) {
      showNotice(errorMessage(err), true);
    } finally {
      permissionDecisions.delete(id);
      renderPermissions();
      renderSessions();
    }
  }

  // ATTACH MENU POPOVER
  function toggleAttachMenu(event) {
    event?.stopPropagation();
    if (!el.attachMenu) return;
    const willOpen = el.attachMenu.hidden;
    closeAllPopovers();
    if (willOpen) {
      el.attachMenu.hidden = false;
      el.attachButton?.setAttribute('aria-expanded', 'true');
    }
  }

  // ACCOUNT MENU POPOVER
  function toggleAccountMenu(event) {
    event?.stopPropagation();
    if (!el.accountMenu) return;
    const willOpen = el.accountMenu.hidden;
    closeAllPopovers();
    if (willOpen) {
      el.accountMenu.hidden = false;
      el.accountButton?.setAttribute('aria-expanded', 'true');
    }
  }

  function closeAllPopovers() {
    if (el.accountMenu) el.accountMenu.hidden = true;
    if (el.attachMenu) el.attachMenu.hidden = true;
    el.accountButton?.setAttribute('aria-expanded', 'false');
    el.attachButton?.setAttribute('aria-expanded', 'false');
  }

  // SETUP EVENT LISTENERS
  function setupListeners() {
    initSidebar();

    // Mode tabs
    el.modeChat?.addEventListener('click', () => switchMode('chat'));
    el.modeCode?.addEventListener('click', () => switchMode('code'));

    // New chat
    el.newChat?.addEventListener('click', () => {
      const mode = currentSession()?.mode || state.settings?.defaultMode || 'code';
      createNewSession(mode);
    });

    // Account popover
    el.accountButton?.addEventListener('click', toggleAccountMenu);
    el.accountConnect?.addEventListener('click', async () => {
      closeAllPopovers();
      connecting = true;
      try { checkResult(await api.connect()); }
      catch (err) { showNotice(errorMessage(err), true); }
      finally { connecting = false; render(); }
    });
    el.accountSettings?.addEventListener('click', () => {
      closeAllPopovers();
      openSettingsModal();
    });

    // Attach menu
    el.attachButton?.addEventListener('click', toggleAttachMenu);
    el.attachFolder?.addEventListener('click', async () => {
      closeAllPopovers();
      el.folderChip?.click();
    });
    el.attachSkills?.addEventListener('click', () => {
      closeAllPopovers();
      openSkillsModal();
    });

    // Folder selection
    el.folderChip?.addEventListener('click', async () => {
      choosingFolder = true;
      renderControls();
      try {
        const id = await ensureSession('code');
        const res = await api.selectFolder(id);
        if (!res?.canceled) {
          showNotice('');
          acceptState(await api.getState());
        }
      } catch (err) {
        showNotice(errorMessage(err), true);
      } finally {
        choosingFolder = false;
        renderControls();
      }
    });

    // Prepare engine
    el.prepareEngine?.addEventListener('click', async () => {
      try { checkResult(await api.prepareEngine()); }
      catch (err) { showNotice(errorMessage(err), true); }
    });

    // Composer & Send
    el.composer?.addEventListener('submit', sendMessage);
    el.composerText?.addEventListener('input', () => {
      if (activeId) drafts.set(activeId, el.composerText.value);
      resizeComposer();
      renderControls();
    });
    el.composerText?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Cancel
    el.cancel?.addEventListener('click', async () => {
      if (!activeId) return;
      el.cancel.disabled = true;
      try { checkResult(await api.cancel(activeId)); }
      catch (err) { showNotice(errorMessage(err), true); }
      finally { el.cancel.disabled = false; }
    });

    // Model select
    el.modelSelect?.addEventListener('change', () => {
      modelChoices.set(activeId, el.modelSelect.value);
    });

    // Skills modal
    el.skillsButton?.addEventListener('click', openSkillsModal);
    el.closeSkillsModal?.addEventListener('click', closeSkillsModal);
    el.skillsDoneBtn?.addEventListener('click', closeSkillsModal);
    el.skillsSearch?.addEventListener('input', openSkillsModal);
    el.refreshSkillsBtn?.addEventListener('click', async () => {
      await api.refreshSkills();
      acceptState(await api.getState());
      openSkillsModal();
    });

    // Settings modal
    el.closeSettingsModal?.addEventListener('click', closeSettingsModal);
    el.cancelSettingsBtn?.addEventListener('click', closeSettingsModal);
    el.saveSettingsBtn?.addEventListener('click', saveSettings);
    el.providerWeb?.addEventListener('change', () => { if (el.apiKeyGroup) el.apiKeyGroup.hidden = true; });
    el.providerApi?.addEventListener('change', () => { if (el.apiKeyGroup) el.apiKeyGroup.hidden = false; });
    el.settingsConnect?.addEventListener('click', async () => {
      try { checkResult(await api.connect()); }
      catch (err) { showNotice(errorMessage(err), true); }
    });
    el.settingsDisconnect?.addEventListener('click', async () => {
      if (api.disconnect) {
        try { checkResult(await api.disconnect()); }
        catch (err) { showNotice(errorMessage(err), true); }
      }
    });

    // Settings tabs
    document.querySelectorAll('.settings-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const sec = tab.dataset.section;
        document.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.settings-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === sec));
      });
    });

    // Global keyboard shortcuts & click-outside & external links
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && a.href && (a.href.startsWith('https://') || a.href.startsWith('http://'))) {
        e.preventDefault();
        api?.openExternal?.(a.href);
        return;
      }
      if (!e.target.closest('#account-button') && !e.target.closest('#account-menu')) {
        if (el.accountMenu) el.accountMenu.hidden = true;
        el.accountButton?.setAttribute('aria-expanded', 'false');
      }
      if (!e.target.closest('#attach-button') && !e.target.closest('#attach-menu')) {
        if (el.attachMenu) el.attachMenu.hidden = true;
        el.attachButton?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const mode = e.shiftKey ? 'chat' : (currentSession()?.mode || 'code');
        createNewSession(mode);
      }
      if (e.key === 'Escape') {
        closeAllPopovers();
        closeSkillsModal();
        closeSettingsModal();
        // If there's an active permission, deny the last one
        const activePerms = [...permissions.values()].filter((p) => p.sessionId === activeId);
        if (activePerms.length) {
          decidePermission(activePerms[0].id, false);
        }
      }
    });
  }

  // INITIALIZATION
  setupListeners();
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

  api.getState().then(acceptState).catch((err) => {
    loading = false;
    showNotice(errorMessage(err), true);
    renderControls();
  });
})();
