/**
 * @param {import('puppeteer').Browser} browser
 * @returns {Promise<number|null>} max post id (integer) or null if not found
 */
async function getMaxPost(browser) {
    const postListUrl = 'https://soybooru.com/post/list';
    let page;
    try {
        page = await browser.newPage();
        console.log(`Navigating to: ${postListUrl}...`);
        await page.goto(postListUrl, { waitUntil: 'networkidle2', timeout: 15000 });

        // The latest post link is always at `a.thumb:nth-child(1)` and formatted
        // like `/post/view/12924`. Prefer that exact selector and pattern.
        let href = null;
        try {
            href = await page.$eval('a.thumb:nth-child(1)', (el) => el.getAttribute('href'));
        } catch (e) {
            href = null;
        }

        if (!href) {
            // Fallback: search any anchor whose href contains `/post/view/` and return the first match
            const links = await page.$$eval('a', (as) => as.map((a) => a.getAttribute('href')));
            href = links.find((h) => typeof h === 'string' && /\/post\/view\/(\d+)/.test(h)) || null;
        }

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
        if (page) await page.close();
    }
}

module.exports = { getMaxPost };