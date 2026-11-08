import assert from 'node:assert/strict';
import {
  splitMarkdownSections,
  mergeMarkdownSectionsDetailed,
  normalizeSectionKey,
  sectionKeyOf,
} from '../src/util.js';

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

check('normalizeSectionKey strips markdown noise', () => {
  assert.equal(normalizeSectionKey('**Hello** World'), 'hello world');
  assert.equal(sectionKeyOf('## Hello World'), 'hello world');
  assert.equal(sectionKeyOf('§ Notes'), 'notes');
});

check('splitMarkdownSections keeps preamble and ## sections', () => {
  const { preamble, sections } = splitMarkdownSections(
    'intro line\n\n## One\nbody1\n\n## Two\nbody2\n'
  );
  assert.deepEqual(preamble.map((l) => l.trim()).filter(Boolean), ['intro line']);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].key, 'one');
  assert.equal(sections[1].key, 'two');
});

check('merge skips duplicate sections across sources', () => {
  const a = '## Shared\nfrom A\n\n## OnlyA\nx\n';
  const b = '## Shared\nfrom B\n\n## OnlyB\ny\n';
  const merged = mergeMarkdownSectionsDetailed(
    [
      { text: a, source: 'MEMORY.md' },
      { text: b, source: 'USER.md' },
    ],
    {}
  );
  const keys = merged.kept.map((s) => s.key).sort();
  assert.deepEqual(keys, ['onlya', 'onlyb', 'shared']);
  assert.equal(merged.skipped.length, 1);
  assert.equal(merged.skipped[0].key, 'shared');
  assert.match(merged.skipped[0].reason, /duplicate/);
  assert.match(merged.text, /from A/);
  assert.ok(!merged.text.includes('from B'));
});

check('merge skips sections already in destination', () => {
  const existing = '## Shared\nalready here\n';
  const src = '## Shared\nnew copy\n\n## Fresh\nz\n';
  const merged = mergeMarkdownSectionsDetailed([{ text: src, source: 'MEMORY.md' }], {
    existingText: existing,
  });
  assert.equal(merged.kept.length, 1);
  assert.equal(merged.kept[0].key, 'fresh');
  assert.equal(merged.skipped.length, 1);
  assert.equal(merged.skipped[0].reason, 'section already present in destination');
  assert.match(merged.text, /already here/);
  assert.match(merged.text, /Fresh/);
  assert.ok(!merged.text.includes('new copy'));
});

check('§ markers are sections too', () => {
  const merged = mergeMarkdownSectionsDetailed(
    [{ text: '§ Alpha\na\n\n§ Alpha\ndupe\n\n§ Beta\nb\n', source: 'm' }],
    {}
  );
  assert.deepEqual(
    merged.kept.map((s) => s.key).sort(),
    ['alpha', 'beta']
  );
  assert.equal(merged.skipped.length, 1);
});

console.log('memory-merge: all passed');
