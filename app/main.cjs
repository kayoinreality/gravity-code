'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto');
const { EngineTurn, MODELS } = require('../src/engine-controller.cjs');
const { RequestBudget, DailyUsageTracker } = require('../src/request-budget.cjs');
const manager = require('../src/engine-manager.cjs');
const { createAccountSurface, GOOGLE_AUTH_USER_AGENT } = require('../src/provider/account-surface.cjs');
const { getProjectGitStatus, getGitHubAuthStatus } = require('../src/git-service.cjs');
const { discoverSkills, formatSkillsForPrompt } = require('../src/skills-service.cjs');
const { ChatSession } = require('../src/chat-service.cjs');

const VERSION = '0.3.1', DEFAULT_REQUEST_LIMIT = 8;
if (process.argv.some(value => value.startsWith('--smoke-test='))) app.disableHardwareAcceleration();
app.setName('Gravity Code');

const root = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'GravityCodeStandalone');
app.setPath('userData', root);
if (!app.requestSingleInstanceLock()) app.quit();

let window, mainView, google, account, clientPromise, engine, providerDirectory, preparing = false, saveTimer;
const turns = new Map(), channels = new Map(), chatSessions = new Map();
let dailyTracker = new DailyUsageTracker();

const settings = {
  provider: 'web', // 'web' or 'api'
  apiKey: '',
  enableAgent: false,
  maxRequestsPerTurn: DEFAULT_REQUEST_LIMIT,
  customSkillsDir: '',
  defaultMode: 'code',
};

const state = {
  version: VERSION,
  activeId: null,
  sessions: [],
  models: [
    { id: MODELS[0], label: 'Gemini Flash' },
    { id: MODELS[1], label: 'Gemini Argon' },
  ],
  connection: { connected: false, message: 'Entre na sua conta Google ou use sua chave da API Gemini.' },
  engine: { ready: false, message: 'Prepare o motor oficial para começar no modo Code.', progress: 0 },
  settings,
  skills: [],
  git: { project: null, github: null },
  dailyUsage: { requests: 0, models: {}, inputTokens: 0, outputTokens: 0 },
};

function emit(event) {
  if (mainView && !mainView.webContents.isDestroyed()) mainView.webContents.send('gravity-event', event);
}

function changed() {
  emit({ type: 'state', state });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

async function save() {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'conversations.json');
  await fs.writeFile(file + '.pending', JSON.stringify({
    activeId: state.activeId,
    settings,
    dailyUsage: dailyTracker.toJSON(),
    sessions: state.sessions.map(s => ({ ...s, busy: false })),
  }));
  await fs.rename(file + '.pending', file).catch(() => {});
}

function find(id) {
  const s = state.sessions.find(s => s.id === id);
  if (!s) throw Error('Conversa não encontrada.');
  return s;
}

function createSession(mode = settings.defaultMode || 'code') {
  const id = randomUUID();
  state.sessions.unshift({
    id,
    title: 'Nova conversa',
    untitled: true,
    mode, // 'code' or 'chat'
    model: MODELS[0],
    projectPath: '',
    busy: false,
    messages: [],
    resume: false,
    selectedSkills: [],
    alwaysAllowedTools: [],
    threads: [],
    signatures: {},
  });
  state.activeId = id;
  changed();
  return id;
}

function addMessage(s, role, text) {
  const m = { id: randomUUID(), role, text, tools: [] };
  s.messages.push(m);
  return m;
}

function getGoogleSession() {
  if (!google) {
    google = session.fromPartition('persist:gravity-google');
    google.setPermissionRequestHandler((_wc, permission, callback) => {
      // Allow storage access required by Google Sign-In and cross-origin auth cookies
      if (permission === 'storage-access' || permission === 'top-level-storage-access') {
        return callback(true);
      }
      return callback(false);
    });
    // Google blocks sign-in from Chromium embedded webviews / abnormal Chrome versions.
    // Emulating Firefox Desktop passes Google's authentication checks cleanly.
    google.setUserAgent(GOOGLE_AUTH_USER_AGENT, 'pt-BR,pt;q=0.9,en;q=0.8');
  }
  return google;
}

async function cookies() {
  const stored = await getGoogleSession().cookies.get({ url: 'https://gemini.google.com/app' });
  if (!stored.some(c => c.name === '__Secure-1PSID')) {
    const e = Error('Conecte sua conta Google no Gravity Code.');
    e.code = 'GRAVITY_AUTH_REQUIRED';
    throw e;
  }
  return stored.map(c => `${c.name}=${c.value}`).join('; ');
}

