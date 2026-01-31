const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { ensureDownloadDir } = require('./localFileManager');

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

async function buildRequestHeaders(page, referer) {
	const headers = {};
	if (referer) headers.referer = referer;
	if (page) {
		const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
		if (userAgent) headers['user-agent'] = userAgent;
		const cookies = await page.cookies().catch(() => []);
		if (cookies.length) {
			headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
		}
	}
	return headers;
}

async function downloadImageToFile(imageUrl, filePath, headers) {
	if (typeof fetch !== 'function') {
		throw new Error('global fetch is not available in this Node runtime');
	}
	const response = await fetch(imageUrl, { headers });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}
	if (!response.body) {
		throw new Error('No response body');
	}
	ensureDownloadDir(path.dirname(filePath));
	const readable = Readable.fromWeb ? Readable.fromWeb(response.body) : response.body;
	await pipeline(readable, fs.createWriteStream(filePath));
}

async function downloadImages(imageUrls, downloadContext) {
	const { dir, postNumber, tagData, headers } = downloadContext;
	const variants = tagData?.variants ?? [];
	const variantDir = variants.length > 1 ? 'multiple' : (variants[0] ?? '');
	const tags = tagData?.tags ?? [];
	const targetDir = path.join(dir, variantDir);
	ensureDownloadDir(targetDir);
	console.log(`Found ${imageUrls.length} valid image URLs.`);

	let saved = 0;
	let skipped = 0;
	let failed = 0;
	for (const imageUrl of imageUrls) {
		const filename = buildFilename(postNumber, variants, tags, imageUrl);
		const filePath = path.join(targetDir, filename);
		if (fs.existsSync(filePath)) {
			console.log(`Skipping existing: ${filename}`);
			skipped += 1;
			continue;
		}
		try {
			await downloadImageToFile(imageUrl, filePath, headers);
			saved += 1;
			console.log(`Saved: ${filename}`);
		} catch (err) {
			failed += 1;
			console.error(`Failed to download image ${imageUrl}: ${err.message}`);
		}
	}

	return { saved, skipped, failed };
}

async function extractImageTags(page) {
    try {
        // Single variant: #Variantleft. Multiple: #Variantsleft (one link per row).
        const variantSelector = '#Variantleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) tr td:nth-child(2) a, #Variantsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) tr td:nth-child(2) a';
        const variants = await page.$$eval(variantSelector, (elements) =>
            elements.map((el) => (el.textContent || '').trim()).filter(Boolean));

        const tags = await page.$$eval('#Tagsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) .tag_name', (els) =>
			els.map((el) => (el.textContent || '').trim()).filter(Boolean));
        return { variants, tags };
    } catch (err) {
        console.warn(`extractImageTags: ${err.message}`);
        return null;
    }
}

async function downloadFromUrl(url, page, options = {}) {
	const dir = options.dir;
	if (!dir) {
		throw new Error('Download directory must be provided in options.dir');
	}
	if (!page) {
		throw new Error('A Puppeteer page must be provided');
	}
	const postNumber = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
	ensureDownloadDir(dir);
	console.log("Navigating to", url);
	try {
		await page.goto(url, { waitUntil: 'networkidle2', timeout: options.timeout ?? 30000 });
		const imageUrls = await extractImageUrls(page, url);
		if (!imageUrls.length) {
			console.warn(`No image URLs found for ${url}`);
			return { ok: false, reason: 'no-images' };
		}
		const tagData = await extractImageTags(page);
		if (!tagData) console.warn(`No tag data for ${url}`);
		const headers = await buildRequestHeaders(page, url);
		const result = await downloadImages(imageUrls, { dir, postNumber, tagData, headers });
		if (result.saved === 0 && result.failed > 0) {
			throw new Error('All image downloads failed');
		}
		return { ok: result.saved > 0, ...result };
	} catch (err) {
		console.error(`Error downloading from ${url}: ${err.message}`);
		throw err;
	}
}

module.exports = { downloadFromUrl };
