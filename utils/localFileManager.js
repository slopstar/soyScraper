const fs = require('fs');
const path = require('path');

function ensureDownloadDir(dir) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function createSpecificDirectories(baseDir, variant) {
    ensureDownloadDir(path.join(baseDir, variant));
}

module.exports = { ensureDownloadDir, createSpecificDirectories };