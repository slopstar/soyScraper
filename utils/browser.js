const puppeteer = require('puppeteer');

async function launchBrowser(opts = {}) {
  const defaults = { headless: 'new', defaultViewport: null };
  return await puppeteer.launch(Object.assign({}, defaults, opts));
}

async function withBrowser(fn, opts = {}) {
  const browser = await launchBrowser(opts);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

module.exports = { launchBrowser, withBrowser };
