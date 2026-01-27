const fs = require('fs');
const path = require('path');
const { ensureDownloadDir, createSpecificDirectories } = require('./localFileManager');

async function extractImageUrls(page, referer) {
	const src = await page.$eval('div.image-list > a:first-child img#main_image', (img) => img.getAttribute('src'))
		.catch(() => page.$eval('img#main_image', (img) => img.getAttribute('src')))
		.catch(() => null);
	
	if (!src) {
		return [];
	}
	
	try {
		const fullUrl = new URL(src, referer).href;
		return [fullUrl];
	} catch (err) {
		console.warn(`Skipping invalid URL: ${src}`);
		return [];
	}
}

function getExtension(imageUrl) {
	const pathname = new URL(imageUrl).pathname;
	const base = pathname.split('/').pop() || '';
	const ext = path.extname(base);
	return ext || '.jpg';
}

/** Format: postnumber v-variant1 v-variant2 tag_1 tag_2 tag_3.ext (spaces between parts, underscore only within a part) */
function buildFilename(postNumber, variants, tags, imageUrl) {
	const ext = getExtension(imageUrl);
	const sanitize = (s) => (s != null && String(s).trim() !== '' ? String(s).trim().replace(/\s+/g, '_') : '');
	const variantParts = (variants || []).map((v) => sanitize(v)).filter(Boolean).map((v) => 'v-' + v);
	const tagParts = (tags || []).map(sanitize).filter(Boolean);
	const parts = [sanitize(postNumber), ...variantParts, ...tagParts].filter(Boolean);
	return (parts.length ? parts.join(' ') + ext : 'image' + ext);
}

async function downloadImages(imageUrls, page, dir, postNumber, tagData) {
	const variants = tagData?.variants ?? [];
	const variantDir = variants.length > 1 ? 'multiple' : (variants[0] ?? '');
	const tags = tagData?.tags ?? [];
	ensureDownloadDir(dir);
	ensureDownloadDir(path.join(dir, variantDir));
	console.log(`Found ${imageUrls.length} valid image URLs.`);

	for (const imageUrl of imageUrls) {
		try {
			const base64Data = await page.evaluate(async (url) => {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}
				const blob = await response.blob();
				return new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result.split(',')[1]);
					reader.onerror = reject;
					reader.readAsDataURL(blob);
				});
			}, imageUrl);
			const buffer = Buffer.from(base64Data, 'base64');

			const filename = buildFilename(postNumber, variants, tags, imageUrl);
			const filePath = path.join(dir, variantDir, filename);
			fs.writeFileSync(filePath, buffer);
			console.log(`Saved: ${filename}`);
		} catch (err) {
			console.error(`Failed to download image ${imageUrl}: ${err.message}`);
		}
	}
}

async function extractImageTags(page) {
    try {
        // Single variant: #Variantleft. Multiple: #Variantsleft (one link per row).
        const variantSelector = '#Variantleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) tr td:nth-child(2) a, #Variantsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) tr td:nth-child(2) a';
        const variants = await page.$$eval(variantSelector, (elements) =>
            elements.map((el) => (el.textContent || el.innerHTML || '').trim()).filter(Boolean));

        const tags = await page.$$eval('#Tagsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) .tag_name', (els) => els.map((el) => el.innerHTML));
        return { variants, tags };
    } catch (err) {
        console.warn(`extractImageTags: ${err.message}`);
        return null;
    }
}

async function downloadFromUrl(url, browser, options = {}) {
	const dir = options.dir;
	if (!dir) {
		throw new Error('Download directory must be provided in options.dir');
	}
	const postNumber = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
	ensureDownloadDir(dir);
	const page = await browser.newPage();
	console.log("Navigating to", url);
	try {
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
		const imageUrls = await extractImageUrls(page, url);
		const tagData = await extractImageTags(page);
		await downloadImages(imageUrls, page, dir, postNumber, tagData);
		if (tagData) {
			const variantDir = (tagData.variants?.length ?? 0) > 1 ? 'multiple' : (tagData.variants?.[0] ?? '');
			createSpecificDirectories(dir, variantDir);
		}
		else console.warn(`No tag data for ${url}`);
	} catch (err) {
		console.error(`Error downloading from ${url}: ${err.message}`);
	} finally {
		await page.close();
	}
}

module.exports = { downloadFromUrl };