async function client() {
  if (!clientPromise) clientPromise = (async () => {
    const { GeminiWeb } = await import('../src/provider/gemini-web.mjs');
    const auth = { cookieHeader: () => cookiesHeader, clear() { cookiesHeader = ''; } };
    let cookiesHeader = await cookies();
    return new GeminiWeb(auth, (input, init) => getGoogleSession().fetch(input, { ...init, credentials: 'include' })).initialize();
  })().catch(error => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}

async function channelFor(s) {
  const pipe = '\\\\.\\pipe\\gravity-code-' + randomUUID(), token = randomBytes(32).toString('hex');
  const context = { pipe, token, budget: new RequestBudget(settings.maxRequestsPerTurn), cancelled: false };
  const server = net.createServer(socket => {
    let data = '';
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) { socket.destroy(); return; }
      if (!data.includes('\n')) return;
      socket.removeAllListeners('data');
      try {
        const request = JSON.parse(data.trim());
        data = '';
        const got = Buffer.from(request.token || ''), want = Buffer.from(token);
        if (got.length !== want.length || !timingSafeEqual(got, want)) { socket.destroy(); return; }
        if (context.cancelled) throw Error('Operação interrompida.');

        if (request.action?.kind === 'consume') {
          const usage = context.budget.consume();
          s.requests = usage.used;
          s.estimatedInputTokens = (s.estimatedInputTokens || 0) + Math.max(0, Number(request.action.metrics?.estimatedInputTokens) || 0);
          dailyTracker.record({ model: s.model, requests: 1, inputTokens: request.action.metrics?.estimatedInputTokens || 0 });
          state.dailyUsage = dailyTracker.getToday();
          changed();
          socket.end(JSON.stringify({ ok: true, remaining: usage.remaining }));
        } else if (request.action?.kind === 'usage') {
          dailyTracker.record({
            model: s.model,
            requests: 0,
            inputTokens: request.action.usage?.input_tokens || 0,
            outputTokens: request.action.usage?.output_tokens || 0,
          });
          state.dailyUsage = dailyTracker.getToday();
          changed();
          socket.end(JSON.stringify({ ok: true }));
        } else if (request.action?.kind === 'thread') {
          if (!s.threads) s.threads = [];
          s.threads.unshift(request.action.thread);
          s.threads = s.threads.slice(0, 8);
          changed();
          socket.end(JSON.stringify({ ok: true }));
        } else if (request.action?.kind === 'signatures') {
          s.signatures = { ...(s.signatures || {}), ...(request.action.signatures || {}) };
          changed();
          socket.end(JSON.stringify({ ok: true }));
        } else if (request.action === 'threads-get') {
          socket.end(JSON.stringify({
            threads: s.threads || [],
            signatures: s.signatures || {},
            apiKey: settings.apiKey,
            provider: settings.provider,
          }));
        } else if (request.action === 'read') {
          const cookieHeader = await cookies().catch(() => '');
          socket.end(JSON.stringify({ cookieHeader, apiKey: settings.apiKey, provider: settings.provider }));
        } else if (request.action === 'require-login') {
          state.connection = { connected: false, message: 'Entre novamente na sua conta Google.' };
          changed();
          account.open();
          socket.end(JSON.stringify({ ok: true }));
        } else throw Error('Operação de sessão desconhecida.');
      } catch (error) {
        socket.end(JSON.stringify({ error: error.message }));
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  context.close = () => { context.cancelled = true; server.close(); };
  channels.set(s.id, context);
  return context;
}

async function copyProvider() {
  const target = path.join(root, 'provider', VERSION);
  await fs.mkdir(target, { recursive: true });
  const files = ['preload.mjs', 'engine-session.mjs', 'gemini-web.mjs', 'gemini-api.mjs', 'protocol.mjs', 'session-common.mjs'];
  for (const name of files) {
    await fs.copyFile(path.join(__dirname, '../src/provider', name), path.join(target, name));
  }
  return target;
}

function engineProgress(message, progress) {
  state.engine = { ready: false, message, progress, busy: true };
  changed();
}

async function prepare() {
  if (preparing) return { ok: false, message: 'A preparação já está em andamento.' };
  preparing = true;
  try {
    engine = await manager.prepareEngine(root, engineProgress);
    state.engine = { ready: true, message: 'Motor pronto.', progress: 100 };
    changed();
    return { ok: true };
  } catch (error) {
    state.engine = { ready: false, message: error.message, error: true, progress: 0 };
    changed();
    return { ok: false, message: error.message };
  } finally {
    preparing = false;
  }
}

async function refreshGit(projectPath) {
  const [projectGit, githubAuth] = await Promise.all([
    getProjectGitStatus(projectPath),
    getGitHubAuthStatus(),
  ]);
  state.git = { project: projectGit, github: githubAuth };
  changed();
  return state.git;
}

async function refreshSkills(projectPath) {
  state.skills = await discoverSkills({ projectPath, customDir: settings.customSkillsDir });
  changed();
  return state.skills;
}

async function markConnected() {
  state.connection = { connected: true, message: 'Conta Google conectada. Flash é o padrão; Argon pode ser escolhido por conversa.' };
  try {
    const prov = await client();
    if (prov.publicModels) {
      const models = prov.publicModels();
      if (models.length) state.models = models;
    }
  } catch {}
  changed();
}

async function send({ sessionId, text, model } = {}) {
  const s = find(sessionId);
  if (s.busy) throw Error('Esta conversa já está em andamento.');
  if (typeof text !== 'string' || !text.trim() || text.length > 200000) throw Error('Escreva uma mensagem de até 200.000 caracteres.');
  if (s.untitled || s.title === 'Nova conversa' || s.title === 'Nova conversa de chat' || s.title === 'Novo projeto') {
    s.title = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    s.untitled = false;
  }

  const isApi = settings.provider === 'api' || Boolean(settings.apiKey);
  if (!isApi && !state.connection.connected) {
    throw Error('Conecte sua conta Google ou configure a chave da API Gemini antes de enviar.');
  }

  // CHAT MODE (Normal Chat without Claude Code harness)
  if (s.mode === 'chat') {
    s.busy = true;
    s.model = model;
    addMessage(s, 'user', text.trim());
    const assistant = addMessage(s, 'assistant', '');
    changed();

    let chat = chatSessions.get(s.id);
    if (!chat) {
      chat = new ChatSession({
        provider: settings.provider,
        getGoogleSession,
        getApiKey: () => settings.apiKey,
        getWebClient: () => { clientPromise = undefined; return client(); },
        models: state.models,
      });
      chatSessions.set(s.id, chat);
    }

    try {
      const activeSkills = (state.skills || []).filter(skill => s.selectedSkills?.includes(skill.id) || s.selectedSkills?.includes(skill.name));
      const skillsPrompt = formatSkillsForPrompt(activeSkills);
      const result = await chat.send({
        messages: s.messages.slice(0, -1),
        model,
        skillsPrompt,
        onText: (streamed) => {
          assistant.text = streamed;
          changed();
        },
      });
      assistant.text = result.text;
      dailyTracker.record({ model: s.model, requests: 1 });
      state.dailyUsage = dailyTracker.getToday();
    } catch (err) {
      addMessage(s, 'system', err.message);
    } finally {
      s.busy = false;
      changed();
    }
    return { ok: true };
  }

  // CODE MODE (Claude Code Harness with Gemini engine)
  if (!engine) throw Error('Prepare o motor oficial antes de enviar no modo Code.');
  if (!s.projectPath) throw Error('Escolha uma pasta para o projeto antes de enviar.');
  await fs.access(s.projectPath);

  const channel = await channelFor(s);
  s.busy = true;
  s.model = model;
  s.requests = 0;
  s.estimatedInputTokens = 0;

  addMessage(s, 'user', text.trim());
  let assistant = addMessage(s, 'assistant', '');
  changed();

  const activeSkills = (state.skills || []).filter(skill => s.selectedSkills?.includes(skill.id) || s.selectedSkills?.includes(skill.name));
  const appendSystemPrompt = formatSkillsForPrompt(activeSkills);

  const turn = new EngineTurn({
    engine,
    providerDirectory,
    projectPath: s.projectPath,
    configPath: path.join(root, 'harness'),
    pipe: channel.pipe,
    token: channel.token,
    id: s.id,
    resume: s.resume,
    model,
    text,
    enableAgent: Boolean(settings.enableAgent),
    appendSystemPrompt,
    onPermission: permission => {
      // If user chose "always allow" for this tool in this session:
      if (s.alwaysAllowedTools?.includes(permission.toolName)) {
        turn.decide(permission.id, true);
        return;
      }
      emit({ type: 'permission', permission });
    },
    onMessage: message => {
      if (message.type === 'assistant') {
        const parts = message.message?.content || [];
        const texts = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
        if (texts) {
          if (assistant.text && assistant.text !== texts) assistant = addMessage(s, 'assistant', '');
          assistant.text = texts;
        }
        for (const tool of parts.filter(p => p.type === 'tool_use')) {
          assistant.tools.push({ id: tool.id, name: tool.name, status: 'Solicitada', detail: JSON.stringify(tool.input, null, 2) });
        }
      } else if (message.type === 'user') {
        for (const item of message.message?.content || []) {
          if (item.type === 'tool_result') {
            for (const m of s.messages) {
              for (const tool of m.tools || []) {
                if (tool.id === item.tool_use_id) tool.status = item.is_error ? 'Falhou' : 'Concluída';
              }
            }
          }
        }
      } else if (message.type === 'result') {
        s.resume = true;
        if (!assistant.text && message.result) assistant.text = message.result;
      }
      changed();
    },
    onEnd: error => {
      channel.close();
      channels.delete(s.id);
      turns.delete(s.id);
      s.busy = false;
      if (error) addMessage(s, 'system', error);
      changed();
      refreshGit(s.projectPath).catch(() => {});
    },
  });

  turns.set(s.id, turn);
  return { ok: true };
}

function register(name, handler) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== mainView?.webContents || event.senderFrame !== mainView.webContents.mainFrame) {
      throw Error('Origem recusada.');
    }
    return handler(...args);
  });
}

