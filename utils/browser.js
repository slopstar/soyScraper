const puppeteer = require('puppeteer');

async function launchBrowser(opts = {}) {
  return puppeteer.launch({
    headless: 'new',
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...opts,
  });
}

module.exports = { launchBrowser };
