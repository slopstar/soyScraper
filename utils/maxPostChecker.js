/** @param {import('puppeteer').Browser} browser @returns {Promise<number|null>} */
async function getMaxPost(browser) {
    let page;
    try {
        page = await browser.newPage();
        await page.goto('https://soybooru.com/post/list', { waitUntil: 'networkidle2', timeout: 15000 });
        const hrefs = await page.$$eval('a.thumb', (els) =>
            els.map((el) => el.getAttribute('href')).filter(Boolean));
        if (!hrefs.length) {
            console.warn('Could not locate post links on list page');
            return null;
        }
        const ids = hrefs
            .map((href) => {
                const match = href.match(/\/post\/view\/(\d+)/);
                return match ? parseInt(match[1], 10) : null;
            })
            .filter((id) => Number.isInteger(id));
        if (!ids.length) return null;
        return Math.max(...ids);
    } catch (err) {
        console.error(`getMaxPost: ${err.message}`);
        return null;
    } finally {
        if (page) await page.close();
    }
}

module.exports = { getMaxPost };
