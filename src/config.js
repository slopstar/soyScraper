const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DOWNLOAD_DIR = path.resolve(
  process.env.SOYSCRAPER_DOWNLOAD_DIR || path.join(DATA_DIR, 'downloadedImages')
);
const METADATA_DB = path.resolve(
  process.env.SOYSCRAPER_METADATA_DB || path.join(DATA_DIR, 'metadata.sqlite')
);

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  DOWNLOAD_DIR,
  METADATA_DB,
};
