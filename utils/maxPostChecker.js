/**
 * Fetches the maximum post ID from the SoyBooru by going to the post list page
 * and extracting the ID from the latest post link.
 * @param {import('puppeteer').Browser} browser
 * @returns {Promise<number|null>} max post id (integer) or null if not found
 */
async function getMaxPost(browser) {
    const postListUrl = 'https://soybooru.com/post/list';
    let page;

    // Open new page
    try {
        page = await browser.newPage();
        await page.goto(postListUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // The latest post link is always at `a.thumb:nth-child(1)` and formatted
        // like `/post/view/12924`. Prefer that exact selector and pattern.
        let href = null;
        try {
            href = await page.$eval('a.thumb:nth-child(1)', (el) => el.getAttribute('href'));
        } catch (e) {
            href = null;
        }

        // If link couldn't be found, return null
        if (!href) {
            console.warn('Could not locate latest post link on post list page');
            return null;
        }

        // Expect href in the form `/post/view/<number>` (relative path). Extract numeric id.
        const match = href.match(/^\/post\/view\/(\d+)$/) || href.match(/\/post\/view\/(\d+)/);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }

        return null;
    } catch (error) {
        console.error(`Error in getMaxPost: ${error.message}`);
        return null;
    } finally {
        // Ensure the page is closed
        if (page) await page.close();
    }
}

module.exports = { getMaxPost };