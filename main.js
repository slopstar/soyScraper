const path = require('path');
const { downloadFromUrl } = require('./utils/downloadImages.js');
const { getMaxPost } = require('./utils/maxPostChecker.js');
const { launchBrowser } = require('./utils/browser.js');

/** Random delay between min and max ms to avoid bot detection */
function randomSleep(minMs = 3000, maxMs = 4000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`Waiting ${ms / 1000} seconds before next post...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(options = {}) {
    const { start = 1, end: optEnd } = options;
    const downloadDir = path.join(__dirname, 'downloadedImages');
    const browser = await launchBrowser();

    try {
        const maxPost = await getMaxPost(browser);
        const end = typeof optEnd === 'number' && optEnd > 0 ? optEnd : maxPost || start;
        console.log(`Downloading posts from ${start} to ${end}...`);

        const urlPrefix = 'https://soybooru.com/post/view/';
        for (let i = start; i <= end; i++) {
            const postUrl = `${urlPrefix}${i}`;
            await downloadFromUrl(postUrl, browser, { ...options, dir: downloadDir });
            if (i < end) await randomSleep(1000, 3500);
        }
    } finally {
        await browser.close();
    }
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const start = argv[0] ? parseInt(argv[0], 10) : 1;
    const end = argv[1] ? parseInt(argv[1], 10) : undefined;
    main({ start, end }).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}