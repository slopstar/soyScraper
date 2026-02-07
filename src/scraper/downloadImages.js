const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const net = require('net');
const { ensureDownloadDir } = require('../fs/localFileManager');
const { METADATA_DB } = require('../config');
const { upsertMetadata } = require('../db/metadataStore');
const DEFAULT_BUCKET_SIZE = 1000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_ALLOWED_MEDIA_HOSTS = ['soybooru.com', '.soybooru.com'];
const MAX_SIGNATURE_BYTES = 64;

function parseBoolean(value, fallback = false) {
	if (value == null) return fallback;
	const normalized = String(value).trim().toLowerCase();
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function parsePositiveInt(value, fallback) {
	const parsed = Number.parseInt(String(value || ''), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function parseCsv(value) {
	if (!value) return [];
	return String(value)
		.split(',')
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
}

function normalizeHostPattern(value) {
	if (!value) return '';
	const host = String(value).trim().toLowerCase();
	if (!host) return '';
	return host.replace(/\.+$/g, '');
}

function hostMatchesPattern(hostname, pattern) {
	const normalizedHost = normalizeHostPattern(hostname);
	const normalizedPattern = normalizeHostPattern(pattern);
	if (!normalizedHost || !normalizedPattern) return false;
	if (normalizedPattern.startsWith('.')) {
		const suffix = normalizedPattern.slice(1);
		return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
	}
	return normalizedHost === normalizedPattern;
}

function buildAllowedMediaHosts(refererUrl) {
	const patterns = new Set(DEFAULT_ALLOWED_MEDIA_HOSTS.map(normalizeHostPattern).filter(Boolean));
	for (const item of parseCsv(process.env.SOYSCRAPER_ALLOWED_MEDIA_HOSTS)) {
		patterns.add(normalizeHostPattern(item));
	}
	try {
		const refererHost = new URL(refererUrl).hostname;
		if (refererHost) patterns.add(normalizeHostPattern(refererHost));
	} catch (_) {
		// Ignore malformed referer host.
	}
	return Array.from(patterns).filter(Boolean);
}

function isPrivateIpv4(ip) {
	const octets = String(ip)
		.split('.')
		.map((part) => Number.parseInt(part, 10));
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return true;
	}
	const [a, b] = octets;
	if (a === 0) return true;
	if (a === 10) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	if (a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 198 && (b === 18 || b === 19)) return true;
	if (a >= 224) return true;
	return false;
}

function isPrivateIpv6(ip) {
	const normalized = String(ip || '').toLowerCase();
	if (!normalized) return true;
	if (normalized === '::' || normalized === '::1') return true;
	if (normalized.startsWith('fe80:')) return true;
	if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
	if (normalized.startsWith('::ffff:')) {
		const mapped = normalized.slice('::ffff:'.length);
		if (net.isIP(mapped) === 4) return isPrivateIpv4(mapped);
	}
	return false;
}

function isUnsafeHostname(hostname) {
	const normalized = String(hostname || '').toLowerCase().replace(/\.+$/g, '');
	if (!normalized) return true;
	if (normalized === 'localhost' || normalized === 'localhost.localdomain') return true;
	if (normalized.endsWith('.local')) return true;
	const ipType = net.isIP(normalized);
	if (ipType === 4) return isPrivateIpv4(normalized);
	if (ipType === 6) return isPrivateIpv6(normalized);
	return false;
}

function validateMediaUrl(rawUrl, mediaSafety, label = 'media URL') {
	let parsed;
	try {
		parsed = new URL(rawUrl);
	} catch (err) {
		throw new Error(`Invalid ${label}: ${rawUrl}`);
	}

	if (mediaSafety.strict && parsed.protocol !== 'https:') {
		throw new Error(`Blocked non-HTTPS ${label}: ${parsed.href}`);
	}

	const hostname = parsed.hostname.toLowerCase();
	if (mediaSafety.strict && isUnsafeHostname(hostname)) {
		throw new Error(`Blocked unsafe host in ${label}: ${hostname}`);
	}

	if (mediaSafety.strict) {
		const allowed = mediaSafety.allowedHosts.some((pattern) => hostMatchesPattern(hostname, pattern));
		if (!allowed) {
			throw new Error(`Blocked untrusted media host: ${hostname}`);
		}
	}

	return parsed;
}

function normalizeMime(value) {
	if (!value) return '';
	return String(value).split(';')[0].trim().toLowerCase();
}

function isGenericMime(mime) {
	return mime === 'application/octet-stream' || mime === 'binary/octet-stream';
}

function isSupportedMime(mime) {
	return new Set([
		'image/jpeg',
		'image/png',
		'image/gif',
		'image/webp',
		'image/avif',
		'video/mp4',
		'video/webm',
	]).has(mime);
}

function detectMediaType(signatureBytes) {
	if (!Buffer.isBuffer(signatureBytes) || signatureBytes.length === 0) return null;
	const bytes = signatureBytes;
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return { mime: 'image/jpeg', ext: '.jpg' };
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return { mime: 'image/png', ext: '.png' };
	}
	if (bytes.length >= 6) {
		const gifHeader = bytes.subarray(0, 6).toString('ascii');
		if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
			return { mime: 'image/gif', ext: '.gif' };
		}
	}
	if (
		bytes.length >= 12 &&
		bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
		bytes.subarray(8, 12).toString('ascii') === 'WEBP'
	) {
		return { mime: 'image/webp', ext: '.webp' };
	}
	if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
		const brand = bytes.subarray(8, 12).toString('ascii');
		if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', ext: '.avif' };
		return { mime: 'video/mp4', ext: '.mp4' };
	}
	if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
		return { mime: 'video/webm', ext: '.webm' };
	}
	return null;
}

