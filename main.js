const { downloadImage } = require('./downloadImages.js');
const puppeteer = require('puppeteer');

async function main() {
    // Launch browser once for all downloads
    const browser = await puppeteer.launch({
        headless: "new",
        defaultViewport: null,
    });

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