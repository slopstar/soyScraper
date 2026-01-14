const fs = require('fs');
const url = require('inspector');
const path = require('path');

function ensureDownloadDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		console.log(`Created directory: ${dir}`);
	}
	return dir;
}

async function extractImageUrls(page, referer) {
	// Get the first child anchor from the image list and extract its image src
	// Selector: first anchor child of image list container, then get its img#main_image
	const src = await page.$eval('div.image-list > a:first-child img#main_image', (img) =>
		img.getAttribute('src')
	).catch(() => {
		// Fallback: if the above selector doesn't work, just get the first img#main_image
		return page.$eval('img#main_image', (img) => img.getAttribute('src'));
	}).catch(() => null);
	
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

function sanitizeFilename(unsanitizedUrl) {
	let unsanitizedFilename = unsanitizedUrl.at(-1);
	let sanitizedFilename = unsanitizedFilename.split("%20-%20").join('-');
	return sanitizedFilename;
}

async function downloadImages(imageUrls, page, dir) {
	ensureDownloadDir(dir);
	console.log(`Found ${imageUrls.length} valid image URLs.`);

	for (let i = 0; i < imageUrls.length; i++) {
		const imageUrl = imageUrls[i];
		console.log(`Downloading: ${imageUrl}`);
		
		try {
			// Use page.evaluate with fetch to download the image in the browser context
			// This automatically includes all cookies and headers
			const base64Data = await page.evaluate(async (url) => {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}
				const blob = await response.blob();
				return new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onloadend = () => {
						// Remove data URL prefix (e.g., "data:image/jpeg;base64,")
						const base64 = reader.result.split(',')[1];
						resolve(base64);
					};
					reader.onerror = reject;
					reader.readAsDataURL(blob);
				});
			}, imageUrl);

			// Convert base64 to buffer
			const buffer = Buffer.from(base64Data, 'base64');

			const urlParts = new URL(imageUrl).pathname.split('/');
			const filename = sanitizeFilename(urlParts);

			const filePath = path.join(dir, filename);
			fs.writeFileSync(filePath, buffer);
			console.log(`Saved: ${filename}`);
		} catch (err) {
			console.error(`Failed to download image ${imageUrl}: ${err.message}`);
		}
	}
}

async function downloadFromUrl(url, browser, options = {}) {
	const dir = options.dir;
	if (!dir) {
		throw new Error('Download directory must be provided in options.dir');
	}
	ensureDownloadDir(dir);
	const page = await browser.newPage();
	try {
		console.log(`Navigating to: ${url}...`);
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

		const imageUrls = await extractImageUrls(page, url);

		// Pass the page object to downloadImages so it can use the same browser context
		await downloadImages(imageUrls, page, dir);
	} catch (err) {
		console.error(`Error downloading from ${url}: ${err.message}`);
	} finally {
		await page.close();
	}
}

module.exports = { ensureDownloadDir, extractImageUrls, downloadImages, downloadFromUrl };
