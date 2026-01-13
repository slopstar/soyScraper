const fs = require('fs');
const path = require('path');

const downloadDir = path.join(__dirname, 'downloadedImages');

async function checkDownloadDir(dir) {
    try {
        await fs.promises.access(dir);
        console.log(`Directory exists: ${dir}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

// TODO: Implement some sort of bucket sort function that checks 
// local files based on tags

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