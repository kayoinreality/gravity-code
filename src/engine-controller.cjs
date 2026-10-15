'use strict';
const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const readline = require('node:readline');

const BASE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];
const TOOLS = [...BASE_TOOLS, 'Agent'];
const MODELS = ['gemini-3.8-flash', 'gemini-4-argon'];

function isModelAllowed(model) {
  if (typeof model !== 'string') return false;
  if (MODELS.includes(model)) return true;
  return /^gemini-[a-zA-Z0-9._-]+$/.test(model) && !/arbitrary/i.test(model);
}

function argumentsFor({ id, resume, model, enableAgent = false, appendSystemPrompt }) {
  if (!isModelAllowed(model)) throw Error('Modelo não permitido.');
  const activeTools = enableAgent ? TOOLS : BASE_TOOLS;
  const args = [
    '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--permission-prompt-tool', 'stdio', '--permission-mode', 'manual',
    '--tools', activeTools.join(','),
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
    '--safe-mode', '--restricted', '--disable-slash-commands', '--no-chrome',
    '--prompt-suggestions', 'false', '--model', model,
    ...(appendSystemPrompt ? ['--append-system-prompt', appendSystemPrompt] : []),
    ...(resume ? ['--resume', id] : ['--session-id', id]),
  ];
  return args;
}

class EngineTurn {
  constructor({
    engine, providerDirectory, projectPath, configPath, pipe, token, id, resume, model, text,
    enableAgent = false, appendSystemPrompt, onMessage, onPermission, onEnd, spawnProcess = spawn, extraEnv = {}
  }) {
    this.pending = new Map();
    this.done = false;
    this.backgroundTasks = 0;
    this.onEnd = onEnd;
    this.onPermission = onPermission;

    const env = {
      ...process.env, ...extraEnv,
      BUN_OPTIONS: '--preload=./preload.mjs',
      GRAVITY_PROJECT_DIR: projectPath,
      GRAVITY_SESSION_PIPE: pipe,
      GRAVITY_SESSION_TOKEN: token,
      ANTHROPIC_BASE_URL: 'https://gemini-native.invalid',
      ANTHROPIC_API_KEY: 'gravity-session-in-process',
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'gemini-3.8-flash',
      CLAUDE_CONFIG_DIR: configPath,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    };
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDECODE;
    delete env.ELECTRON_RUN_AS_NODE;

    const launchArgs = argumentsFor({ id, resume, model, enableAgent, appendSystemPrompt });
    this.child = spawnProcess(engine, launchArgs, { cwd: providerDirectory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', error => this.finish(error.message));
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => {});

    const lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (line.length > 8 * 1024 * 1024) { this.cancel(); return; }
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (this.done) return;

      if (message.type === 'control_response' && message.response?.request_id === this.initId) {
        if (message.response.subtype === 'error') {
          this.finish(message.response.error || 'Falha ao iniciar o motor.');
          this.child.kill();
          return;
        }
        this.write({ type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text }] } });
      } else if (message.type === 'control_request') {
        if (message.request?.subtype === 'can_use_tool') {
          const permission = { id: message.request_id, sessionId: id, toolName: message.request.tool_name, input: message.request.input };
          this.pending.set(permission.id, permission);
          onPermission?.(permission);
        } else {
          this.write({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'Este diálogo não é suportado nesta versão.' } });
        }
      } else if (message.type === 'control_cancel_request') {
        this.pending.delete(message.request_id);
        onPermission?.({ id: message.request_id, sessionId: id, closed: true });
      } else {
        if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
          this.backgroundTasks = (message.tasks || []).filter(task => !task.ambient).length;
        }
        onMessage?.(message);
        if (message.type === 'result' && !this.backgroundTasks) {
          this.finish(message.is_error ? message.result || message.errors?.join('\n') || 'O motor encerrou com erro.' : null);
          this.child.stdin.end();
          this.exitTimer = setTimeout(() => this.terminate(), 3000);
          this.exitTimer.unref();
        }
      }
    });

    this.child.on('close', code => {
      clearTimeout(this.exitTimer);
      this.finish(code ? 'O motor encerrou antes de concluir.' : 'O motor encerrou sem resposta.');
    });

    this.initId = randomUUID();
    this.write({ type: 'control_request', request_id: this.initId, request: { subtype: 'initialize', hooks: {}, promptSuggestions: false, agentProgressSummaries: false } });
  }

  write(value) {
    if (!this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(value) + '\n');
  }

  decide(id, allow) {
    const permission = this.pending.get(id);
    if (!permission || this.done) return false;
    this.pending.delete(id);
    this.write({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: id,
        response: allow ? { behavior: 'allow', updatedInput: permission.input } : { behavior: 'deny', message: 'O usuário recusou esta ação.' },
      },
    });
    this.onPermission?.({ id, sessionId: permission.sessionId, closed: true });
    return true;
  }

  finish(error) {
    if (this.done) return;
    this.done = true;
    for (const [id, value] of this.pending) this.onPermission?.({ id, sessionId: value.sessionId, closed: true });
    this.pending.clear();
    this.onEnd?.(error);
  }

  terminate() {
    if (process.platform === 'win32' && this.child.pid) {
      execFile('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      this.child.kill();
    }
  }

  cancel() {
    if (this.done) return;
    this.finish('Operação interrompida.');
    this.terminate();
  }
}

module.exports = { EngineTurn, argumentsFor, TOOLS, BASE_TOOLS, MODELS, isModelAllowed };
