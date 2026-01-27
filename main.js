const path = require('path');
const { downloadFromUrl } = require('./utils/downloadImages.js');
const { getMaxPost } = require('./utils/maxPostChecker.js');
const { launchBrowser } = require('./utils/browser.js');
const { getLastDownloadedPost } = require('./utils/localFileManager.js');

/** Random delay between min and max ms to avoid bot detection */
function randomSleep(minMs = 5000, maxMs = 6000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`Waiting ${ms / 1000} seconds before next post...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(options = {}) {
    const { start: optStart, end: optEnd } = options;
    const downloadDir = path.join(__dirname, 'downloadedImages');
    const highestPost = getLastDownloadedPost(downloadDir);
    const defaultStart = highestPost != null ? highestPost + 1 : 1;
    const start = typeof optStart === 'number' && optStart > 0 ? optStart : defaultStart;

    const browser = await launchBrowser();

    try {
        const maxPost = await getMaxPost(browser);
        const end = typeof optEnd === 'number' && optEnd > 0 ? optEnd : maxPost || start;
        console.log(`Downloading posts from ${start} to ${end}...`);

        const urlPrefix = 'https://soybooru.com/post/view/';
        for (let i = start; i <= end; i++) {
            const postUrl = `${urlPrefix}${i}`;
            await downloadFromUrl(postUrl, browser, { ...options, dir: downloadDir });
            if (i < end) await randomSleep();
        }
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}