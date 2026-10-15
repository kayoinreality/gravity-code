'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function parseFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) return { attributes: {}, body: content };
  const yamlText = match[1];
  const body = match[2];
  const attributes = {};
  for (const line of yamlText.split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
      attributes[key] = val;
    }
  }
  return { attributes, body };
}

async function scanDirectory(baseDir, sourceLabel) {
  const skills = [];
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const skillDir = path.join(baseDir, skillName);
      let content = null;
      for (const candidate of ['SKILL.md', 'skill.md', 'README.md']) {
        try {
          content = await fs.readFile(path.join(skillDir, candidate), 'utf8');
          break;
        } catch {}
      }
      if (!content) continue;
      const { attributes, body } = parseFrontmatter(content);
      const name = attributes.name || skillName;
      const description = attributes.description || body.slice(0, 160).replace(/[#*`\n]/g, ' ').trim();
      skills.push({
        id: `${sourceLabel}:${skillName}`,
        name,
        description,
        source: sourceLabel,
        directory: skillDir,
        instructions: body.trim(),
      });
    }
  } catch {}
  return skills;
}

async function discoverSkills({ projectPath, customDir } = {}) {
  const home = os.homedir();
  const searchTargets = [
    { dir: path.join(home, '.claude', 'skills'), label: 'Global (~/.claude/skills)' },
    { dir: path.join(home, '.gemini', 'config', 'skills'), label: 'Gemini (~/.gemini/skills)' },
  ];
  if (customDir) {
    searchTargets.push({ dir: customDir, label: 'Personalizado' });
  }
  if (projectPath) {
    searchTargets.push(
      { dir: path.join(projectPath, '.claude', 'skills'), label: 'Projeto (.claude/skills)' },
      { dir: path.join(projectPath, '.agents', 'skills'), label: 'Projeto (.agents/skills)' }
    );
  }

  const all = [];
  for (const target of searchTargets) {
    const found = await scanDirectory(target.dir, target.label);
    all.push(...found);
  }

  // Deduplicate by name, preferring project over global
  const unique = new Map();
  for (const skill of all) {
    unique.set(skill.name, skill);
  }
  return Array.from(unique.values());
}

function formatSkillsForPrompt(skills = []) {
  if (!skills.length) return '';
  const blocks = skills.map(skill => {
    return `<skill name="${skill.name}">\n${skill.instructions}\n</skill>`;
  });
  return `<gravity-skills>\n${blocks.join('\n\n')}\n</gravity-skills>`;
}

module.exports = { discoverSkills, formatSkillsForPrompt };
