const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function downloadImage(url, browser) {
	try {
		// Create new page
		const page = await browser.newPage();

		// Navigate to URL
		console.log(`Navigating to: ${url}...`);
		await page.goto(url, {
			waitUntil: "networkidle2",
			timeout: 30000,
		});

		// Extract image URLS from <img> tags with id="main-image"
		const imageUrls = await page.$$eval('img#main_image', (imgElements) => {
			return imgElements.map((img) => img.src).filter((src) => src);
		})

		const absoluteImageUrls = imageUrls.map((src) => {
			try {
				return new URL(src, url).href;
			} catch (err) {
				console.warn(`Skipping invalid URL: ${src}`);
				return null;
			}
		}).filter(Boolean);

		console.log(`Found ${absoluteImageUrls.length} valid image URLs.`);
		for (let i = 0; i < absoluteImageUrls.length; i++) {
			console.log(`${absoluteImageUrls[i]}`);
		}

		// Get cookies from the page to use in requests
		const cookies = await page.cookies();
		const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

		// Downloading the images
		console.log("Downloading images...");
		for (let i = 0; i < absoluteImageUrls.length; i++) {
			const imageUrl = absoluteImageUrls[i];

			try {
				const response = await axios.get(imageUrl, {
					responseType: "arraybuffer",
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
						'Accept-Language': 'en-US,en;q=0.9',
						'Accept-Encoding': 'gzip, deflate, br',
						'Referer': url,
						'Cookie': cookieString,
						'Sec-Fetch-Dest': 'image',
						'Sec-Fetch-Mode': 'no-cors',
						'Sec-Fetch-Site': 'same-origin',
						'Connection': 'keep-alive',
					},
				});

				const urlParts = new URL(imageUrl).pathname.split('/');
				let filename = urlParts[urlParts.length - 1] || `image-${i + 1}.jpg`;
				filename = filename.split("?")[0];

				if (!path.extname(filename)) {
					filename += ".jpg";
				}

				const filePath = path.join(downloadDir, filename);
				fs.writeFileSync(filePath, response.data);
				console.log(`Saved: ${filename}`);

			} catch (err) {
				console.error(`Failed to download image ${imageUrl}: ${err.message}`);
			}
		}

		console.log("Download complete!");
		
		// Close the page after we're done with it
		await page.close();
		
	} catch (error) {
		console.error("Error:", error.message);
	}
}

module.exports = { downloadImage };
const downloadDir = path.join(__dirname, 'downloadedImages');
if (!fs.existsSync(downloadDir)) {
	fs.mkdirSync(downloadDir, { recursive: true});
	console.log(`Created directory: ${downloadDir}`);
}
