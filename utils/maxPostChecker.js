const puppeteer = require('puppeteer');

// TODO: FIX THIS FILE!!!
/**
 * @param {puppeteer.Browser} browser
 * @returns {integer} maxPostNumber
 */
async function getMaxPost(browser) {
    const postListUrl = "https://soybooru.com/post/list";

    try {
        // Create new page
        const page = await browser.newPage();

        // Navigate to URL
        console.log(`Navigating to: ${postListUrl}...`);
        await page.goto(postListUrl, {
            waitUntil: "networkidle2",
            timeout: 3000,
        });

        // Get the first anchor child of .shm-image-list
        const mostRecentPost = await page.$('.shm-image-list > a:first-of-type');
        
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

module.exports = { getMaxPost };