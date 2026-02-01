const { runDownloader, parseArgs, printHelp } = require('./scraper/downloader.js');

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  await runDownloader(options);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
