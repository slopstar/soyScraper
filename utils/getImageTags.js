async function extractImageTags(page) {
    // Extract text from the specified div/td element
    const variantSelector = '#Variantleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) > tr:nth-child(1) > td:nth-child(2)';
    
    // Extract tags from the tags table
    const tagsTableSelector = '#Tagsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3)';
    
    try {
        const text = await page.$eval(variantSelector, (element) => {
            // Get the text content, trimming whitespace
            console.log(element.textContent.trim());
            return element.textContent.trim();
        });
        
        // Extract all tags from the table (only those with class="tag_name")
        const tags = await page.$$eval(`${tagsTableSelector} a.tag_name`, (links) => {
            return links.map(link => link.textContent.trim()).filter(text => text.length > 0);
        });
        
        return { variant: text, tags: tags };
    } catch (err) {
        // Element not found or selector doesn't match
        console.warn(`Could not extract text from selector: ${err.message}`);
        return null;
    }
}

module.exports = { extractImageTags };