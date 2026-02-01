# SoyScraper

SoyScraper downloads images from soybooru and provides a lightweight local web UI for browsing by tags, variants, and post id.

## Structure

- `src/` application runtime code
- `src/scraper/` scraping and download logic
- `src/fs/` filesystem helpers
- `scripts/` one-off scripts (e.g., single-post test)
- `webui/` local browser UI + API
- `data/` downloaded content (ignored by git)

## Usage

Install dependencies:

```bash
npm install
```

Download posts:

```bash
npm start
```

CLI options are available (see `--help`):

```bash
node src/cli.js --help
npm start -- --start 1 --end 200
```

Single post test:

```bash
npm run single-post-test 12345
```

Start the web UI:

```bash
npm run webui
```

## Configuration

Environment variables:

- `SOYSCRAPER_DOWNLOAD_DIR`: override where images are stored (default: `data/downloadedImages`)
- `PORT`: web UI port (default: `3000`)

## Notes

The web UI indexes filenames and folder names to enable quick searches by `tag:`, `variant:`, or `post:`.
