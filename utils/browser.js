const puppeteer = require('puppeteer');

async function launchBrowser(opts = {}) {
  const headless = opts.headless == null ? 'new' : opts.headless;
  return puppeteer.launch({
    headless,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...opts,
  });
}

module.exports = { launchBrowser };
