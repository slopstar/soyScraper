const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const { ROOT_DIR, DOWNLOAD_DIR, TAGS_DIR } = require('../src/config.js');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

let indexCache = [];
let indexMeta = { lastIndexedAt: null, indexedTotal: 0 };
let downloadProcess = null;
let downloadState = {
  running: false,
  startedAt: null,
  endedAt: null,
  exitCode: null,
};
const downloadLog = [];
const MAX_LOG_LINES = 200;
const RESCAN_DEBOUNCE_MS = 1500;
const SSE_HEARTBEAT_MS = 30000;
const sseClients = new Set();

function safeJoin(baseDir, targetPath) {
  const normalized = path.normalize(targetPath).replace(/^([/\\])+/, '');
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, normalized);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFilterValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_');
}

function normalizeQueryValue(queryValue) {
  return String(queryValue || '').replace(
    /\b(tag|t|variant|v)\s*:\s*"([^"]+)"/gi,
    (match, key, value) => `${key.toLowerCase()}:${normalizeFilterValue(value)}`
  );
}

function encodePathSegments(relPath) {
  return relPath
    .split(path.sep)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function appendDownloadLog(chunk) {
  const lines = String(chunk).split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    downloadLog.push(line);
    if (downloadLog.length > MAX_LOG_LINES) {
      downloadLog.shift();
    }
  }
}

function setDownloadState(update) {
  downloadState = { ...downloadState, ...update };
}

function getDownloadStatus() {
  return {
    ...downloadState,
    pid: downloadProcess ? downloadProcess.pid : null,
    log: downloadLog.slice(-MAX_LOG_LINES),
  };
}

function startDownload(args = []) {
  if (downloadProcess) {
    return { ok: false, error: 'Download already running.' };
  }

  const cliPath = path.join(ROOT_DIR, 'src', 'cli.js');
  const sanitizedArgs = args.filter((arg) => typeof arg === 'string');
  downloadLog.length = 0;
  const child = spawn(process.execPath, [cliPath, ...sanitizedArgs], {
    cwd: ROOT_DIR,
    env: { ...process.env },
  });

  downloadProcess = child;
  setDownloadState({
    running: true,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
  });
  appendDownloadLog(`Started download at ${new Date().toLocaleString()}`);

  child.stdout.on('data', (data) => appendDownloadLog(data));
  child.stderr.on('data', (data) => appendDownloadLog(data));

  child.on('exit', (code) => {
    appendDownloadLog(`Download process exited with code ${code}`);
    downloadProcess = null;
    setDownloadState({
      running: false,
      endedAt: new Date().toISOString(),
      exitCode: code,
    });
  });

  child.on('error', (err) => {
    appendDownloadLog(`Download process error: ${err.message}`);
    downloadProcess = null;
    setDownloadState({
      running: false,
      endedAt: new Date().toISOString(),
      exitCode: null,
    });
  });

  return { ok: true };
}

function stopDownload() {
  if (!downloadProcess) return { ok: false, error: 'No download running.' };
  const stopped = downloadProcess.kill('SIGINT');
  appendDownloadLog('Sent SIGINT to downloader.');
  return { ok: stopped };
}

function collectJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        resolve({});
      }
    });
  });
}

function walkImages(dir, baseDir, items) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkImages(fullPath, baseDir, items);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;
      const relPath = path.relative(baseDir, fullPath);
      items.push({ fullPath, relPath });
    }
  }
}

function loadTagMetadataMap() {
  const map = new Map();
  if (!fs.existsSync(TAGS_DIR)) return map;
  const entries = fs.readdirSync(TAGS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(TAGS_DIR, entry.name);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const postNumber = data && data.postNumber ? String(data.postNumber) : entry.name.replace(/\.json$/i, '');
      if (!postNumber) continue;
      map.set(postNumber, data);
    } catch (err) {
      console.warn(`Failed to read metadata ${entry.name}: ${err.message}`);
    }
  }
  return map;
}

