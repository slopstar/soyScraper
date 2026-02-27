const fs = require('fs');
const path = require('path');
const downloadImagesModule = require('./downloadImages.js');
const maxPostCheckerModule = require('./maxPostChecker.js');
const browserModule = require('./browser.js');
const localFileManagerModule = require('../fs/localFileManager.js');
const { DOWNLOAD_DIR } = require('../config.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function commandExists(commandName) {
  if (!commandName || typeof commandName !== 'string') return false;
  if (commandName.includes(path.sep)) return isExecutable(commandName);
  const envPath = process.env.PATH || '';
  const segments = envPath.split(path.delimiter).filter(Boolean);
  for (const segment of segments) {
    const candidate = path.join(segment, commandName);
    if (isExecutable(candidate)) return true;
  }
  return false;
}

function getMediaSafetyPreflightConfig(options = {}) {
  const strictMediaSafety = Boolean(options.strictMediaSafety);
  const requireVirusScan = strictMediaSafety
    ? parseBoolean(process.env.SOYSCRAPER_REQUIRE_VIRUS_SCAN, true)
    : parseBoolean(process.env.SOYSCRAPER_REQUIRE_VIRUS_SCAN, false);
  const scannerBin = String(process.env.SOYSCRAPER_VIRUS_SCANNER_BIN || 'clamscan').trim();
  return { strictMediaSafety, requireVirusScan, scannerBin };
}

async function ensureVirusScannerAvailable(options = {}) {
  const { strictMediaSafety, requireVirusScan, scannerBin } = getMediaSafetyPreflightConfig(options);
  if (!strictMediaSafety || !requireVirusScan) return;
  if (commandExists(scannerBin)) return;

  const missingMessage = [
    `Strict media safety requires virus scanner "${scannerBin}", but it is not installed.`,
    `Run: npm run setup`,
    `Or bypass temporarily: SOYSCRAPER_REQUIRE_VIRUS_SCAN=false npm start`,
  ].join('\n');
  console.error(missingMessage);
  throw new Error(`Missing required virus scanner binary: ${scannerBin}`);
}

/** Random delay around 2s with +/-25% jitter (1500-2500ms). */
function randomSleep() {
  const baseMs = 2000;
  const jitterFraction = 0.25;
  const jitterMs = Math.floor(baseMs * jitterFraction);
  const minMs = baseMs - jitterMs;
  const maxMs = baseMs + jitterMs;
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`Waiting ${ms / 1000} seconds before next post...`);
  return sleep(ms);
}