app.whenReady().then(async () => {
  await fs.mkdir(root, { recursive: true });

  // Load saved state and settings
  try {
    const old = JSON.parse(await fs.readFile(path.join(root, 'conversations.json'), 'utf8'));
    if (Array.isArray(old.sessions)) {
      state.sessions = old.sessions.filter(s => typeof s.id === 'string' && Array.isArray(s.messages)).map(s => ({ ...s, busy: false }));
    }
    state.activeId = old.activeId;
    if (old.settings) Object.assign(settings, old.settings);
    if (old.dailyUsage) dailyTracker = new DailyUsageTracker(old.dailyUsage);
  } catch {}

  state.dailyUsage = dailyTracker.getToday();
  state.settings = settings;

  if (!state.sessions.length) createSession();

  providerDirectory = await copyProvider();
  engine = await manager.verifiedEngine(root);
  if (engine) state.engine = { ready: true, message: 'Motor pronto.', progress: 100 };

  const preferences = {
    preload: path.join(__dirname, 'preload.cjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
  };
  const smokeMode = process.argv.some(value => value.startsWith('--smoke-test='));
  window = new BrowserWindow({
    width: 1360,
    height: 940,
    minWidth: 1020,
    minHeight: 720,
    title: 'Gravity Code',
    backgroundColor: '#131416',
    autoHideMenuBar: true,
    webPreferences: smokeMode ? { ...preferences, offscreen: true } : { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  mainView = smokeMode ? { webContents: window.webContents } : new WebContentsView({ webPreferences: preferences });
  if (!smokeMode) {
    mainView.setBackgroundColor('#131416');
    window.contentView.addChildView(mainView);
    const layout = () => {
      const { width, height } = window.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width, height });
    };
    layout();
    window.on('resize', layout);
    window.on('closed', () => { if (!mainView.webContents.isDestroyed()) mainView.webContents.close(); });
  }

  mainView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainView.webContents.on('will-navigate', event => event.preventDefault());
  mainView.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  account = createAccountSurface({
    getWindow: () => window,
    getGoogleSession,
    validate: () => { clientPromise = undefined; return client(); },
    onReady: markConnected,
  });

  // Silent validation of a stored Google session. Only reads the model catalogue; generates no text.
  if (!smokeMode) {
    cookies().then(() => client()).then(() => markConnected()).catch(() => {});
  }

  // Initial skills and git discovery
  const initialSession = state.sessions.find(s => s.id === state.activeId);
  refreshSkills(initialSession?.projectPath).catch(() => {});
  refreshGit(initialSession?.projectPath).catch(() => {});

  // Register IPC handlers
  register('gravity-state', () => state);
  register('gravity-create-session', (mode) => createSession(mode === 'chat' || mode === 'code' ? mode : undefined));
  register('gravity-set-mode', ({ sessionId, mode }) => {
    const s = find(sessionId);
    s.mode = mode;
    changed();
    return { ok: true, mode };
  });
  register('gravity-delete-session', (id) => {
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (state.activeId === id) state.activeId = state.sessions[0]?.id || null;
    if (!state.sessions.length) createSession();
    changed();
    return { ok: true };
  });
  register('gravity-toggle-skill', ({ sessionId, skillId }) => {
    const s = find(sessionId);
    if (!s.selectedSkills) s.selectedSkills = [];
    const index = s.selectedSkills.indexOf(skillId);
    if (index >= 0) s.selectedSkills.splice(index, 1);
    else s.selectedSkills.push(skillId);
    changed();
    return { ok: true, selectedSkills: s.selectedSkills };
  });
  register('gravity-refresh-skills', async () => {
    const s = state.sessions.find(item => item.id === state.activeId);
    return refreshSkills(s?.projectPath);
  });
  register('gravity-get-git-status', async () => {
    const s = state.sessions.find(item => item.id === state.activeId);
    return refreshGit(s?.projectPath);
  });
  register('gravity-update-settings', async (updates = {}) => {
    Object.assign(settings, updates);
    state.settings = settings;
    if (settings.apiKey) {
      state.connection = { connected: true, message: 'Chave da API Gemini configurada e pronta para uso.' };
    }
    changed();
    return { ok: true, settings };
  });
  register('gravity-always-allow-tool', ({ sessionId, toolName }) => {
    const s = find(sessionId);
    if (!s.alwaysAllowedTools) s.alwaysAllowedTools = [];
    if (!s.alwaysAllowedTools.includes(toolName)) s.alwaysAllowedTools.push(toolName);
    changed();
    return { ok: true };
  });
  register('gravity-prepare-engine', prepare);
  register('gravity-select-folder', async id => {
    const s = find(id);
    if (s.busy || s.resume) throw Error('Crie uma nova conversa para trocar a pasta.');
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Escolha a pasta do projeto' });
    if (!result.canceled) {
      s.projectPath = result.filePaths[0];
      await refreshGit(s.projectPath);
      await refreshSkills(s.projectPath);
      changed();
    }
    return { canceled: result.canceled, path: result.filePaths[0] };
  });
  register('gravity-connect', () => { account.open(); return { ok: true }; });
  register('gravity-open-external', (url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      const { shell } = require('electron');
      shell.openExternal(url).catch(() => {});
      return { ok: true };
    }
    return { ok: false };
  });
  register('gravity-disconnect', async () => {
    await getGoogleSession().clearStorageData();
    clientPromise = undefined;
    for (const chat of chatSessions.values()) chat.cancel();
    chatSessions.clear();
    state.connection = { connected: false, message: 'Conta Google desconectada.' };
    changed();
    return { ok: true };
  });
  register('gravity-set-active', (id) => {
    if (state.sessions.some(s => s.id === id)) { state.activeId = id; changed(); }
    return { ok: true };
  });
  register('gravity-send', send);
  register('gravity-cancel', id => {
    turns.get(id)?.cancel();
    chatSessions.get(id)?.cancel();
    const s = state.sessions.find(item => item.id === id);
    if (s) { s.busy = false; changed(); }
    return { ok: true };
  });
  register('gravity-permission', ({ id, allow } = {}) => {
    if (typeof allow !== 'boolean') throw Error('Decisão inválida.');
    for (const turn of turns.values()) {
      if (turn.decide(id, allow)) return { ok: true };
    }
    return { ok: false, message: 'Esta permissão não está mais pendente.' };
  });

  await mainView.webContents.loadFile(path.join(__dirname, 'index.html'));
  window.hide();
  window.show();

  const openingBounds = window.getBounds();
  window.setSize(openingBounds.width + 1, openingBounds.height);
  setTimeout(() => { if (!window.isDestroyed()) window.setSize(openingBounds.width, openingBounds.height); }, 80);

  app.on('second-instance', () => { window?.show(); window?.focus(); });

  const smoke = process.argv.find(value => value.startsWith('--smoke-test='));
  if (smoke) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const target = smoke.slice(13);
    const dom = await window.webContents.executeJavaScript('({url:location.href,title:document.title,text:document.body.innerText.slice(0,5000),api:typeof window.gravity,width:innerWidth,height:innerHeight})');
    await fs.writeFile(target + '.json', JSON.stringify({ title: window.getTitle(), ready: true, engineReady: !!engine, generations: 0, standalone: true, dom }));
    const picture = await window.webContents.capturePage();
    await fs.writeFile(target, picture.toPNG());
    app.quit();
  }
}).catch(async error => {
  const smoke = process.argv.find(value => value.startsWith('--smoke-test='));
  if (smoke) await fs.writeFile(smoke.slice(13) + '.error.txt', error.stack);
  else dialog.showErrorBox('Gravity Code', error.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  for (const turn of turns.values()) turn.cancel();
  for (const channel of channels.values()) channel.close();
  for (const chat of chatSessions.values()) chat.cancel();
});