function parseMetadata(relPath, tagIndex) {
  const ext = path.extname(relPath);
  const baseName = path.basename(relPath, ext);
  const postMatch = baseName.match(/^(\d+)/);
  const postNumber = postMatch ? postMatch[1] : '';
  let variants = [];
  let tags = [];
  let metaUrl = '';

  const tagMeta = postNumber && tagIndex ? tagIndex.get(postNumber) : null;
  if (tagMeta) {
    variants = Array.isArray(tagMeta.variants) ? tagMeta.variants : [];
    tags = Array.isArray(tagMeta.tags) ? tagMeta.tags : [];
    metaUrl = tagMeta.postUrl || (Array.isArray(tagMeta.imageUrls) ? tagMeta.imageUrls[0] : '') || '';
  } else {
    const parts = baseName.split(' ').filter(Boolean);
    const variantParts = parts.filter((part) => part.startsWith('v-'));
    const tagParts = parts.filter((part, idx) => idx !== 0 && !part.startsWith('v-'));
    variants = variantParts.map((part) => part.slice(2));
    tags = tagParts;

    const relSegments = relPath.split(path.sep);
    const variantDir = relSegments.length > 1 ? relSegments[0] : '';
    if (variantDir && variantDir !== 'multiple') {
      const normalizedVariantDir = normalizeText(variantDir);
      const knownVariants = new Set(variants.map((v) => normalizeText(v)));
      if (!knownVariants.has(normalizedVariantDir)) variants.push(variantDir);
    }
  }

  variants = variants.map(normalizeFilterValue).filter(Boolean);
  tags = tags.map(normalizeFilterValue).filter(Boolean);

  const normalizedVariants = variants.map(normalizeText).filter(Boolean);
  const normalizedTags = tags.map(normalizeText).filter(Boolean);
  const searchText = normalizeText(
    [postNumber, variants.join(' '), tags.join(' '), baseName].join(' ')
  );

  return {
    relPath,
    postNumber,
    variants,
    tags,
    normalizedVariants,
    normalizedTags,
    searchText,
    ext,
    baseName,
    metaUrl,
  };
}

function addCount(map, rawValue) {
  const key = normalizeText(rawValue);
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    map.set(key, { key, value: rawValue, count: 1 });
  }
}

function sortCounts(map) {
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
}

function buildFacets(index) {
  const variantMap = new Map();
  const tagMap = new Map();

  for (const item of index) {
    for (const variant of item.variants) addCount(variantMap, variant);
    for (const tag of item.tags) addCount(tagMap, tag);
  }

  return {
    variants: sortCounts(variantMap),
    tags: sortCounts(tagMap),
  };
}

function buildIndex() {
  const items = [];
  walkImages(DOWNLOAD_DIR, DOWNLOAD_DIR, items);
  const tagIndex = loadTagMetadataMap();

  const index = items.map(({ relPath }) => {
    const meta = parseMetadata(relPath, tagIndex);
    return {
      ...meta,
      urlPath: `/images/${encodePathSegments(relPath)}`,
      fileName: path.basename(relPath),
    };
  });

  index.sort(compareByPostNumberDesc);
  indexCache = index;
  const facets = buildFacets(index);
  indexMeta = {
    lastIndexedAt: new Date().toISOString(),
    indexedTotal: index.length,
    facets,
  };

  return indexCache;
}

