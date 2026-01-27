/** @param {import('puppeteer').Browser} browser @returns {Promise<number|null>} */
async function getMaxPost(browser) {
    let page;
    try {
        page = await browser.newPage();
        await page.goto('https://soybooru.com/post/list', { waitUntil: 'networkidle2', timeout: 15000 });
        const href = await page.$eval('a.thumb:nth-child(1)', (el) => el.getAttribute('href')).catch(() => null);
        if (!href) {
            console.warn('Could not locate latest post link');
            return null;
        }
        const match = href.match(/\/post\/view\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    } catch (err) {
        console.error(`getMaxPost: ${err.message}`);
        return null;
    } finally {
        if (page) await page.close();
    }
}

module.exports = { getMaxPost };