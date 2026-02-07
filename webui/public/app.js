const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const clearFiltersButton = document.getElementById('clearFiltersButton');
const rescanButton = document.getElementById('rescanButton');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const indexStat = document.getElementById('indexStat');
const updateStat = document.getElementById('updateStat');
const variantChips = document.getElementById('variantChips');
const tagChips = document.getElementById('tagChips');
const autocompleteList = document.getElementById('autocompleteList');
const prevPageButton = document.getElementById('prevPage');
const nextPageButton = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const pageSizeSelect = document.getElementById('pageSize');
const startDownloadButton = document.getElementById('startDownload');
const stopDownloadButton = document.getElementById('stopDownload');
const refreshDownloadButton = document.getElementById('refreshDownload');
const downloadStatusEl = document.getElementById('downloadStatus');
const downloadLogEl = document.getElementById('downloadLog');
const downloadFab = document.getElementById('downloadFab');
const downloadPopover = document.getElementById('downloadPopover');
const downloadPopoverClose = document.getElementById('downloadPopoverClose');
const downloadDock = document.getElementById('downloadDock');
const downloadLogToggle = document.getElementById('toggleDownloadLog');
const skipNsfwInput = document.getElementById('skipNsfw');
const nsfwFileInput = document.getElementById('nsfwFile');
const skipNsflInput = document.getElementById('skipNsfl');
const nsflFileInput = document.getElementById('nsflFile');

let currentPage = 1;
let currentPageSize = Number.parseInt(pageSizeSelect.value, 10) || 48;
let totalPages = 1;
let lastDownloadStatus = null;
let downloadPollTimer = null;
let downloadPollInFlight = false;
let downloadPopoverOpen = false;
let downloadLogVisible = false;
let lastIndexedAt = null;
let indexEventSource = null;
let indexPollTimer = null;
let indexPollInFlight = false;
let autoRefreshTimer = null;
let autoRefreshInFlight = false;
let pendingIndexRefresh = false;
let renderedMatchKeys = new Set();

