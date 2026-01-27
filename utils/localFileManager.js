const fs = require('fs');
const path = require('path');

// Directory creation stuff
function ensureDownloadDir(dir) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function createSpecificDirectories(baseDir, variant) {
    ensureDownloadDir(path.join(baseDir, variant));
}

// Checking last downloaded post
function getLastDownloadedPost(dir) {
	console.log("Checking for last downloaded post in", dir);
    // List subdirectories inside the given directory (e.g., downloadedImages)
	// If the directory doesn't exist, return null
    if (!fs.existsSync(dir)) return null;

	// Array of subdirectories
    const subdirs = fs.readdirSync(dir)
        .filter((file) => fs.statSync(path.join(dir, file)).isDirectory());

	// If there are no subdirectories, return null
	if (subdirs.length === 0) return null;

	// Loop through subdirectories to find highest post number
	let highestPost = 0;
	for (const subdir of subdirs) {
		// Loop through each file in the subdir, extract post numbers, and track the highest
		const subdirPath = path.join(dir, subdir);
		const files = fs.readdirSync(subdirPath).filter((file) => fs.statSync(path.join(subdirPath, file)).isFile());
		for (const file of files) {
			// File format: "postnumber_something_something_etc.ext"
			const match = file.match(/^(\d+)_/);
			if (match) {
				const postNum = parseInt(match[1], 10);
				if (!isNaN(postNum) && postNum > highestPost) {
					highestPost = postNum;
				}
			}
		}
	}
	console.log("Highest post number found:", highestPost);
	return highestPost;
}

module.exports = { ensureDownloadDir, createSpecificDirectories, getLastDownloadedPost };