const { downloadImage } = require('./utils/downloadImages.js');
const { getMaxPost } = require('./utils/maxPostChecker.js');
const puppeteer = require('puppeteer');

async function main() {
    // Launch browser once for all downloads
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
    });

    // Loops through each post
    // TODO: find max post number prior to operation
    // TODO: establish how many posts have already been downloaded in prior downloading sessions
    try {
        const urlPrefix = "https://soybooru.com/post/view/"
        for (let i = 1; i <= 2; i++) {
            let postUrl = urlPrefix + i;
            await downloadImage(postUrl, browser);
        }
    } finally {
        // Close browser once at the end
        await browser.close();
        console.log("Browser closed");
    }
}

main().catch(console.error);