function getMatchKey(item) {
  return item.urlPath || item.fileName || `${item.postNumber || ''}:${item.baseName || ''}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function normalizeQuery(input) {
  return String(input || '').replace(
    /\b(tag|t|variant|v)\s*:\s*"([^"]+)"/gi,
    (match, key, value) => `${key.toLowerCase()}:${normalizeFilterValue(value)}`
  );
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
  if (aNum === null && bNum === null) {
    return String(a.baseName || '').localeCompare(String(b.baseName || ''));
  }
  if (aNum === null) return 1;
  if (bNum === null) return -1;
  if (aNum !== bNum) return bNum - aNum;
  return String(a.baseName || '').localeCompare(String(b.baseName || ''));
}

function parseTokens(input) {
  const normalized = normalizeQuery(input);
  return normalized.match(/"[^"]+"|\S+/g) || [];
}

function extractActiveFilters() {
  const tokens = parseTokens(searchInput.value);
  const active = { tags: new Set(), variants: new Set() };

  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, '');
    if (token.startsWith('#')) {
      active.tags.add(normalizeText(token.slice(1)));
      continue;
    }
    const colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
      const key = token.slice(0, colonIndex).toLowerCase();
      const value = token.slice(colonIndex + 1).trim();
      if (!value) continue;
      if (key === 'tag' || key === 't') active.tags.add(normalizeText(value));
      if (key === 'variant' || key === 'v') active.variants.add(normalizeText(value));
    }
  }

  return active;
}

function updateChipActive() {
  const active = extractActiveFilters();
  const chips = document.querySelectorAll('.chip');
  chips.forEach((chip) => {
    const type = chip.dataset.type;
    const value = normalizeText(chip.dataset.value);
    const isActive = type === 'tag'
      ? active.tags.has(value)
      : active.variants.has(value);
    chip.classList.toggle('active', isActive);
  });
}

function toggleFilterToken(type, value) {
  const tokens = parseTokens(searchInput.value);
  const normalized = normalizeText(value);
  let removed = false;
  const kept = [];

  for (const raw of tokens) {
    const token = raw.replace(/^"|"$/g, '');
    let matched = false;
    if (token.startsWith('#') && type === 'tag') {
      if (normalizeText(token.slice(1)) === normalized) matched = true;
    } else {
      const colonIndex = token.indexOf(':');
      if (colonIndex > 0) {
        const key = token.slice(0, colonIndex).toLowerCase();
        const tokenValue = token.slice(colonIndex + 1).trim();
        if (tokenValue) {
          if ((type === 'tag' && (key === 'tag' || key === 't')) ||
              (type === 'variant' && (key === 'variant' || key === 'v'))) {
            if (normalizeText(tokenValue) === normalized) matched = true;
          }
        }
      }
    }

    if (matched) {
      removed = true;
      continue;
    }
    kept.push(raw);
  }

  if (!removed) {
    const prefix = type === 'tag' ? 'tag' : 'variant';
    const tokenValue = normalizeFilterValue(value);
    kept.push(`${prefix}:${tokenValue}`);
  }

  const next = kept.join(' ').trim();
  searchInput.value = next;
  runSearch({ page: 1 });
}

function renderChips(container, items, type) {
  container.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'meta-line';
    empty.textContent = 'No facets yet.';
    container.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const label = String(item.value).replace(/_/g, ' ');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.type = type;
    button.dataset.value = item.value;
    button.innerHTML = `${escapeHtml(label)} <span>${item.count}</span>`;
    button.addEventListener('click', () => toggleFilterToken(type, item.value));
    container.appendChild(button);
  });
}

function renderAutocomplete(variants, tags) {
  autocompleteList.innerHTML = '';
  const addOption = (value) => {
    const option = document.createElement('option');
    option.value = value;
    autocompleteList.appendChild(option);
  };

  const formatToken = (prefix, raw) => {
    const tokenValue = normalizeFilterValue(raw);
    return `${prefix}:${tokenValue}`;
  };

  variants.forEach((item) => addOption(formatToken('variant', item.value)));
  tags.forEach((item) => addOption(formatToken('tag', item.value)));
}

function buildResultCard(item, idx) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.key = getMatchKey(item);
  card.style.setProperty('--i', idx);

  const media = document.createElement('div');
  media.className = 'card-media';

  const ext = String(item.ext || '').toLowerCase();
  const isVideo = ext === '.mp4' || ext === '.webm';
  const mediaEl = isVideo ? document.createElement('video') : document.createElement('img');
  mediaEl.src = item.urlPath;
  mediaEl.addEventListener('dblclick', (event) => {
    event.preventDefault();
    window.open(item.urlPath, '_blank', 'noopener');
  });
  if (isVideo) {
    mediaEl.preload = 'metadata';
    mediaEl.muted = true;
    mediaEl.loop = true;
    mediaEl.playsInline = true;
    mediaEl.controls = true;
  } else {
    mediaEl.alt = item.fileName;
    mediaEl.loading = 'lazy';
  }

  const formatList = (list) => list.map((value) => String(value).replace(/_/g, ' ')).join(', ');
  const variants = item.variants && item.variants.length ? formatList(item.variants) : '—';
  const tags = item.tags && item.tags.length ? formatList(item.tags) : '—';

  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  const overlayTop = document.createElement('div');
  overlayTop.className = 'card-overlay-top';

  const openFull = document.createElement('a');
  openFull.className = 'open-full';
  openFull.href = item.urlPath;
  openFull.target = '_blank';
  openFull.rel = 'noopener';
  openFull.setAttribute('aria-label', `Open full ${isVideo ? 'video' : 'image'} in new tab`);
  openFull.title = `Open full ${isVideo ? 'video' : 'image'} in new tab`;
  openFull.textContent = '↗';
  overlayTop.appendChild(openFull);

  const info = document.createElement('div');
  info.className = 'card-info';

  const addInfoLine = (label, valueNode) => {
    const line = document.createElement('div');
    line.className = 'info-line';
    const labelEl = document.createElement('span');
    labelEl.className = 'info-label';
    labelEl.textContent = label;
    const valueEl = valueNode || document.createElement('span');
    valueEl.classList.add('info-value');
    line.appendChild(labelEl);
    line.appendChild(valueEl);
    info.appendChild(line);
  };

  const postValue = document.createElement('span');
  postValue.textContent = item.postNumber ? String(item.postNumber) : '—';
  addInfoLine('Post', postValue);

  const variantValue = document.createElement('span');
  variantValue.textContent = variants;
  addInfoLine('Variants', variantValue);

  const tagValue = document.createElement('span');
  tagValue.textContent = tags;
  addInfoLine('Tags', tagValue);

  if (item.metaUrl) {
    const link = document.createElement('a');
    link.href = item.metaUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'info-link';
    link.textContent = item.metaUrl;
    addInfoLine('URL', link);
  } else {
    const urlValue = document.createElement('span');
    urlValue.textContent = '—';
    addInfoLine('URL', urlValue);
  }

  overlay.appendChild(overlayTop);
  overlay.appendChild(info);

  media.appendChild(mediaEl);
  media.appendChild(overlay);

  card.appendChild(media);
  return card;
}

function renderResults(results, mode = 'full') {
  const sorted = results.slice().sort(compareByPostNumberDesc);

  if (mode === 'incremental' && currentPage === 1) {
    const newItems = sorted.filter((item) => !renderedMatchKeys.has(getMatchKey(item)));
    if (!newItems.length) return;
    resultsEl.querySelector('.empty')?.remove();
    const fragment = document.createDocumentFragment();
    newItems.forEach((item, idx) => {
      const key = getMatchKey(item);
      renderedMatchKeys.add(key);
      fragment.appendChild(buildResultCard(item, idx));
    });
    resultsEl.insertBefore(fragment, resultsEl.firstChild);
    while (resultsEl.children.length > currentPageSize) {
      const last = resultsEl.lastElementChild;
      if (!last) break;
      const key = last.dataset?.key;
      if (key) renderedMatchKeys.delete(key);
      resultsEl.removeChild(last);
    }
    return;
  }

  resultsEl.innerHTML = '';
  renderedMatchKeys = new Set();

  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No matches yet. Try a different query.';
    resultsEl.appendChild(empty);
    return;
  }

  sorted.forEach((item, idx) => {
    renderedMatchKeys.add(getMatchKey(item));
    resultsEl.appendChild(buildResultCard(item, idx));
  });
}

function setDownloadPopoverOpen(open) {
  if (!downloadPopover) return;
  downloadPopoverOpen = open;
  downloadPopover.hidden = !open;
  if (downloadFab) {
    downloadFab.setAttribute('aria-expanded', String(open));
    downloadFab.setAttribute('aria-pressed', String(open));
  }
  downloadDock?.classList.toggle('is-open', open);
}

function isDownloadPopoverOpen() {
  return downloadDock?.classList.contains('is-open') ?? false;
}

function toggleDownloadPopover() {
  if (!downloadPopover) return;
  setDownloadPopoverOpen(!isDownloadPopoverOpen());
}

function closeDownloadPopover() {
  setDownloadPopoverOpen(false);
}

function setDownloadLogVisible(visible) {
  downloadLogVisible = visible;
  if (downloadLogEl) downloadLogEl.hidden = !visible;
  if (downloadLogToggle) downloadLogToggle.textContent = visible ? 'Hide log' : 'Show log';
}

function buildDownloadArgs() {
  const args = [];
  if (skipNsfwInput?.checked) {
    args.push('--skip-nsfw');
    const nsfwPath = nsfwFileInput?.value?.trim();
    if (nsfwPath) {
      args.push('--nsfw-file', nsfwPath);
    }
  }
  if (skipNsflInput?.checked) {
    args.push('--skip-nsfl');
    const nsflPath = nsflFileInput?.value?.trim();
    if (nsflPath) {
      args.push('--nsfl-file', nsflPath);
    }
  }
  return args;
}

function updatePagination() {
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageButton.disabled = currentPage <= 1;
  nextPageButton.disabled = currentPage >= totalPages;
}

async function loadFacets({ refresh = false } = {}) {
  const params = new URLSearchParams();
  params.set('limit', '20');
  if (refresh) params.set('refresh', '1');

  try {
    const response = await fetch(`/api/facets?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Facets failed');
    }
    renderChips(variantChips, data.variants || [], 'variant');
    renderChips(tagChips, data.tags || [], 'tag');
    renderAutocomplete(data.variants || [], data.tags || []);
    updateChipActive();
  } catch (err) {
    variantChips.textContent = err.message;
    tagChips.textContent = err.message;
  }
}

