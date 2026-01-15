async function extractImageTags(page) {
    try {
        const variantName = await page.$eval('#Variantleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) > tr:nth-child(1) > td:nth-child(2) > a.tag_name', (a) =>
            a.innerHTML);
        
        const tagList = await page.$$eval('#Tagsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) .tag_name', (elements) =>
            elements.map(el => el.innerHTML));

        return { variant: variantName, tags: tagList };
    } catch (err) {
        // Element not found or selector doesn't match
        console.warn(`Error extracting tags from ${page}: ${err.message}`);
        return null;
    }
}

module.exports = { extractImageTags };