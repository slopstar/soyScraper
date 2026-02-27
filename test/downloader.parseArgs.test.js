const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/scraper/downloader.js');

test('parseArgs parses supported flags and value forms', () => {
  const options = parseArgs([
    '--start',
    '10',
    '--end=20',
    '--out-dir',
    'data/custom',
    '--retries=3',
    '--retry-delay',
    '1500',
    '--timeout=9000',
    '--max-posts',
    '8',
    '--fill-gaps',
    '--max-consecutive-failures=4',
    '--headless',
    '--skip-nsfw',
    '--skip-nsfl',
    '--nsfw-file',
    'config/nsfw.txt',
    '--nsfl-file=config/nsfl.txt',
    '--no-strict-media-safety',
  ]);

  assert.equal(options.start, 10);
  assert.equal(options.end, 20);
  assert.equal(options.outDir, 'data/custom');
  assert.equal(options.retries, 3);
  assert.equal(options.retryDelayMs, 1500);
  assert.equal(options.timeout, 9000);
  assert.equal(options.maxPosts, 8);
  assert.equal(options.fillGaps, true);
  assert.equal(options.maxConsecutiveFailures, 4);
  assert.equal(options.headless, true);
  assert.equal(options.skipNsfw, true);
  assert.equal(options.skipNsfl, true);
  assert.equal(options.nsfwFile, 'config/nsfw.txt');
  assert.equal(options.nsflFile, 'config/nsfl.txt');
  assert.equal(options.strictMediaSafety, false);
});

test('parseArgs defaults strictMediaSafety to true', () => {
  const options = parseArgs([]);
  assert.equal(options.strictMediaSafety, true);
});

test('parseArgs supports short and long help flags', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
});