async function runSearch({ refresh = false, page = currentPage, mode = 'full' } = {}) {
  const query = searchInput.value.trim();
  currentPage = page;

  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('limit', String(currentPageSize));
  params.set('page', String(currentPage));
  if (refresh) params.set('refresh', '1');

  statusEl.textContent = refresh ? 'Rescanning index...' : 'Searching...';

  try {
    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Search failed');
    }

    renderResults(data.results || [], mode);

    totalPages = data.totalPages || 1;
    currentPage = data.page || 1;
    updatePagination();

    if (data.total === 0) {
      statusEl.textContent = 'No matches. Try a different query.';
    } else {
      statusEl.textContent = `Showing ${data.results.length} of ${data.total} matches.`;
    }

    indexStat.textContent = `Indexed: ${data.indexedTotal}`;
    const updated = data.indexedAt ? new Date(data.indexedAt).toLocaleString() : '—';
    updateStat.textContent = `Updated: ${updated}`;
    lastIndexedAt = data.indexedAt || lastIndexedAt;

    updateChipActive();

    if (refresh) {
      await loadFacets({ refresh: true });
    }
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function renderDownloadStatus(status) {
  if (!status) {
    downloadStatusEl.textContent = 'Status unavailable.';
    return;
  }
  lastDownloadStatus = status;
  const started = status.startedAt ? new Date(status.startedAt).toLocaleString() : '—';
  const ended = status.endedAt ? new Date(status.endedAt).toLocaleString() : '—';
  const state = status.running ? 'Running' : 'Idle';
  const code = status.exitCode == null ? '—' : status.exitCode;
  downloadStatusEl.textContent = `${state}. Started: ${started}. Ended: ${ended}. Exit code: ${code}.`;
  const logLines = (status.log || []).slice().reverse();
  downloadLogEl.textContent = logLines.join('\n');
  if (downloadLogVisible && downloadLogEl) {
    downloadLogEl.scrollTop = 0;
  }

  startDownloadButton.disabled = status.running;
  stopDownloadButton.disabled = !status.running;
}

async function loadDownloadStatus() {
  try {
    const response = await fetch('/api/download/status');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Status failed');
    renderDownloadStatus(data.status);
    return data.status;
  } catch (err) {
    downloadStatusEl.textContent = err.message;
    return null;
  }
}

async function startDownload() {
  downloadStatusEl.textContent = 'Starting download...';
  try {
    const response = await fetch('/api/download/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: buildDownloadArgs() }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Start failed');
    renderDownloadStatus(data.status);
    scheduleDownloadPoll(1000);
  } catch (err) {
    downloadStatusEl.textContent = err.message;
  }
}

async function stopDownload() {
  downloadStatusEl.textContent = 'Stopping download...';
  try {
    const response = await fetch('/api/download/stop', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Stop failed');
    renderDownloadStatus(data.status);
    scheduleDownloadPoll(1000);
  } catch (err) {
    downloadStatusEl.textContent = err.message;
  }
}

function getDownloadPollDelay(status) {
  if (document.hidden) return 15000;
  if (!status) return 5000;
  return status.running ? 1000 : 8000;
}

function scheduleAutoRefresh(delay = 400) {
  pendingIndexRefresh = true;
  if (autoRefreshTimer) return;
  autoRefreshTimer = setTimeout(async () => {
    autoRefreshTimer = null;
    if (!pendingIndexRefresh || autoRefreshInFlight) return;
    pendingIndexRefresh = false;
    autoRefreshInFlight = true;
    await runSearch({ page: currentPage });
    await loadFacets();
    autoRefreshInFlight = false;
  }, delay);
}

function handleIndexUpdate(indexedAt) {
  if (!indexedAt) return;
  if (indexedAt === lastIndexedAt) return;
  lastIndexedAt = indexedAt;
  scheduleAutoRefresh();
}

function scheduleIndexPoll(delay) {
  if (indexPollTimer) clearTimeout(indexPollTimer);
  indexPollTimer = setTimeout(pollIndexStatus, delay);
}

function getIndexPollDelay() {
  return document.hidden ? 15000 : 5000;
}

async function pollIndexStatus() {
  if (indexPollInFlight) return;
  indexPollInFlight = true;
  try {
    const response = await fetch('/api/index');
    const data = await response.json();
    if (response.ok && data.ok) {
      handleIndexUpdate(data.indexedAt);
    }
  } catch (err) {
    // ignore
  } finally {
    indexPollInFlight = false;
    scheduleIndexPoll(getIndexPollDelay());
  }
}

function startIndexStream() {
  if (!window.EventSource) return false;
  const source = new EventSource('/api/stream');
  indexEventSource = source;
  source.addEventListener('index', (event) => {
    try {
      const data = JSON.parse(event.data || '{}');
      handleIndexUpdate(data.indexedAt);
    } catch (err) {
      // ignore
    }
  });
  source.addEventListener('error', () => {
    source.close();
    indexEventSource = null;
    scheduleIndexPoll(2000);
  });
  return true;
}

function scheduleDownloadPoll(delay) {
  if (downloadPollTimer) clearTimeout(downloadPollTimer);
  downloadPollTimer = setTimeout(pollDownloadStatus, delay);
}

async function pollDownloadStatus() {
  if (downloadPollInFlight) return;
  downloadPollInFlight = true;
  const status = await loadDownloadStatus();
  downloadPollInFlight = false;
  scheduleDownloadPoll(getDownloadPollDelay(status || lastDownloadStatus));
}

searchButton.addEventListener('click', () => runSearch({ page: 1 }));
clearFiltersButton.addEventListener('click', () => {
  searchInput.value = '';
  runSearch({ page: 1 });
});
rescanButton.addEventListener('click', () => runSearch({ refresh: true, page: 1 }));
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runSearch({ page: 1 });
});
searchInput.addEventListener('input', () => updateChipActive());