function parsePostNumberValue(value, fallbackText) {
  const raw = String(value || '').trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const fallback = String(fallbackText || '');
  const match = fallback.match(/(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareByPostNumberDesc(a, b) {
  const aNum = parsePostNumberValue(a.postNumber, a.baseName);
  const bNum = parsePostNumberValue(b.postNumber, b.baseName);
  if (aNum === null && bNum === null) return a.baseName.localeCompare(b.baseName);
  if (aNum === null) return 1;
  if (bNum === null) return -1;
  if (aNum !== bNum) return bNum - aNum;
  return a.baseName.localeCompare(b.baseName);
}

let indexRebuildTimer = null;
const activeWatchers = new Map();

function scheduleIndexRebuild(reason) {
  if (indexRebuildTimer) return;
  indexRebuildTimer = setTimeout(() => {
    indexRebuildTimer = null;
    buildIndex();
    broadcastIndexUpdate(reason || 'watch');
    if (reason) {
      console.log(`Index rebuilt (${reason}) at ${new Date().toLocaleTimeString()}`);
    }
  }, RESCAN_DEBOUNCE_MS);
}

function addDirectoryWatcher(dir) {
  if (activeWatchers.has(dir)) return;
  try {
    const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
      scheduleIndexRebuild(`fs.watch ${eventType}`);
      if (!filename) return;
      const nextPath = path.join(dir, filename);
      try {
        const stats = fs.statSync(nextPath);
        if (stats.isDirectory()) addDirectoryWatcher(nextPath);
      } catch (err) {
        // Ignore transient paths that disappear quickly.
      }
    });
    watcher.on('error', (err) => {
      activeWatchers.delete(dir);
      console.warn(`Watcher error on ${dir}: ${err.message}`);
    });
    activeWatchers.set(dir, watcher);
  } catch (err) {
    console.warn(`Failed to watch ${dir}: ${err.message}`);
  }
}

function watchDirectoryTree(rootDir) {
  if (!fs.existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    addDirectoryWatcher(current);
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastIndexUpdate(reason) {
  if (!indexMeta.lastIndexedAt) return;
  const payload = {
    indexedAt: indexMeta.lastIndexedAt,
    indexedTotal: indexMeta.indexedTotal,
    reason: reason || 'update',
  };
  for (const res of sseClients) {
    try {
      sendSse(res, 'index', payload);
    } catch (err) {
      sseClients.delete(res);
    }
  }
}

function parseQuery(queryValue) {
  const normalizedQuery = normalizeQueryValue(queryValue);
  const tokens = (normalizedQuery || '').match(/"[^"]+"|\S+/g) || [];
  const filters = { tags: [], variants: [], posts: [], general: [] };

  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, '');
    const colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
      const key = token.slice(0, colonIndex).toLowerCase();
      const value = token.slice(colonIndex + 1).trim();
      if (!value) continue;
      if (key === 'tag' || key === 't') filters.tags.push(value);
      else if (key === 'variant' || key === 'v') filters.variants.push(value);
      else if (key === 'post' || key === 'id') filters.posts.push(value);
      else filters.general.push(token);
    } else if (token.startsWith('#')) {
      filters.tags.push(token.slice(1));
    } else {
      filters.general.push(token);
    }
  }

  return filters;
}

function matchesFilters(item, filters) {
  const normalizedPost = normalizeText(item.postNumber);
  if (filters.posts.length) {
    const matchesPost = filters.posts.some(
      (post) => normalizeText(post) === normalizedPost
    );
    if (!matchesPost) return false;
  }

  if (filters.tags.length) {
    const tagSet = new Set(item.normalizedTags);
    const matchesTags = filters.tags.every((tag) => tagSet.has(normalizeText(tag)));
    if (!matchesTags) return false;
  }

  if (filters.variants.length) {
    const variantSet = new Set(item.normalizedVariants);
    const matchesVariants = filters.variants.every((v) => variantSet.has(normalizeText(v)));
    if (!matchesVariants) return false;
  }

  if (filters.general.length) {
    const searchText = item.searchText;
    const matchesGeneral = filters.general.every((token) =>
      searchText.includes(normalizeText(token))
    );
    if (!matchesGeneral) return false;
  }

  return true;
}

