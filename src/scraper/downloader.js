const fs = require('fs');
const path = require('path');
const { downloadFromUrl } = require('./downloadImages.js');
const { getMaxPost } = require('./maxPostChecker.js');
const { launchBrowser } = require('./browser.js');
const { getLastDownloadedPost } = require('../fs/localFileManager.js');
const { DOWNLOAD_DIR } = require('../config.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay between min and max ms (default 20% jitter around 5s) to avoid bot detection */
function randomSleep(minMs = 4000, maxMs = 6000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`Waiting ${ms / 1000} seconds before next post...`);
  return sleep(ms);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--start') options.start = argv[++i];
    else if (arg.startsWith('--start=')) options.start = arg.split('=').slice(1).join('=');
    else if (arg === '--end') options.end = argv[++i];
    else if (arg.startsWith('--end=')) options.end = arg.split('=').slice(1).join('=');
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg.startsWith('--out-dir=')) options.outDir = arg.split('=').slice(1).join('=');
    else if (arg === '--delay-min') options.delayMinMs = argv[++i];
    else if (arg.startsWith('--delay-min=')) options.delayMinMs = arg.split('=').slice(1).join('=');
    else if (arg === '--delay-max') options.delayMaxMs = argv[++i];
    else if (arg.startsWith('--delay-max=')) options.delayMaxMs = arg.split('=').slice(1).join('=');
    else if (arg === '--retries') options.retries = argv[++i];
    else if (arg.startsWith('--retries=')) options.retries = arg.split('=').slice(1).join('=');
    else if (arg === '--retry-delay') options.retryDelayMs = argv[++i];
    else if (arg.startsWith('--retry-delay=')) options.retryDelayMs = arg.split('=').slice(1).join('=');
    else if (arg === '--timeout') options.timeout = argv[++i];
    else if (arg.startsWith('--timeout=')) options.timeout = arg.split('=').slice(1).join('=');
    else if (arg === '--max-posts') options.maxPosts = argv[++i];
    else if (arg.startsWith('--max-posts=')) options.maxPosts = arg.split('=').slice(1).join('=');
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--no-headless') options.headless = false;
    else if (arg === '--skip-nsfw') options.skipNsfw = true;
    else if (arg === '--skip-nsfl') options.skipNsfl = true;
    else if (arg === '--nsfw-file') options.nsfwFile = argv[++i];
    else if (arg.startsWith('--nsfw-file=')) options.nsfwFile = arg.split('=').slice(1).join('=');
    else if (arg === '--nsfl-file') options.nsflFile = argv[++i];
    else if (arg.startsWith('--nsfl-file=')) options.nsflFile = arg.split('=').slice(1).join('=');
  }

  if (options.start != null) options.start = parseInt(options.start, 10);
  if (options.end != null) options.end = parseInt(options.end, 10);
  if (options.delayMinMs != null) options.delayMinMs = parseInt(options.delayMinMs, 10);
  if (options.delayMaxMs != null) options.delayMaxMs = parseInt(options.delayMaxMs, 10);
  if (options.retries != null) options.retries = parseInt(options.retries, 10);
  if (options.retryDelayMs != null) options.retryDelayMs = parseInt(options.retryDelayMs, 10);
  if (options.timeout != null) options.timeout = parseInt(options.timeout, 10);
  if (options.maxPosts != null) options.maxPosts = parseInt(options.maxPosts, 10);

  return options;
}

