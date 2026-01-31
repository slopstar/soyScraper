const { runDownloader } = require('./utils/downloader.js');

async function main() {
  await runDownloader({});
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