function parseArgs(argv) {
  const options = { strictMediaSafety: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--start') options.start = argv[++i];
    else if (arg.startsWith('--start=')) options.start = arg.split('=').slice(1).join('=');
    else if (arg === '--end') options.end = argv[++i];
    else if (arg.startsWith('--end=')) options.end = arg.split('=').slice(1).join('=');
    else if (arg === '--out-dir') options.outDir = argv[++i];
    else if (arg.startsWith('--out-dir=')) options.outDir = arg.split('=').slice(1).join('=');
    else if (arg === '--retries') options.retries = argv[++i];
    else if (arg.startsWith('--retries=')) options.retries = arg.split('=').slice(1).join('=');
    else if (arg === '--max-consecutive-failures') options.maxConsecutiveFailures = argv[++i];
    else if (arg.startsWith('--max-consecutive-failures=')) options.maxConsecutiveFailures = arg.split('=').slice(1).join('=');
    else if (arg === '--retry-delay') options.retryDelayMs = argv[++i];
    else if (arg.startsWith('--retry-delay=')) options.retryDelayMs = arg.split('=').slice(1).join('=');
    else if (arg === '--timeout') options.timeout = argv[++i];
    else if (arg.startsWith('--timeout=')) options.timeout = arg.split('=').slice(1).join('=');
    else if (arg === '--max-posts') options.maxPosts = argv[++i];
    else if (arg.startsWith('--max-posts=')) options.maxPosts = arg.split('=').slice(1).join('=');
    else if (arg === '--fill-gaps') options.fillGaps = true;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--no-headless') options.headless = false;
    else if (arg === '--skip-nsfw') options.skipNsfw = true;
    else if (arg === '--skip-nsfl') options.skipNsfl = true;
    else if (arg === '--nsfw-file') options.nsfwFile = argv[++i];
    else if (arg.startsWith('--nsfw-file=')) options.nsfwFile = arg.split('=').slice(1).join('=');
    else if (arg === '--nsfl-file') options.nsflFile = argv[++i];
    else if (arg.startsWith('--nsfl-file=')) options.nsflFile = arg.split('=').slice(1).join('=');
    else if (arg === '--strict-media-safety') options.strictMediaSafety = true;
    else if (arg === '--no-strict-media-safety') options.strictMediaSafety = false;
  }

  if (options.start != null) options.start = parseInt(options.start, 10);
  if (options.end != null) options.end = parseInt(options.end, 10);
  if (options.retries != null) options.retries = parseInt(options.retries, 10);
  if (options.retryDelayMs != null) options.retryDelayMs = parseInt(options.retryDelayMs, 10);
  if (options.timeout != null) options.timeout = parseInt(options.timeout, 10);
  if (options.maxPosts != null) options.maxPosts = parseInt(options.maxPosts, 10);
  if (options.maxConsecutiveFailures != null) {
    options.maxConsecutiveFailures = parseInt(options.maxConsecutiveFailures, 10);
  }

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
  --start <n>         Start post number (default: last downloaded + 1, or 1 with --fill-gaps)
  --end <n>           End post number (default: latest on site, or local last with --fill-gaps)
  --max-posts <n>     Max number of posts to download from start
  --fill-gaps         Scan existing files, find missing post IDs, and backfill them
  --out-dir <path>    Download directory (default: ./data/downloadedImages)
  --retries <n>       Retries for max-post lookup (default: 10)
  --retry-delay <ms>  Base retry delay (default: 2000)
  --max-consecutive-failures <n>
                     Abort after N consecutive failed posts (default: 10;
                     fill-gaps mode keeps going unless this is set)
  --timeout <ms>      Navigation timeout per post (default: 30000)
  --headless          Run browser headless
  --no-headless       Run browser with UI
  --skip-nsfw         Skip posts with tags listed in the NSFW blocklist
  --nsfw-file <path>  Path to a newline-delimited NSFW tag list
  --skip-nsfl         Skip posts with tags listed in the NSFL blocklist
  --nsfl-file <path>  Path to a newline-delimited NSFL tag list
  --strict-media-safety
                     Enforce strict media checks (host allowlist, type validation,
                     quarantine write, optional antivirus scan)
  --no-strict-media-safety
                     Disable strict media checks (not recommended)
  setup helper: npm run setup
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

async function runDownloader(options = {}, deps = {}) {
  const runtimeDeps = {
    downloadFromUrl: downloadImagesModule.downloadFromUrl,
    getMaxPost: maxPostCheckerModule.getMaxPost,
    launchBrowser: browserModule.launchBrowser,
    getLastDownloadedPost: localFileManagerModule.getLastDownloadedPost,
    getDownloadedPostNumbers: localFileManagerModule.getDownloadedPostNumbers,
    ensureVirusScannerAvailable,
    randomSleep,
    buildTagFilters,
    ...deps,
  };
  const { start: optStart, end: optEnd } = options;
  const fillGaps = Boolean(options.fillGaps);
  const downloadDir = path.resolve(options.outDir || DOWNLOAD_DIR);
  const tagFilters = runtimeDeps.buildTagFilters(options);
  const highestPost = fillGaps ? null : runtimeDeps.getLastDownloadedPost(downloadDir);
  const defaultStart = fillGaps ? 1 : (highestPost != null ? highestPost + 1 : 1);
  const start = typeof optStart === 'number' && optStart > 0 ? optStart : defaultStart;

  await runtimeDeps.ensureVirusScannerAvailable(options);

  const browser = await runtimeDeps.launchBrowser({ headless: options.headless });
  const page = await browser.newPage();

  try {
    let downloadedPosts = null;
    if (fillGaps) {
      downloadedPosts = runtimeDeps.getDownloadedPostNumbers(downloadDir);
      if (downloadedPosts.size === 0) {
        console.log(`No downloaded posts found in ${downloadDir}.`);
        return;
      }
    }

    let end;
    if (typeof optEnd === 'number' && optEnd > 0) {
      end = optEnd;
    } else if (fillGaps) {
      end = 0;
      for (const postNumber of downloadedPosts) {
        if (postNumber > end) end = postNumber;
      }
      if (end <= 0) {
        console.log(`No valid downloaded post numbers found in ${downloadDir}.`);
        return;
      }
    } else {
      const maxPost = await withRetries(() => runtimeDeps.getMaxPost(browser), {
        retries: options.retries,
        retryDelayMs: options.retryDelayMs,
        label: 'getMaxPost',
      });
      end = maxPost || start;
    }

    const maxPosts = Number.isInteger(options.maxPosts) && options.maxPosts > 0 ? options.maxPosts : null;
    const maxConsecutiveFailures = Number.isInteger(options.maxConsecutiveFailures)
      ? options.maxConsecutiveFailures
      : (fillGaps ? Number.POSITIVE_INFINITY : 10);
    const failureLimitLabel = Number.isFinite(maxConsecutiveFailures) ? maxConsecutiveFailures : 'inf';
    let consecutiveFailures = 0;
    const targetPosts = [];
    if (fillGaps) {
      for (let postNumber = start; postNumber <= end; postNumber++) {
        if (!downloadedPosts.has(postNumber)) targetPosts.push(postNumber);
      }
      if (maxPosts && targetPosts.length > maxPosts) {
        targetPosts.length = maxPosts;
      }
      if (targetPosts.length === 0) {
        console.log(`No missing posts found between ${start} and ${end}.`);
        return;
      }
      console.log(`Found ${targetPosts.length} missing posts between ${start} and ${end}.`);
      console.log(`Backfilling gaps: ${targetPosts[0]} -> ${targetPosts[targetPosts.length - 1]}.`);
    } else {
      const effectiveEnd = maxPosts ? Math.min(end, start + maxPosts - 1) : end;
      if (effectiveEnd < start) {
        console.log(`No posts to download: resolved range ${start}..${effectiveEnd}.`);
        return;
      }
      console.log(`Downloading posts from ${start} to ${effectiveEnd}...`);
      for (let postNumber = start; postNumber <= effectiveEnd; postNumber++) {
        targetPosts.push(postNumber);
      }
    }

    const urlPrefix = 'https://soybooru.com/post/view/';
    for (let i = 0; i < targetPosts.length; i++) {
      const postNumber = targetPosts[i];
      const postUrl = `${urlPrefix}${postNumber}`;
      let sleptAfterFailure = false;
      try {
        await runtimeDeps.downloadFromUrl(postUrl, page, { ...options, dir: downloadDir, tagFilters });
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        console.warn(`Post ${postNumber} failed (${consecutiveFailures}/${failureLimitLabel}).`);
        try {
          await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: options.timeout ?? 30000 });
        } catch (reloadErr) {
          console.warn(`Failed to refresh page after error: ${reloadErr.message}`);
        }
        await runtimeDeps.randomSleep();
        sleptAfterFailure = true;
        if (Number.isFinite(maxConsecutiveFailures) && consecutiveFailures >= maxConsecutiveFailures) {
          throw new Error(`Aborting after ${consecutiveFailures} consecutive failed posts.`);
        }
      }
      if (!sleptAfterFailure && i < targetPosts.length - 1) await runtimeDeps.randomSleep();
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

module.exports = {
  runDownloader,
  parseArgs,
  printHelp,
  __test: {
    parseBoolean,
    commandExists,
    getMediaSafetyPreflightConfig,
    normalizeTag,
    loadTagBlocklist,
    buildTagFilters,
    withRetries,
  },
};
