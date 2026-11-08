/**
 * hermes2dsh — DSH Cordis bundle entry.
 *
 * Registers skills/hermes2dsh/SKILL.md with ctx.skills when installed via:
 *   dsh plugin --profile <name> add <path|npm|git>
 *
 * Zero runtime npm deps. Optional peer: @deepseek-ai/dsh (provided by host).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'hermes2dsh-skill';
export const inject = ['skills'];

const SKILL_DIR = new URL('../skills/hermes2dsh/', import.meta.url);
const SKILL_FILE = new URL('SKILL.md', SKILL_DIR);

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const fm = match[1];
  const get = (key) => {
    const line = fm.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    if (!line) return undefined;
    let value = line[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  };
  return {
    name: get('name'),
    description: get('description'),
    whenToUse: get('whenToUse'),
  };
}

export function apply(ctx) {
  let raw;
  try {
    raw = readFileSync(SKILL_FILE, 'utf8');
  } catch (error) {
    ctx.logger?.error?.('hermes2dsh: cannot read SKILL.md: %s', error.message);
    return;
  }
  const meta = parseFrontmatter(raw);
  if (!meta?.name || !meta?.description) {
    ctx.logger?.error?.(
      'hermes2dsh: SKILL.md frontmatter missing name/description; skill not registered'
    );
    return;
  }
  const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trimStart();
  const skill = {
    name: meta.name,
    description: meta.description,
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
    content,
    source: 'runtime',
    resourceBase: {
      kind: 'directory',
      path: fileURLToPath(SKILL_DIR),
    },
  };
  ctx.logger?.info?.('hermes2dsh: registered skill "%s"', skill.name);
  ctx.effect(() => ctx.skills.register(skill));
}
