const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { ensureDownloadDir } = require('../fs/localFileManager');
const { TAGS_DIR } = require('../config');

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

function normalizeTag(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function findBlockedTag(tags, blocklist) {
	if (!Array.isArray(tags) || !blocklist || blocklist.size === 0) return null;
	for (const tag of tags) {
		const normalized = normalizeTag(tag);
		if (blocklist.has(normalized)) return tag;
	}
	return null;
}

function shouldSkipByTagFilters(tagData, tagFilters) {
	if (!tagFilters || (!tagFilters.skipNsfw && !tagFilters.skipNsfl)) return null;
	if (!tagData || !Array.isArray(tagData.tags)) {
		console.warn('Tag filters enabled but no tag data was found; continuing download.');
		return null;
	}

	if (tagFilters.skipNsfw) {
		const match = findBlockedTag(tagData.tags, tagFilters.nsfwBlocklist);
		if (match) return { skip: true, category: 'NSFW', tag: match };
	}
	if (tagFilters.skipNsfl) {
		const match = findBlockedTag(tagData.tags, tagFilters.nsflBlocklist);
		if (match) return { skip: true, category: 'NSFL', tag: match };
	}

	return null;
}

/** Format: postnumber_soyjak.ext */
function buildFilename(postNumber, variants, tags, imageUrl) {
	const ext = getExtension(imageUrl);
	const sanitize = (s) => (s != null && String(s).trim() !== '' ? String(s).trim().replace(/\s+/g, '_') : '');
	const base = sanitize(postNumber) || 'image';
	return `${base}_soyjak${ext}`;
}

async function savePostMetadata(postNumber, tagData, imageUrls, postUrl, savedFiles) {
	if (!postNumber) return;
	const payload = {
		postNumber: String(postNumber),
		variants: Array.isArray(tagData?.variants) ? tagData.variants : [],
		tags: Array.isArray(tagData?.tags) ? tagData.tags : [],
		postUrl: postUrl || '',
		imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
		files: Array.isArray(savedFiles) ? savedFiles : [],
		savedAt: new Date().toISOString(),
	};
	ensureDownloadDir(TAGS_DIR);
	const filePath = path.join(TAGS_DIR, `${postNumber}.json`);
	await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
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
	const tags = tagData?.tags ?? [];
	const targetDir = dir;
	ensureDownloadDir(targetDir);
	console.log(`Found ${imageUrls.length} valid image URLs.`);

	let saved = 0;
	let skipped = 0;
	let failed = 0;
	const savedFiles = [];
	for (const imageUrl of imageUrls) {
		const filename = buildFilename(postNumber, variants, tags, imageUrl);
		const filePath = path.join(targetDir, filename);
		if (fs.existsSync(filePath)) {
			console.log(`Skipping existing: ${filename}`);
			skipped += 1;
			savedFiles.push(filename);
			continue;
		}
		try {
			await downloadImageToFile(imageUrl, filePath, headers);
			saved += 1;
			savedFiles.push(filename);
			console.log(`Saved: ${filename}`);
		} catch (err) {
			failed += 1;
			console.error(`Failed to download image ${imageUrl}: ${err.message}`);
		}
	}

	return { saved, skipped, failed, savedFiles };
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
		const tagData = await extractImageTags(page);
		if (!tagData) console.warn(`No tag data for ${url}`);
		const filterDecision = shouldSkipByTagFilters(tagData, options.tagFilters);
		if (filterDecision?.skip) {
			console.log(`Skipping post ${postNumber} due to ${filterDecision.category} tag: ${filterDecision.tag}`);
			return { ok: false, skipped: true, reason: 'filtered' };
		}
		const imageUrls = await extractImageUrls(page, url);
		if (!imageUrls.length) {
			console.warn(`No image URLs found for ${url}`);
			return { ok: false, reason: 'no-images' };
		}
		const headers = await buildRequestHeaders(page, url);
		const result = await downloadImages(imageUrls, { dir, postNumber, tagData, headers });
		if (result.saved === 0 && result.skipped === 0 && result.failed > 0) {
			throw new Error('All image downloads failed');
		}
		if (result.saved > 0 || result.skipped > 0) {
			await savePostMetadata(postNumber, tagData, imageUrls, url, result.savedFiles);
		}
		return { ok: result.saved > 0, ...result };
	} catch (err) {
		console.error(`Error downloading from ${url}: ${err.message}`);
		throw err;
	}
}

module.exports = { downloadFromUrl };
