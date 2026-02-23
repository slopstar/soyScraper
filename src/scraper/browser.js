const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function isExecutable(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function findInPath(commandName) {
  if (!commandName || typeof commandName !== 'string') return null;
  if (commandName.includes(path.sep)) {
    return isExecutable(commandName) ? commandName : null;
  }

  const envPath = process.env.PATH || '';
  const segments = envPath.split(path.delimiter).filter(Boolean);
  for (const segment of segments) {
    const candidate = path.join(segment, commandName);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function resolveExplicitBrowserPath() {
  const fromEnv = process.env.SOYSCRAPER_BROWSER_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  return findInPath(fromEnv);
}

function resolveSystemBrowserPath() {
  const candidates = [
    'google-chrome-stable',
    'google-chrome',
    'chromium-browser',
    'chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];

  for (const candidate of candidates) {
    const match = findInPath(candidate);
    if (match) return match;
  }
  return null;
}

async function launchBrowser(opts = {}) {
  const headless = opts.headless == null ? 'new' : opts.headless;
  const launchOptions = {
    headless,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...opts,
  };

  const explicitBrowserPath = resolveExplicitBrowserPath();
  if (explicitBrowserPath && !launchOptions.executablePath) {
    launchOptions.executablePath = explicitBrowserPath;
  }

  try {
    return await puppeteer.launch(launchOptions);
  } catch (err) {
    const fallbackPath = resolveSystemBrowserPath();
    if (!fallbackPath || launchOptions.executablePath === fallbackPath) {
      throw err;
    }

    console.warn(
      `Bundled Puppeteer browser failed to launch. Retrying with system browser: ${fallbackPath}`
    );
    return puppeteer.launch({
      ...launchOptions,
      executablePath: fallbackPath,
    });
  }
}

module.exports = { launchBrowser };