function normalizeTag(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadTagBlocklist(filePath) {
  if (!filePath || typeof filePath !== 'string') return new Set();
  const resolved = path.resolve(filePath);
  try {
    const contents = fs.readFileSync(resolved, 'utf8');
    const tags = contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
      .map(normalizeTag)
      .filter(Boolean);
    return new Set(tags);
  } catch (err) {
    console.warn(`Tag blocklist not found: ${filePath}`);
    return new Set();
  }
}

function buildTagFilters(options) {
  const skipNsfw = Boolean(options.skipNsfw);
  const skipNsfl = Boolean(options.skipNsfl);
  const nsfwBlocklist = skipNsfw ? loadTagBlocklist(options.nsfwFile) : new Set();
  const nsflBlocklist = skipNsfl ? loadTagBlocklist(options.nsflFile) : new Set();

  if (skipNsfw && nsfwBlocklist.size === 0) {
    console.warn('NSFW skip enabled but the tag list is empty.');
  }
  if (skipNsfl && nsflBlocklist.size === 0) {
    console.warn('NSFL skip enabled but the tag list is empty.');
  }

  return { skipNsfw, skipNsfl, nsfwBlocklist, nsflBlocklist };
}

function printHelp() {
  console.log(`Usage: node src/cli.js [options]

Options:
  --start <n>         Start post number (default: last downloaded + 1)
  --end <n>           End post number (default: latest on site)
  --max-posts <n>     Max number of posts to download from start
  --out-dir <path>    Download directory (default: ./data/downloadedImages)
  --delay-min <ms>    Minimum delay between posts (default: 5000)
  --delay-max <ms>    Maximum delay between posts (default: 6000)
  --retries <n>       Retries per post (default: 10)
  --retry-delay <ms>  Base retry delay (default: 2000)
  --timeout <ms>      Navigation timeout per post (default: 30000)
  --headless          Run browser headless
  --no-headless       Run browser with UI
  --skip-nsfw         Skip posts with tags listed in the NSFW blocklist
  --nsfw-file <path>  Path to a newline-delimited NSFW tag list
  --skip-nsfl         Skip posts with tags listed in the NSFL blocklist
  --nsfl-file <path>  Path to a newline-delimited NSFL tag list
  -h, --help          Show this help text
`);
}

async function withRetries(task, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 10;
  const baseDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 2000;
  const label = options.label || 'task';
  let attempt = 0;
  while (true) {
    try {
      return await task(attempt + 1);
    } catch (err) {
      if (attempt >= retries) throw err;
      const backoff = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.floor(Math.random() * 250);
      console.warn(`Retrying ${label} after error: ${err.message}`);
      await sleep(backoff + jitter);
      attempt += 1;
    }
  }
}

async function runDownloader(options = {}) {
  const { start: optStart, end: optEnd } = options;
  const downloadDir = path.resolve(options.outDir || DOWNLOAD_DIR);
  const tagFilters = buildTagFilters(options);
  const highestPost = getLastDownloadedPost(downloadDir);
  const defaultStart = highestPost != null ? highestPost + 1 : 1;
  const start = typeof optStart === 'number' && optStart > 0 ? optStart : defaultStart;

  const browser = await launchBrowser({ headless: options.headless });
  const page = await browser.newPage();

  try {
    const maxPost = await withRetries(() => getMaxPost(browser), {
      retries: options.retries,
      retryDelayMs: options.retryDelayMs,
      label: 'getMaxPost',
    });
    const end = typeof optEnd === 'number' && optEnd > 0 ? optEnd : maxPost || start;
    const maxPosts = Number.isInteger(options.maxPosts) && options.maxPosts > 0 ? options.maxPosts : null;
    const effectiveEnd = maxPosts ? Math.min(end, start + maxPosts - 1) : end;
    const delayMin = Number.isInteger(options.delayMinMs) ? options.delayMinMs : 4000;
    const delayMax = Number.isInteger(options.delayMaxMs) ? options.delayMaxMs : 6000;
    console.log(`Downloading posts from ${start} to ${effectiveEnd}...`);

    const urlPrefix = 'https://soybooru.com/post/view/';
    for (let i = start; i <= effectiveEnd; i++) {
      const postUrl = `${urlPrefix}${i}`;
      await withRetries(
        () => downloadFromUrl(postUrl, page, { ...options, dir: downloadDir, tagFilters }),
        {
          retries: options.retries,
          retryDelayMs: options.retryDelayMs,
          label: `post ${i}`,
        }
      );
      if (i < effectiveEnd) await randomSleep(delayMin, delayMax);
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

module.exports = { runDownloader, parseArgs, printHelp };
