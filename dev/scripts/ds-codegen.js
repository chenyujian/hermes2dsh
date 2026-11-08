#!/usr/bin/env node
/**
 * Call DeepSeek to implement one prompt slice for hermes2dsh.
 * Usage: node dev/scripts/ds-codegen.js --prompt 01-strengthen-mappers [--dry-write]
 * Env: DEEPSEEK_API_KEY (required), DS_MODEL (default deepseek-chat), DS_BASE_URL
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const promptName = arg('--prompt', '01-strengthen-mappers');
const dryWrite = process.argv.includes('--dry-write');
const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DS_MODEL || 'deepseek-chat';
const base = (process.env.DS_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');

if (!apiKey) {
  console.error('Missing DEEPSEEK_API_KEY. Save it in vault / export it, then re-run.');
  process.exit(1);
}

const system = fs.readFileSync(path.join(root, 'dev/prompts/00-system.md'), 'utf8');
const promptPath = path.join(root, 'dev/prompts', `${promptName}.md`);
if (!fs.existsSync(promptPath)) {
  console.error('Prompt not found:', promptPath);
  process.exit(1);
}
const userPrompt = fs.readFileSync(promptPath, 'utf8');

// Attach current allowed files for context (best-effort from prompt)
const allow = [...userPrompt.matchAll(/^- (src\/[\w./-]+)/gm)].map((m) => m[1]);
const context = allow
  .filter((f) => fs.existsSync(path.join(root, f)))
  .map((f) => `\n### CURRENT ${f}\n${fs.readFileSync(path.join(root, f), 'utf8')}`)
  .join('\n');

const body = {
  model,
  temperature: 0.2,
  messages: [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${userPrompt}\n\n## 当前文件\n${context || '(无现有文件可附)'}\n`,
    },
  ],
};

console.log(`Calling DeepSeek model=${model} prompt=${promptName} …`);
const res = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error('DeepSeek error', res.status, await res.text());
  process.exit(1);
}
const data = await res.json();
const text = data.choices?.[0]?.message?.content || '';
fs.mkdirSync(path.join(root, 'dev/out'), { recursive: true });
const outRaw = path.join(root, 'dev/out', `${promptName}.raw.txt`);
fs.writeFileSync(outRaw, text);
console.log('Raw reply →', outRaw);

const re = /<<<FILE\s+([^\s>]+)>>>\r?\n([\s\S]*?)<<<END>>>/g;
let m;
let n = 0;
while ((m = re.exec(text)) !== null) {
  const rel = m[1].trim();
  const content = m[2].replace(/^\uFEFF/, '');
  if (!rel.startsWith('src/')) {
    console.warn('Skip non-src path from model:', rel);
    continue;
  }
  const abs = path.join(root, rel);
  if (dryWrite) {
    console.log('[dry-write]', abs, `(${content.length} chars)`);
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    console.log('Wrote', rel);
  }
  n++;
}
if (!n) {
  console.error('No <<<FILE>>> blocks parsed. Inspect raw reply.');
  process.exit(2);
}
console.log(`Done. ${n} file(s). Run: npm run test:fixture`);
