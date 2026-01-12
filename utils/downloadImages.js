const axios = require('axios');
const fs = require('fs');
const path = require('path');

const downloadDir = path.join(__dirname, '..', 'downloadedImages');

function ensureDownloadDir(dir = downloadDir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		console.log(`Created directory: ${dir}`);
	}
	return dir;
}

/**
 * Downloads images from a given URL by extracting image sources from the page
 * and saving them to the local filesystem.
 * 
 * @param {string} url - The URL of the webpage containing the images to download
 * @param {puppeteer.Browser} browser - A Puppeteer browser instance to use for navigation
 * @returns {Promise<void>} Resolves when all images have been downloaded or an error occurs
 * 
 * @description
 * This function:
 * 1. Navigates to the provided URL using Puppeteer
 * 2. Extracts image URLs from <img> elements with id="main_image"
 * 3. Converts relative URLs to absolute URLs
 * 4. Downloads each image using axios with appropriate headers and cookies
 * 5. Saves images to the 'downloadedImages' directory
 * 
 * Images are saved with their original filenames, or auto-named if unavailable.
 * If an image fails to download, the error is logged but the process continues.
 */
async function extractImageUrls(page, referer) {
	const srcs = await page.$$eval('img#main_image', (imgs) =>
		imgs.map((i) => i.getAttribute('src')).filter(Boolean)
	);
	return srcs
		.map((s) => {
			try {
				return new URL(s, referer).href;
			} catch (err) {
				console.warn(`Skipping invalid URL: ${s}`);
				return null;
			}
		})
		.filter(Boolean);
}

async function downloadImages(imageUrls, referer, cookieString = '', dir = downloadDir) {
	ensureDownloadDir(dir);
	console.log(`Found ${imageUrls.length} valid image URLs.`);
	for (let i = 0; i < imageUrls.length; i++) {
		const imageUrl = imageUrls[i];
		console.log(`Downloading: ${imageUrl}`);
		try {
			const response = await axios.get(imageUrl, {
				responseType: 'arraybuffer',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.9',
					Referer: referer,
					Cookie: cookieString,
				},
			});

			const urlParts = new URL(imageUrl).pathname.split('/');
			let filename = urlParts[urlParts.length - 1] || `image-${i + 1}.jpg`;
			filename = filename.split('?')[0];

			if (!path.extname(filename)) {
				filename += '.jpg';
			}

			const filePath = path.join(dir, filename);
			fs.writeFileSync(filePath, response.data);
			console.log(`Saved: ${filename}`);
		} catch (err) {
			console.error(`Failed to download image ${imageUrl}: ${err.message}`);
		}
	}
	console.log('Download complete!');
}

async function downloadFromUrl(url, browser, options = {}) {
	const dir = options.dir || downloadDir;
	ensureDownloadDir(dir);
	const page = await browser.newPage();
	try {
		console.log(`Navigating to: ${url}...`);
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

		const imageUrls = await extractImageUrls(page, url);

		const cookies = await page.cookies();
		const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

		await downloadImages(imageUrls, url, cookieString, dir);
	} catch (err) {
		console.error(`Error downloading from ${url}: ${err.message}`);
	} finally {
		await page.close();
	}
}

module.exports = { ensureDownloadDir, extractImageUrls, downloadImages, downloadFromUrl };
