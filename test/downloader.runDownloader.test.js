const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runDownloader } = require('../src/scraper/downloader.js');

function createBrowserHarness() {
  const page = {
    gotoCalls: [],
    closeCalled: false,
    async goto(url, options) {
      this.gotoCalls.push({ url, options });
    },
    async close() {
      this.closeCalled = true;
    },
  };

  const browser = {
    closeCalled: false,
    async newPage() {
      return page;
    },
    async close() {
      this.closeCalled = true;
    },
  };

  return { browser, page };
}

test('runDownloader computes range and downloads posts without real browser/network', async () => {
  const { browser, page } = createBrowserHarness();
  const downloadCalls = [];
  const tagFilters = {
    skipNsfw: false,
    skipNsfl: false,
    nsfwBlocklist: new Set(),
    nsflBlocklist: new Set(),
  };
  let ensureCalls = 0;
  let sleepCalls = 0;
  let launchOptions;

  await runDownloader(
    { outDir: 'data/test-downloads', headless: true, maxPosts: 3 },
    {
      buildTagFilters: () => tagFilters,
      getLastDownloadedPost: () => 9,
      ensureVirusScannerAvailable: async () => {
        ensureCalls += 1;
      },
      launchBrowser: async (options) => {
        launchOptions = options;
        return browser;
      },
      getMaxPost: async () => 999,
      downloadFromUrl: async (url, pageArg, optionsArg) => {
        downloadCalls.push({ url, pageArg, optionsArg });
      },
      randomSleep: async () => {
        sleepCalls += 1;
      },
    }
  );

  assert.deepEqual(launchOptions, { headless: true });
  assert.equal(ensureCalls, 1);
  assert.equal(downloadCalls.length, 3);
  assert.deepEqual(
    downloadCalls.map((call) => call.url),
    [
      'https://soybooru.com/post/view/10',
      'https://soybooru.com/post/view/11',
      'https://soybooru.com/post/view/12',
    ]
  );
  assert.equal(downloadCalls[0].pageArg, page);
  assert.equal(downloadCalls[0].optionsArg.dir, path.resolve('data/test-downloads'));
  assert.equal(downloadCalls[0].optionsArg.tagFilters, tagFilters);
  assert.equal(sleepCalls, 2);
  assert.equal(page.closeCalled, true);
  assert.equal(browser.closeCalled, true);
});

test('runDownloader aborts after max consecutive failures and still closes resources', async () => {
  const { browser, page } = createBrowserHarness();
  let downloadAttempts = 0;
  let sleepCalls = 0;

  await assert.rejects(
    runDownloader(
      { start: 1, end: 5, timeout: 321, maxConsecutiveFailures: 2 },
      {
        buildTagFilters: () => ({
          skipNsfw: false,
          skipNsfl: false,
          nsfwBlocklist: new Set(),
          nsflBlocklist: new Set(),
        }),
        getLastDownloadedPost: () => null,
        ensureVirusScannerAvailable: async () => {},
        launchBrowser: async () => browser,
        getMaxPost: async () => 5,
        downloadFromUrl: async () => {
          downloadAttempts += 1;
          throw new Error('download failed');
        },
        randomSleep: async () => {
          sleepCalls += 1;
        },
      }
    ),
    /Aborting after 2 consecutive failed posts/
  );

  assert.equal(downloadAttempts, 2);
  assert.equal(page.gotoCalls.length, 2);
  assert.equal(page.gotoCalls[0].url, 'https://soybooru.com/post/view/1');
  assert.deepEqual(page.gotoCalls[0].options, { waitUntil: 'networkidle2', timeout: 321 });
  assert.equal(sleepCalls, 2);
  assert.equal(page.closeCalled, true);
  assert.equal(browser.closeCalled, true);
});

test('runDownloader fill-gaps mode downloads only missing posts', async () => {
  const { browser, page } = createBrowserHarness();
  const downloadCalls = [];
  let sleepCalls = 0;
  let lastDownloadedLookups = 0;
  let downloadedSetLookups = 0;

  await runDownloader(
    { fillGaps: true, start: 1, end: 8, maxPosts: 3, outDir: 'data/test-downloads' },
    {
      buildTagFilters: () => ({
        skipNsfw: false,
        skipNsfl: false,
        nsfwBlocklist: new Set(),
        nsflBlocklist: new Set(),
      }),
      getLastDownloadedPost: () => {
        lastDownloadedLookups += 1;
        return 999;
      },
      getDownloadedPostNumbers: () => {
        downloadedSetLookups += 1;
        return new Set([1, 2, 3, 5, 8]);
      },
      ensureVirusScannerAvailable: async () => {},
      launchBrowser: async () => browser,
      getMaxPost: async () => 8,
      downloadFromUrl: async (url, pageArg, optionsArg) => {
        downloadCalls.push({ url, pageArg, optionsArg });
      },
      randomSleep: async () => {
        sleepCalls += 1;
      },
    }
  );

  assert.equal(lastDownloadedLookups, 0);
  assert.equal(downloadedSetLookups, 1);
  assert.deepEqual(
    downloadCalls.map((call) => call.url),
    [
      'https://soybooru.com/post/view/4',
      'https://soybooru.com/post/view/6',
      'https://soybooru.com/post/view/7',
    ]
  );
  assert.equal(downloadCalls[0].pageArg, page);
  assert.equal(downloadCalls[0].optionsArg.dir, path.resolve('data/test-downloads'));
  assert.equal(sleepCalls, 2);
  assert.equal(page.closeCalled, true);
  assert.equal(browser.closeCalled, true);
});

test('runDownloader fill-gaps defaults to local last post when end is not provided', async () => {
  const { browser, page } = createBrowserHarness();
  const downloadCalls = [];

  await runDownloader(
    { fillGaps: true, outDir: 'data/test-downloads' },
    {
      buildTagFilters: () => ({
        skipNsfw: false,
        skipNsfl: false,
        nsfwBlocklist: new Set(),
        nsflBlocklist: new Set(),
      }),
      getDownloadedPostNumbers: () => new Set([1, 2, 4, 5]),
      ensureVirusScannerAvailable: async () => {},
      launchBrowser: async () => browser,
      getMaxPost: async () => {
        throw new Error('getMaxPost should not be called in default fill-gaps mode');
      },
      downloadFromUrl: async (url, pageArg, optionsArg) => {
        downloadCalls.push({ url, pageArg, optionsArg });
      },
      randomSleep: async () => {},
    }
  );

  assert.deepEqual(
    downloadCalls.map((call) => call.url),
    ['https://soybooru.com/post/view/3']
  );
  assert.equal(downloadCalls[0].pageArg, page);
  assert.equal(downloadCalls[0].optionsArg.dir, path.resolve('data/test-downloads'));
  assert.equal(page.closeCalled, true);
  assert.equal(browser.closeCalled, true);
});
