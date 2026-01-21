const fs = require('fs');
const path = require('path');

function ensureDownloadDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		console.log(`Created directory: ${dir}`);
	}
	return dir;
}

function createSpecificDirectories(baseDir, variant, tags) {
    // Make directory for variant
    const variantDir = path.join(baseDir, variant);
    ensureDownloadDir(variantDir);

    const filename = tags.join('_');
}

module.exports = { ensureDownloadDir, createSpecificDirectories };