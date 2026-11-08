import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const MAPPINGS_DIR = path.join(ROOT, 'mappings');

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return path.resolve(p);
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function writeText(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
}

export function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/** Very small YAML-ish reader for simple mappings / Hermes config.yaml (no deps). */
export function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  const stack = [{ indent: -1, obj: result, key: null, isList: false }];

  const current = () => stack[stack.length - 1];

  while (i < lines.length) {
    let line = lines[i];
    i += 1;
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= current().indent) {
      stack.pop();
    }

    if (trimmed.startsWith('- ')) {
      const parent = current();
      const valueRaw = trimmed.slice(2).trim();
      if (!Array.isArray(parent.obj[parent.key])) {
        parent.obj[parent.key] = [];
      }
      if (valueRaw.includes(':') && !valueRaw.startsWith('"') && !valueRaw.startsWith("'")) {
        // list of maps — not needed for v0.1; store as string
        parent.obj[parent.key].push(parseScalar(valueRaw));
      } else {
        parent.obj[parent.key].push(parseScalar(valueRaw));
      }
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();

    if (value === '') {
      // nested object or upcoming list
      const obj = {};
      current().obj[key] = obj;
      stack.push({ indent, obj, key, isList: false });
    } else {
      current().obj[key] = parseScalar(value);
    }
  }

  return result;
}

function parseScalar(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function loadYamlFile(file) {
  if (!exists(file)) return {};
  return parseSimpleYaml(readText(file));
}

export function loadMappings() {
  const pathsFile = path.join(MAPPINGS_DIR, 'paths.yaml');
  const modelsFile = path.join(MAPPINGS_DIR, 'models.yaml');
  return {
    paths: loadYamlFile(pathsFile),
    models: loadYamlFile(modelsFile),
  };
}

/** Walk dir for files named SKILL.md under the skills tree. */
export function findSkillFiles(skillsRoot) {
  const found = [];
  if (!isDir(skillsRoot)) return found;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name === 'SKILL.md') {
        found.push(full);
      }
    }
  }

  walk(skillsRoot);
  return found;
}

export function skillNameFromPath(skillFile, skillsRoot) {
  const rel = path.relative(skillsRoot, path.dirname(skillFile));
  const parts = rel.split(path.sep).filter(Boolean);
  // Flatten: use the directory that directly contains SKILL.md
  return parts[parts.length - 1] || 'unnamed-skill';
}

export function listFilesRecursive(dir) {
  const out = [];
  if (!isDir(dir)) return out;
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  walk(dir);
  return out;
}

/* ------------------------------------------------------------------ *
 * Markdown section helpers (memory merge)
 *
 * A "section" starts at a `##` (any # level) heading or at a `§` marker.
 * Section identity is the normalized heading title, so the same section
 * coming from two different memory files (or already present in the
 * destination MERGED.md) is merged only once.
 * ------------------------------------------------------------------ */

