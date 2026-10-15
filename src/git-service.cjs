'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');

const run = promisify(execFile);

async function getProjectGitStatus(projectPath) {
  if (!projectPath) return { isGit: false, branch: null, dirty: 0, remote: null };
  try {
    await fs.access(path.join(projectPath, '.git'));
  } catch {
    return { isGit: false, branch: null, dirty: 0, remote: null };
  }

  try {
    const [branchRes, statusRes, remoteRes] = await Promise.allSettled([
      run('git', ['branch', '--show-current'], { cwd: projectPath, windowsHide: true, timeout: 5000 }),
      run('git', ['status', '--porcelain'], { cwd: projectPath, windowsHide: true, timeout: 5000 }),
      run('git', ['remote', 'get-url', 'origin'], { cwd: projectPath, windowsHide: true, timeout: 5000 }),
    ]);

    const branch = branchRes.status === 'fulfilled' ? branchRes.value.stdout.trim() : null;
    const dirtyLines = statusRes.status === 'fulfilled' ? statusRes.value.stdout.trim().split('\n').filter(Boolean) : [];
    let remote = remoteRes.status === 'fulfilled' ? remoteRes.value.stdout.trim() : null;
    if (remote) {
      remote = remote.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
    }

    return {
      isGit: true,
      branch: branch || 'HEAD descolado',
      dirty: dirtyLines.length,
      remote,
    };
  } catch {
    return { isGit: true, branch: null, dirty: 0, remote: null };
  }
}

async function getGitHubAuthStatus() {
  try {
    // Check if gh CLI is installed and authenticated
    const { stdout, stderr } = await run('gh', ['auth', 'status'], { windowsHide: true, timeout: 6000 });
    const output = `${stdout}\n${stderr}`;
    const loggedIn = /Logged in to github\.com account ([a-zA-Z0-9_-]+)/i.exec(output)
      || /account ([a-zA-Z0-9_-]+)/i.exec(output);
    if (loggedIn) {
      return { connected: true, username: loggedIn[1], message: `Conectado como @${loggedIn[1]}` };
    }
    if (/Logged in/i.test(output)) {
      return { connected: true, username: null, message: 'GitHub CLI conectado' };
    }
    return { connected: false, username: null, message: 'GitHub CLI não autenticado' };
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`;
    const loggedIn = /Logged in to github\.com account ([a-zA-Z0-9_-]+)/i.exec(output);
    if (loggedIn) {
      return { connected: true, username: loggedIn[1], message: `Conectado como @${loggedIn[1]}` };
    }
    return { connected: false, username: null, message: 'GitHub CLI não instalado ou não autenticado' };
  }
}

module.exports = { getProjectGitStatus, getGitHubAuthStatus };
