const fs = require('fs');
const path = require('path');

const downloadDir = path.join(__dirname, '..', 'downloadedImages');

async function checkDownloadDir(dir) {
    try {
        await fs.promises.access(dir);
        console.log(`Directory exists: ${dir}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

async function listAllDownloads(dir) {
    fs.readdir(dir, (err, files) => {
        if (err) {
            console.error(`Error: ${err.message}`);
        } else {
            console.log("Files in directory:", files);
        }
    });
}

if (require.main === module) {
    checkDownloadDir(downloadDir).catch((error) => {
        console.error(error);
        process.exit(1);
    });
    listAllDownloads(downloadDir).catch((error) => {
        console.error(error);
        process.exit(1);
    });
}