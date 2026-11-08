import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check('plugin.json is valid Agent Plugins manifest', () => {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(j.name, 'hermes2dsh');
  assert.ok(j.version);
  assert.ok(j.description);
  assert.equal(j.license, 'MIT');
  assert.ok(j.extensions?.['com.deepseek.harness']);
});

check('package.json declares dsh.bundle.patch and bin', () => {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(j.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(j.bin?.hermes2dsh, './bin/hermes2dsh.js');
  assert.equal(j.main, './lib/dsh-plugin.js');
  assert.ok(j.files.includes('skills'));
  assert.ok(j.files.includes('plugin.json'));
});

check('cordis.patch.yml inserts hermes2dsh', () => {
  const y = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(y, /id:\s*hermes2dsh-skill/);
  assert.match(y, /name:\s*'hermes2dsh'/);
});

check('skill frontmatter + CLI path documented', () => {
  const skill = fs.readFileSync(path.join(root, 'skills/hermes2dsh/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname:\s*hermes2dsh\n/m);
  assert.match(skill, /description:/);
  assert.match(skill, /bin\/hermes2dsh\.js/);
  assert.match(skill, /settings\.yaml/);
  assert.ok(!/ark-[a-f0-9-]{20,}/i.test(skill));
});

check('harness command exists', () => {
  const cmd = fs.readFileSync(
    path.join(root, 'com.deepseek.harness/commands/hermes-import.md'),
    'utf8'
  );
  assert.match(cmd, /hermes-import/);
  assert.match(cmd, /\$\{PLUGIN_ROOT\}/);
});

check('dsh-plugin module exports cordis shape', async () => {
  const mod = await import(pathToFileURL(path.join(root, 'lib/dsh-plugin.js')).href);
  assert.equal(mod.name, 'hermes2dsh-skill');
  assert.deepEqual(mod.inject, ['skills']);
  assert.equal(typeof mod.apply, 'function');

  const registered = [];
  const effects = [];
  mod.apply({
    logger: { info() {}, error() {} },
    skills: {
      register(skill) {
        registered.push(skill);
        return () => {};
      },
    },
    effect(fn) {
      effects.push(fn);
      return fn();
    },
  });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'hermes2dsh');
  assert.ok(registered[0].content.includes('Hermes'));
  assert.equal(effects.length, 1);
});

console.log('plugin-pack: all passed');