function handleSearch(req, res, query) {
  const refresh = query.refresh === '1' || query.refresh === 'true';
  if (refresh || !indexMeta.lastIndexedAt) {
    buildIndex();
    broadcastIndexUpdate(refresh ? 'refresh' : 'startup');
  }

  const q = query.q || '';
  const filters = parseQuery(q);
  const limitRaw = parseInt(query.limit || '60', 10);
  const limitValue = Number.isNaN(limitRaw) ? 60 : limitRaw;
  const limit = Math.max(1, Math.min(limitValue, 500));
  const pageRaw = parseInt(query.page || '1', 10);
  const page = Number.isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);

  const matches = indexCache.filter((item) => matchesFilters(item, filters));
  const totalPages = Math.max(1, Math.ceil(matches.length / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;
  const results = matches.slice(offset, offset + limit);

  const response = {
    ok: true,
    query: q,
    total: matches.length,
    page: safePage,
    pageSize: limit,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
    results,
    indexedAt: indexMeta.lastIndexedAt,
    indexedTotal: indexMeta.indexedTotal,
  };

  const payload = JSON.stringify(response);
  res.writeHead(200, { 'Content-Type': MIME['.json'] });
  res.end(payload);
}

function handleFacets(req, res, query) {
  const refresh = query.refresh === '1' || query.refresh === 'true';
  if (refresh || !indexMeta.lastIndexedAt) {
    buildIndex();
    broadcastIndexUpdate(refresh ? 'refresh' : 'startup');
  }
  const limitRaw = parseInt(query.limit || '24', 10);
  const limitValue = Number.isNaN(limitRaw) ? 24 : limitRaw;
  const limit = Math.max(1, Math.min(limitValue, 200));
  const facets = indexMeta.facets || buildFacets(indexCache);
  const mapEntry = (entry) => ({ value: entry.value, count: entry.count });

  const response = {
    ok: true,
    variants: facets.variants.slice(0, limit).map(mapEntry),
    tags: facets.tags.slice(0, limit).map(mapEntry),
    indexedAt: indexMeta.lastIndexedAt,
    indexedTotal: indexMeta.indexedTotal,
  };

  const payload = JSON.stringify(response);
  res.writeHead(200, { 'Content-Type': MIME['.json'] });
  res.end(payload);
}

async function handleDownloadStart(req, res) {
  const body = await collectJson(req);
  const args = Array.isArray(body.args) ? body.args.filter((arg) => typeof arg === 'string') : [];
  const result = startDownload(args);

  const payload = JSON.stringify({ ...result, status: getDownloadStatus() });
  res.writeHead(result.ok ? 200 : 409, { 'Content-Type': MIME['.json'] });
  res.end(payload);
}

function handleDownloadStop(req, res) {
  const result = stopDownload();
  const payload = JSON.stringify({ ...result, status: getDownloadStatus() });
  res.writeHead(result.ok ? 200 : 409, { 'Content-Type': MIME['.json'] });
  res.end(payload);
}

function handleDownloadStatus(req, res) {
  const payload = JSON.stringify({ ok: true, status: getDownloadStatus() });
  res.writeHead(200, { 'Content-Type': MIME['.json'] });
  res.end(payload);
}

function handleIndexStatus(req, res) {
  const payload = JSON.stringify({
    ok: true,
    indexedAt: indexMeta.lastIndexedAt,
    indexedTotal: indexMeta.indexedTotal,
  });
  res.writeHead(200, { 'Content-Type': MIME['.json'] });
  res.end(payload);
}

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 5000\n\n');
  sendSse(res, 'index', {
    indexedAt: indexMeta.lastIndexedAt,
    indexedTotal: indexMeta.indexedTotal,
    reason: 'hello',
  });
  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function serveImage(res, relPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  const safePath = safeJoin(DOWNLOAD_DIR, decoded);
  if (!safePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (pathname === '/api/search' && req.method === 'GET') {
    handleSearch(req, res, parsed.query || {});
    return;
  }
  if (pathname === '/api/index' && req.method === 'GET') {
    handleIndexStatus(req, res);
    return;
  }
  if (pathname === '/api/stream' && req.method === 'GET') {
    handleStream(req, res);
    return;
  }
  if (pathname === '/api/facets' && req.method === 'GET') {
    handleFacets(req, res, parsed.query || {});
    return;
  }
  if (pathname === '/api/download/status' && req.method === 'GET') {
    handleDownloadStatus(req, res);
    return;
  }
  if (pathname === '/api/download/start' && req.method === 'POST') {
    handleDownloadStart(req, res);
    return;
  }
  if (pathname === '/api/download/stop' && req.method === 'POST') {
    handleDownloadStop(req, res);
    return;
  }

  if (pathname.startsWith('/images/')) {
    const relPath = pathname.replace(/^\/images\//, '');
    serveImage(res, relPath);
    return;
  }

  let filePath;
  if (pathname === '/' || pathname === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    const rel = pathname.replace(/^\//, '');
    filePath = safeJoin(PUBLIC_DIR, rel);
  }

  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  serveStaticFile(res, filePath);
});

server.listen(PORT, () => {
  buildIndex();
  broadcastIndexUpdate('startup');
  watchDirectoryTree(DOWNLOAD_DIR);
  watchDirectoryTree(TAGS_DIR);
  console.log(`SoyScraper Web UI running at http://localhost:${PORT}`);
  console.log(`Using downloads from: ${DOWNLOAD_DIR}`);
});

const heartbeat = setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      sseClients.delete(res);
    }
  }
}, SSE_HEARTBEAT_MS);
heartbeat.unref();