prevPageButton.addEventListener('click', () => {
  if (currentPage > 1) runSearch({ page: currentPage - 1 });
});

nextPageButton.addEventListener('click', () => {
  if (currentPage < totalPages) runSearch({ page: currentPage + 1 });
});

pageSizeSelect.addEventListener('change', () => {
  currentPageSize = Number.parseInt(pageSizeSelect.value, 10) || 48;
  runSearch({ page: 1 });
});

startDownloadButton.addEventListener('click', startDownload);
stopDownloadButton.addEventListener('click', stopDownload);
refreshDownloadButton.addEventListener('click', pollDownloadStatus);
downloadFab?.addEventListener('click', (event) => {
  event.preventDefault();
  toggleDownloadPopover();
});
downloadPopoverClose?.addEventListener('click', (event) => {
  event.preventDefault();
  closeDownloadPopover();
});
downloadLogToggle?.addEventListener('click', () => {
  setDownloadLogVisible(!downloadLogVisible);
});

setDownloadLogVisible(false);
setDownloadPopoverOpen(false);

loadFacets();
runSearch({ page: 1 });
pollDownloadStatus();
if (!startIndexStream()) {
  scheduleIndexPoll(2000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollDownloadStatus();
  if (!document.hidden && !indexEventSource) scheduleIndexPoll(2000);
});