function buildMediaSafetyOptions(options, refererUrl) {
	const strict = Boolean(options.strictMediaSafety);
	const maxDownloadBytes = parsePositiveInt(process.env.SOYSCRAPER_MAX_DOWNLOAD_BYTES, DEFAULT_MAX_DOWNLOAD_BYTES);
	const downloadTimeoutMs = parsePositiveInt(
		process.env.SOYSCRAPER_DOWNLOAD_TIMEOUT_MS,
		Number.isInteger(options.timeout) && options.timeout > 0 ? options.timeout : DEFAULT_DOWNLOAD_TIMEOUT_MS
	);
	const requireVirusScan = strict
		? parseBoolean(process.env.SOYSCRAPER_REQUIRE_VIRUS_SCAN, true)
		: parseBoolean(process.env.SOYSCRAPER_REQUIRE_VIRUS_SCAN, false);
	const virusScannerBin = String(process.env.SOYSCRAPER_VIRUS_SCANNER_BIN || 'clamscan').trim();

	return {
		strict,
		maxDownloadBytes,
		downloadTimeoutMs,
		allowedHosts: buildAllowedMediaHosts(refererUrl),
		requireVirusScan,
		virusScannerBin,
	};
}

function sanitizeFilenameValue(value) {
	return String(value || '')
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function normalizeExtension(value) {
	const raw = String(value || '').trim().toLowerCase();
	if (!raw) return '';
	return raw.startsWith('.') ? raw : `.${raw}`;
}

function baseFilename(postNumber) {
	const base = sanitizeFilenameValue(postNumber) || 'image';
	return `${base}_soyjak`;
}

async function writeToQuarantine(responseBody, quarantinePath, mediaSafety) {
	let bytesWritten = 0;
	let signature = Buffer.alloc(0);
	const readable = Readable.fromWeb ? Readable.fromWeb(responseBody) : responseBody;
	const inspector = new Transform({
		transform(chunk, _encoding, callback) {
			const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			bytesWritten += buf.length;
			if (mediaSafety.maxDownloadBytes > 0 && bytesWritten > mediaSafety.maxDownloadBytes) {
				callback(new Error(`Download exceeds max allowed size (${mediaSafety.maxDownloadBytes} bytes)`));
				return;
			}
			if (signature.length < MAX_SIGNATURE_BYTES) {
				const needed = MAX_SIGNATURE_BYTES - signature.length;
				signature = Buffer.concat([signature, buf.subarray(0, needed)]);
			}
			callback(null, buf);
		},
	});

	await pipeline(readable, inspector, fs.createWriteStream(quarantinePath, { flags: 'wx' }));
	return { bytesWritten, signature };
}

function findExistingFileByBase(targetDir, base) {
	try {
		const files = fs.readdirSync(targetDir, { withFileTypes: true });
		for (const file of files) {
			if (!file.isFile()) continue;
			if (file.name === `${base}.json`) continue;
			if (file.name.startsWith(`${base}.`)) return file.name;
		}
	} catch (_) {
		return null;
	}
	return null;
}

function getScanDisplayName(imageUrl, fallback) {
	try {
		const parsed = new URL(imageUrl);
		const raw = path.basename(parsed.pathname || '');
		const decoded = decodeURIComponent(raw);
		return decoded || fallback;
	} catch (_) {
		return fallback;
	}
}

async function scanFileForMalware(filePath, mediaSafety, displayLabel) {
	if (!mediaSafety.requireVirusScan) return;

	const displayName = displayLabel || path.basename(filePath);
	console.log(`[scan] Scanning: ${displayName}`);

	await new Promise((resolve, reject) => {
		let stderr = '';
		let stdout = '';
		const child = spawn(mediaSafety.virusScannerBin, ['--no-summary', '--infected', '--stdout', filePath], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		child.once('error', (err) => {
			reject(new Error(`Virus scan failed to start (${mediaSafety.virusScannerBin}): ${err.message}`));
		});

		child.once('close', (code) => {
			if (code === 0) {
				console.log(`[scan] Passed: ${displayName}`);
				resolve();
				return;
			}
			if (code === 1) {
				console.error(`[scan] Failed: ${displayName} (virus detected)`);
				reject(new Error(`Virus detected in downloaded file (${path.basename(filePath)})`));
				return;
			}
			const details = (stderr || stdout || '').trim();
			console.error(`[scan] Failed: ${displayName} (scanner error code ${code})`);
			reject(new Error(`Virus scan failed with exit code ${code}${details ? `: ${details}` : ''}`));
		});
	});
}

function getImageLayout() {
	const raw = String(process.env.SOYSCRAPER_IMAGE_LAYOUT || 'bucket').toLowerCase();
	if (raw === 'flat') return 'flat';
	if (raw === 'bucket' || raw === 'range') return 'bucket';
	return 'bucket';
}

function getBucketSize() {
	const raw = process.env.SOYSCRAPER_IMAGE_BUCKET_SIZE;
	if (!raw) return DEFAULT_BUCKET_SIZE;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BUCKET_SIZE;
	return parsed;
}

function resolvePostDir(rootDir, postNumber) {
	if (!rootDir) return rootDir;
	if (getImageLayout() === 'flat') return rootDir;
	const parsed = Number.parseInt(String(postNumber), 10);
	if (!Number.isFinite(parsed)) return rootDir;
	const bucketSize = getBucketSize();
	const start = Math.floor(parsed / bucketSize) * bucketSize;
	const end = start + bucketSize - 1;
	const padWidth = Math.max(String(end).length, 6);
	const label = `${String(start).padStart(padWidth, '0')}-${String(end).padStart(padWidth, '0')}`;
	return path.join(rootDir, label);
}

async function extractImageUrls(page, referer) {
	const rawUrls = await page
		.$$eval(
			[
				'div.image-list > a:first-child img#main_image',
				'img#main_image',
				'video#main_image source',
				'video#main_image',
				'div.image-list > a:first-child video source',
				'div.image-list > a:first-child video',
			].join(','),
			(elements) => {
				const urls = [];
				for (const el of elements) {
					const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
					if (src && src.trim()) urls.push(src.trim());
				}
				return urls;
			}
		)
		.catch(() => []);

	if (!rawUrls.length) return [];

	const unique = new Set();
	for (const src of rawUrls) {
		try {
			unique.add(new URL(src, referer).href);
		} catch (_) {
			console.warn(`Skipping invalid URL: ${src}`);
		}
	}
	return Array.from(unique);
}

function getExtension(imageUrl) {
	try {
		const pathname = new URL(imageUrl).pathname;
		const base = pathname.split('/').pop() || '';
		const ext = normalizeExtension(path.extname(base));
		return ext || '.jpg';
	} catch (_) {
		return '.jpg';
	}
}

function normalizeTag(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/_/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeTagData(tagData) {
	const normalized = {};
	const allowedStringKeys = new Set([
		'postedAt',
		'size',
		'filesize',
		'type',
		'rating',
	]);
	if (tagData && typeof tagData === 'object') {
		for (const [key, value] of Object.entries(tagData)) {
			if (Array.isArray(value)) {
				normalized[key] = value;
			} else if (allowedStringKeys.has(key) && value != null) {
				const asString = String(value).trim();
				if (asString) normalized[key] = asString;
			}
		}
	}
	if (!Array.isArray(normalized.variants)) normalized.variants = [];
	if (!Array.isArray(normalized.tags)) normalized.tags = [];
	return normalized;
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
function buildFilename(postNumber, variants, tags, imageUrl, extensionOverride) {
	const ext = normalizeExtension(extensionOverride || getExtension(imageUrl)) || '.jpg';
	return `${baseFilename(postNumber)}${ext}`;
}

async function savePostMetadata(postNumber, tagData, imageUrls, postUrl, savedFiles) {
	if (!postNumber) return;
	const normalizedTagData = normalizeTagData(tagData);
	const payload = {
		postNumber: String(postNumber),
		...normalizedTagData,
		postUrl: postUrl || '',
		imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
		files: Array.isArray(savedFiles) ? savedFiles : [],
		savedAt: new Date().toISOString(),
	};
	upsertMetadata(METADATA_DB, postNumber, payload);
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

async function removeFileIfExists(filePath) {
	try {
		await fs.promises.unlink(filePath);
	} catch (err) {
		if (err && err.code !== 'ENOENT') throw err;
	}
}

async function downloadImageToFile(imageUrl, filePath, headers, mediaSafety) {
	if (typeof fetch !== 'function') {
		throw new Error('global fetch is not available in this Node runtime');
	}
	validateMediaUrl(imageUrl, mediaSafety, 'media URL');
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), mediaSafety.downloadTimeoutMs);

	try {
		const response = await fetch(imageUrl, { headers, redirect: 'follow', signal: controller.signal });
		if (mediaSafety.strict && response.url) {
			validateMediaUrl(response.url, mediaSafety, 'redirect target URL');
		}
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		if (!response.body) {
			throw new Error('No response body');
		}

		const headerContentType = normalizeMime(response.headers.get('content-type'));
		if (
			mediaSafety.strict &&
			headerContentType &&
			!isSupportedMime(headerContentType) &&
			!isGenericMime(headerContentType)
		) {
			throw new Error(`Blocked unsupported content-type: ${headerContentType}`);
		}

		const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
		if (
			Number.isFinite(contentLength) &&
			mediaSafety.maxDownloadBytes > 0 &&
			contentLength > mediaSafety.maxDownloadBytes
		) {
			throw new Error(`Blocked file larger than max allowed size (${mediaSafety.maxDownloadBytes} bytes)`);
		}

		ensureDownloadDir(path.dirname(filePath));
		const { bytesWritten, signature } = await writeToQuarantine(response.body, filePath, mediaSafety);
		const detectedType = detectMediaType(signature);
		if (mediaSafety.strict) {
			if (!detectedType) {
				throw new Error('Unable to verify media type from file signature');
			}
			if (!isSupportedMime(detectedType.mime)) {
				throw new Error(`Blocked unsupported media signature (${detectedType.mime})`);
			}
			if (headerContentType && !isGenericMime(headerContentType) && headerContentType !== detectedType.mime) {
				throw new Error(`Content-type mismatch (header=${headerContentType}, detected=${detectedType.mime})`);
			}
		}

		await scanFileForMalware(filePath, mediaSafety, getScanDisplayName(imageUrl, path.basename(filePath)));
		return { bytesWritten, detectedType };
	} catch (err) {
		await removeFileIfExists(filePath);
		throw err;
	} finally {
		clearTimeout(timeoutHandle);
	}
}

async function downloadImages(imageUrls, downloadContext) {
	const { dir, postNumber, tagData, headers, mediaSafety } = downloadContext;
	const variants = tagData?.variants ?? [];
	const tags = tagData?.tags ?? [];
	const targetDir = dir;
	const quarantineDir = path.join(targetDir, '.quarantine');
	ensureDownloadDir(targetDir);
	ensureDownloadDir(quarantineDir);
	console.log(`Found ${imageUrls.length} valid image URLs.`);

	let saved = 0;
	let skipped = 0;
	let failed = 0;
	const savedFiles = [];
	for (const imageUrl of imageUrls) {
		const base = baseFilename(postNumber);
		const existingStrictMatch = mediaSafety.strict ? findExistingFileByBase(targetDir, base) : null;
		if (existingStrictMatch) {
			console.log(`Skipping existing: ${existingStrictMatch}`);
			skipped += 1;
			savedFiles.push(existingStrictMatch);
			continue;
		}

		let filename = buildFilename(postNumber, variants, tags, imageUrl);
		let filePath = path.join(targetDir, filename);
		if (!mediaSafety.strict && fs.existsSync(filePath)) {
			console.log(`Skipping existing: ${filename}`);
			skipped += 1;
			savedFiles.push(filename);
			continue;
		}

		const quarantineName = `${base}.${Date.now()}.${Math.random().toString(36).slice(2)}.part`;
		const quarantinePath = path.join(quarantineDir, quarantineName);
		try {
			const downloadInfo = await downloadImageToFile(imageUrl, quarantinePath, headers, mediaSafety);
			if (downloadInfo?.detectedType?.ext) {
				filename = buildFilename(postNumber, variants, tags, imageUrl, downloadInfo.detectedType.ext);
				filePath = path.join(targetDir, filename);
			}

			if (fs.existsSync(filePath)) {
				await removeFileIfExists(quarantinePath);
				console.log(`Skipping existing: ${filename}`);
				skipped += 1;
				savedFiles.push(filename);
				continue;
			}

			await fs.promises.rename(quarantinePath, filePath);
			saved += 1;
			savedFiles.push(filename);
			console.log(`Saved: ${filename}`);
		} catch (err) {
			failed += 1;
			console.error(`Failed to download image ${imageUrl}: ${err.message}`);
			await removeFileIfExists(quarantinePath);
		}
	}

	return { saved, skipped, failed, savedFiles };
}

async function extractImageTags(page) {
	try {
		const ignoredSectionIds = [
			'Post_Controlsleft',
			'Report_Postleft',
			'Navigationleft',
			'Advertisementleft',
			'Statisticsleft',
		];
		const tagData = await page.$$eval(
			'body nav section',
			(sections, ignoredIds) => {
				const ignored = new Set((ignoredIds || []).map((id) => String(id).toLowerCase()));
				const isIgnoredSection = (id, heading) => {
					const idText = (id || '').toLowerCase();
					const headingText = (heading || '').toLowerCase();
					if (idText && ignored.has(idText)) return true;
					if (headingText.includes('favorited')) return true;
					return false;
				};
				const normalizeKey = (raw) => {
					if (!raw) return '';
					const cleaned = String(raw)
						.replace(/left$/i, '')
						.replace(/_/g, ' ')
						.trim()
						.toLowerCase();
					if (!cleaned) return '';
					const mapping = {
						variant: 'variants',
						variants: 'variants',
						subvariant: 'subvariants',
						subvariants: 'subvariants',
						tag: 'tags',
						tags: 'tags',
						flag: 'flags',
						flags: 'flags',
						meta: 'meta',
						metas: 'meta',
					};
					return mapping[cleaned] || cleaned.replace(/\s+/g, '_');
				};
				const collectTags = (section) => {
					const tagNodes = section.querySelectorAll('.tag_name');
					const nodes = tagNodes.length ? tagNodes : section.querySelectorAll('tbody a, a');
					return Array.from(nodes)
						.map((node) => (node.textContent || '').trim())
						.filter(Boolean);
				};
				const data = {};
				for (const section of sections) {
					const id = (section.getAttribute('id') || '').trim();
					const heading = section.querySelector('h4, h3, h2, h1')?.textContent?.trim() || '';
					if (isIgnoredSection(id, heading)) continue;
					const key = normalizeKey(id || heading);
					if (!key) continue;
					const tags = collectTags(section);
					if (tags.length === 0) continue;
					if (!data[key]) data[key] = [];
					for (const tag of tags) {
						if (!data[key].includes(tag)) data[key].push(tag);
					}
				}
				return Object.keys(data).length ? data : null;
			},
			ignoredSectionIds
		);

		const statisticsData = await page
			.$eval('body nav section#Statisticsleft', (section) => {
				const timeEl = section.querySelector('div.navside.tab time, time');
				const postedAt = timeEl
					? (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim()
					: '';
				const text = (section.textContent || '').replace(/\s+/g, ' ').trim();
				const extractValue = (label) => {
					const match = text.match(new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`, 'i'));
					return match ? match[1].trim() : '';
				};
				const size = extractValue('Size');
				const filesize = extractValue('Filesize');
				const type = extractValue('Type');
				const rating = extractValue('Rating');
				return {
					postedAt,
					size,
					filesize,
					type,
					rating,
				};
			})
			.catch(() => null);

		const mergedTagData = {
			...(tagData || {}),
			...(statisticsData || {}),
		};

		if (tagData || statisticsData) {
			return normalizeTagData(mergedTagData);
		}

		// Fallback to legacy selectors if nav parsing yields no data.
		const variantSelector = '#Variantleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) tr td:nth-child(2) a, #Variantsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) tr td:nth-child(2) a';
		const variants = await page.$$eval(variantSelector, (elements) =>
			elements.map((el) => (el.textContent || '').trim()).filter(Boolean));

		const tags = await page.$$eval('#Tagsleft > div:nth-child(2) > table:nth-child(1) > tbody:nth-child(3) .tag_name', (els) =>
			els.map((el) => (el.textContent || '').trim()).filter(Boolean));
		const normalizedLegacy = normalizeTagData({ variants, tags });
		const hasLegacyData = Object.values(normalizedLegacy).some((value) => Array.isArray(value) && value.length > 0);
		return hasLegacyData ? normalizedLegacy : null;
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
	const targetDir = resolvePostDir(dir, postNumber);
	const mediaSafety = buildMediaSafetyOptions(options, url);
	ensureDownloadDir(targetDir);
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
		const result = await downloadImages(imageUrls, { dir: targetDir, postNumber, tagData, headers, mediaSafety });
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
