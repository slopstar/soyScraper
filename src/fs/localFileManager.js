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

function parsePostNumber(fileName) {
	const match = String(fileName || '').match(/^(\d+)/);
	if (!match) return null;
	const postNum = parseInt(match[1], 10);
	return Number.isInteger(postNum) && postNum > 0 ? postNum : null;
}

function getDownloadedPostNumbers(dir) {
	if (!fs.existsSync(dir)) return new Set();

	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const subdirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	const dirsToCheck = ['.'].concat(subdirs);
	const posts = new Set();

	for (const subdir of dirsToCheck) {
		const subdirPath = subdir === '.' ? dir : path.join(dir, subdir);
		if (!fs.statSync(subdirPath).isDirectory()) continue;
		const subdirEntries = fs.readdirSync(subdirPath, { withFileTypes: true });
		for (const entry of subdirEntries) {
			if (!entry.isFile()) continue;
			const postNum = parsePostNumber(entry.name);
			if (postNum != null) posts.add(postNum);
		}
	}

	return posts;
}

// Checking last downloaded post
function getLastDownloadedPost(dir) {
	console.log("Checking for last downloaded post in", dir);
	const posts = getDownloadedPostNumbers(dir);
	if (posts.size === 0) return null;
	let highestPost = 0;
	for (const postNum of posts) {
		if (postNum > highestPost) highestPost = postNum;
	}
	console.log("Highest post number found:", highestPost);
	return highestPost;
}

module.exports = { ensureDownloadDir, createSpecificDirectories, getLastDownloadedPost, getDownloadedPostNumbers };
