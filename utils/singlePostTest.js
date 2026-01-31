const path = require('path');
const { downloadFromUrl } = require('./downloadImages.js');
const { launchBrowser } = require('./browser.js');

/** Run the full download flow for a single post (same as main.js but one post, no sleep). */
async function main(options = {}) {
  const postNumber = options.post != null ? Number(options.post) : 1;
  if (!Number.isInteger(postNumber) || postNumber < 1) {
    throw new Error('Option "post" must be a positive integer');
  }

  const downloadDir = path.join(__dirname, '..', 'downloadedImages');
  const urlPrefix = 'https://soybooru.com/post/view/';
  const postUrl = `${urlPrefix}${postNumber}`;

  console.log(`Single-post test: downloading post ${postNumber} from ${postUrl}`);

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await downloadFromUrl(postUrl, page, { ...options, dir: downloadDir });
    console.log('Single-post test done.');
  } finally {
    await page.close();
    await browser.close();
  }
}

if (require.main === module) {
  const post = process.argv[2] != null ? parseInt(process.argv[2], 10) : 1;
  main({ post: isNaN(post) ? 1 : post }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