export const SECTION_HEADING_RE = /^(?:#{1,6}\s+\S|§)/;

export function isSectionHeading(line) {
  if (typeof line !== 'string') return false;
  return SECTION_HEADING_RE.test(line.trim());
}

export function normalizeSectionKey(title) {
  return String(title == null ? '' : title)
    .replace(/[`*_]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function sectionKeyOf(line) {
  const m = /^(?:#{1,6}\s+|§\s*)(.*)$/.exec(String(line == null ? '' : line).trim());
  if (!m) return null;
  const key = normalizeSectionKey(m[1]);
  return key || null;
}

/** Split markdown text into { preamble: string[], sections: [{key,title,lines}] }. */
export function splitMarkdownSections(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
  const preamble = [];
  const sections = [];
  let cur = null;

  for (const line of lines) {
    if (isSectionHeading(line)) {
      const key = sectionKeyOf(line) || `untitled-${sections.length + 1}`;
      cur = { key, title: line.trim(), lines: [line] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  return { preamble, sections };
}

/**
 * Merge markdown parts section-by-section.
 *
 * @param {Array<string|{text?:string, source?:string}>} parts
 * @param {{ existingText?: string }} [opts] markdown already present in the dest,
 *        its sections are treated as "already migrated" and skipped.
 * @returns {{ text: string, kept: Array, skipped: Array, newPreambleLines: number }}
 */
export function mergeMarkdownSectionsDetailed(parts, opts = {}) {
  const existingText = typeof opts.existingText === 'string' ? opts.existingText : '';
  const existing = splitMarkdownSections(existingText);

  const seen = new Map();
  for (const sec of existing.sections) {
    if (!seen.has(sec.key)) seen.set(sec.key, { origin: 'destination' });
  }

  const preamble = [];
  const seenPreamble = new Set();
  let newPreambleLines = 0;

  const pushPreamble = (line, { fromSource = false } = {}) => {
    const t = line.trim();
    if (!t) {
      preamble.push('');
      return;
    }
    if (seenPreamble.has(t)) return;
    seenPreamble.add(t);
    preamble.push(line);
    if (fromSource) newPreambleLines += 1;
  };

  for (const line of existing.preamble) pushPreamble(line);

  const kept = [];
  const skipped = [];
  const list = Array.isArray(parts) ? parts : parts ? [parts] : [];

  list.forEach((raw, idx) => {
    const isObj = raw !== null && typeof raw === 'object';
    const text = isObj
      ? typeof raw.text === 'string'
        ? raw.text
        : ''
      : typeof raw === 'string'
        ? raw
        : '';
    if (!text.trim()) return;

    const source = isObj && raw.source ? String(raw.source) : `source#${idx + 1}`;
    const parsed = splitMarkdownSections(text);

    for (const line of parsed.preamble) pushPreamble(line, { fromSource: true });

    for (const sec of parsed.sections) {
      const prior = seen.get(sec.key);
      if (prior) {
        skipped.push({
          key: sec.key,
          title: sec.title,
          source,
          reason:
            prior.origin === 'destination'
              ? 'section already present in destination'
              : `duplicate of section from ${prior.origin}`,
        });
        continue;
      }
      seen.set(sec.key, { origin: source });
      kept.push({ key: sec.key, title: sec.title, source, lines: sec.lines });
    }
  });

  const out = [];
  const preambleOut = trimBlankEdges(preamble);
  if (preambleOut.length) {
    out.push(...preambleOut);
    if (kept.length) out.push('');
  }
  for (const sec of kept) {
    out.push(...trimBlankEdges(sec.lines));
    out.push('');
  }

  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return {
    text: body ? `${body}\n` : '',
    kept,
    skipped,
    newPreambleLines,
  };
}

function trimBlankEdges(lines) {
  const out = Array.isArray(lines) ? lines.slice() : [];
  while (out.length && !String(out[0]).trim()) out.shift();
  while (out.length && !String(out[out.length - 1]).trim()) out.pop();
  return out;
}

/** Merge markdown by ## or § sections; keep first occurrence of each heading. */
export function mergeMarkdownSections(parts, opts) {
  return mergeMarkdownSectionsDetailed(parts, opts).text;
}

export function secretKeyHint(key) {
  const k = String(key).toLowerCase();
  // Avoid false positives like max_tokens / token_limit
  if (k === 'max_tokens' || k === 'token_limit' || k.endsWith('_tokens') || k.endsWith('_token_limit')) {
    return false;
  }
  return (
    /(^|_)(api_?key|access_?key|secret|password|passwd|auth|token)(_|$)/.test(k) ||
    k.includes('api_key') ||
    k.includes('apikey') ||
    k.includes('access_token') ||
    k.includes('refresh_token') ||
    k.includes('client_secret') ||
    k.endsWith('_secret') ||
    k.endsWith('_password') ||
    k.endsWith('_pass')
  );
}

export async function confirm(question) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const a = String(answer || '').trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}
