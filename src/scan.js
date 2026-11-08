import path from 'node:path';
import {
  exists,
  isDir,
  isFile,
  findSkillFiles,
  skillNameFromPath,
  listFilesRecursive,
  loadYamlFile,
  secretKeyHint,
} from './util.js';

/**
 * Scan a Hermes home directory and return a structured inventory.
 * Does not throw if paths are missing — callers handle empty inventory.
 */
export function scanHermesHome(hermesHome, options = {}) {
  const inventory = {
    hermesHome,
    exists: exists(hermesHome) && isDir(hermesHome),
    soul: null,
    memories: [],
    skills: [],
    agentsMd: null,
    config: null,
    secrets: [],
    cron: [],
    notes: [],
  };

  if (!inventory.exists) {
    inventory.notes.push(
      `Hermes home not found: ${hermesHome}. Nothing to migrate. Pass --hermes-home or create ~/.hermes.`
    );
    return inventory;
  }

  const soulPath = path.join(hermesHome, 'SOUL.md');
  if (isFile(soulPath)) {
    inventory.soul = { path: soulPath, rel: 'SOUL.md' };
  }

  for (const rel of ['memories/MEMORY.md', 'memories/USER.md']) {
    const p = path.join(hermesHome, rel);
    if (isFile(p)) {
      inventory.memories.push({ path: p, rel });
    }
  }

  const skillsRoot = path.join(hermesHome, 'skills');
  for (const skillFile of findSkillFiles(skillsRoot)) {
    const name = skillNameFromPath(skillFile, skillsRoot);
    inventory.skills.push({
      path: skillFile,
      rel: path.relative(hermesHome, skillFile),
      name,
      dir: path.dirname(skillFile),
    });
  }

  // AGENTS.md discovery: hermes home root, workspace/, or cwd if provided
  const agentsCandidates = [
    path.join(hermesHome, 'AGENTS.md'),
    path.join(hermesHome, 'workspace', 'AGENTS.md'),
  ];
  if (options.cwd) {
    agentsCandidates.push(path.join(options.cwd, 'AGENTS.md'));
  }
  for (const p of agentsCandidates) {
    if (isFile(p)) {
      inventory.agentsMd = {
        path: p,
        rel: path.relative(hermesHome, p) || path.basename(p),
      };
      break;
    }
  }

  const configPath = path.join(hermesHome, 'config.yaml');
  if (isFile(configPath)) {
    const raw = loadYamlFile(configPath);
    const safe = {};
    const secretKeys = [];
    for (const [k, v] of Object.entries(raw)) {
      if (secretKeyHint(k)) {
        secretKeys.push(k);
      } else {
        safe[k] = v;
      }
    }
    inventory.config = {
      path: configPath,
      rel: 'config.yaml',
      safeKeys: safe,
      secretKeys,
    };
  }

  // Secrets inventory (always listed; migration gated by --secrets)
  const secretCandidates = [
    { rel: '.env', path: path.join(hermesHome, '.env') },
    { rel: 'auth.json', path: path.join(hermesHome, 'auth.json') },
  ];
  for (const c of secretCandidates) {
    if (isFile(c.path)) {
      inventory.secrets.push({ ...c, kind: 'file' });
    }
  }
  const weixinDir = path.join(hermesHome, 'weixin');
  if (isDir(weixinDir)) {
    const files = listFilesRecursive(weixinDir);
    inventory.secrets.push({
      rel: 'weixin/',
      path: weixinDir,
      kind: 'dir',
      files: files.map((f) => path.relative(hermesHome, f)),
    });
  }

  const cronDir = path.join(hermesHome, 'cron');
  if (isDir(cronDir)) {
    for (const f of listFilesRecursive(cronDir)) {
      inventory.cron.push({
        path: f,
        rel: path.relative(hermesHome, f),
      });
    }
  }

  return inventory;
}
