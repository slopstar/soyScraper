const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { __test } = require('../src/scraper/downloader.js');

test('loadTagBlocklist normalizes tags and ignores comments', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soy-tags-'));
  const blocklistPath = path.join(tempDir, 'nsfw.txt');
  fs.writeFileSync(
    blocklistPath,
    ['# comment', '// comment', 'VERY_BAD_TAG', '  mixed   spacing  ', '', ''].join('\n'),
    'utf8'
  );

  const tags = __test.loadTagBlocklist(blocklistPath);
  assert.equal(tags.has('very bad tag'), true);
  assert.equal(tags.has('mixed spacing'), true);
  assert.equal(tags.size, 2);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('buildTagFilters wires nsfw and nsfl blocklists from options', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soy-tag-filters-'));
  const nsfwPath = path.join(tempDir, 'nsfw.txt');
  const nsflPath = path.join(tempDir, 'nsfl.txt');
  fs.writeFileSync(nsfwPath, 'gore\n', 'utf8');
  fs.writeFileSync(nsflPath, 'injury\n', 'utf8');

  const filters = __test.buildTagFilters({
    skipNsfw: true,
    skipNsfl: true,
    nsfwFile: nsfwPath,
    nsflFile: nsflPath,
  });

  assert.equal(filters.skipNsfw, true);
  assert.equal(filters.skipNsfl, true);
  assert.equal(filters.nsfwBlocklist.has('gore'), true);
  assert.equal(filters.nsflBlocklist.has('injury'), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
