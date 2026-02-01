# SoyScraper

SoyScraper downloads images from soybooru and provides a lightweight local web UI for browsing by tags, variants, and post id.

## Structure

- `src/` application runtime code
- `src/scraper/` scraping and download logic
- `src/fs/` filesystem helpers
- `scripts/` one-off scripts (e.g., single-post test)
- `webui/` local browser UI + API
- `data/` downloaded content (ignored by git)
  - `data/metadata.sqlite` stores post metadata (tags, variants, stats)

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
- `SOYSCRAPER_IMAGE_LAYOUT`: image folder layout (`bucket` default, or `flat`)
- `SOYSCRAPER_IMAGE_BUCKET_SIZE`: bucket size when layout is `bucket` (default: `1000`)
- `SOYSCRAPER_METADATA_DB`: override where metadata is stored (default: `data/metadata.sqlite`)
- `PORT`: web UI port (default: `3000`)


## Notes

The web UI indexes filenames and folder names to enable quick searches by `tag:`, `variant:`, or `post:`.
Images are bucketed into subfolders by post number (e.g., `data/downloadedImages/000000-000999`) unless you set `SOYSCRAPER_IMAGE_LAYOUT=flat`.
