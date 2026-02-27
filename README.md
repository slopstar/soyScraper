# SoyScraper

SoyScraper downloads media from soybooru, stores metadata in SQLite, and provides a local web UI for browsing by tag, variant, and post ID.

## Install

From the project root:

```bash
npm run setup
```

`setup` is made for Debian/Ubuntu first and also supports common package managers on other Linux distros and macOS.

## Use

Download posts:

```bash
npm start
```

CLI options are available (see `--help`):

```bash
node src/cli.js --help
npm start -- --start 1 --end 200
npm start -- --fill-gaps
```

Single post test:

```bash
npm run single-post-test 12345
```
Start the web UI:

```bash
npm run webui
```

Then open `http://localhost:3000`.

If antivirus setup fails (this is currently running ClamAV), you can still run downloads with:

```bash
SOYSCRAPER_REQUIRE_VIRUS_SCAN=false npm start
```
