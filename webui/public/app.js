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

let currentPage = 1;
let currentPageSize = Number.parseInt(pageSizeSelect.value, 10) || 48;
let totalPages = 1;
let lastDownloadStatus = null;
let downloadPollTimer = null;
let downloadPollInFlight = false;

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

function parseTokens(input) {
  return (input || '').match(/"[^"]+"|\S+/g) || [];
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
    const needsQuote = /\s/.test(value);
    const tokenValue = needsQuote ? `"${value}"` : value;
    const prefix = type === 'tag' ? 'tag' : 'variant';
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
    const needsQuote = /\s/.test(raw);
    const tokenValue = needsQuote ? `"${raw}"` : raw;
    return `${prefix}:${tokenValue}`;
  };

  variants.forEach((item) => addOption(formatToken('variant', item.value)));
  tags.forEach((item) => addOption(formatToken('tag', item.value)));
}

function renderResults(results) {
  resultsEl.innerHTML = '';

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No matches yet. Try a different query.';
    resultsEl.appendChild(empty);
    return;
  }

  results.forEach((item, idx) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--i', idx);

    const img = document.createElement('img');
    img.src = item.urlPath;
    img.alt = item.fileName;
    img.loading = 'lazy';

    const title = document.createElement('h3');
    title.textContent = item.postNumber ? `Post ${item.postNumber}` : item.fileName;

    const formatList = (list) =>
      list.map((value) => String(value).replace(/_/g, ' ')).join(', ');
    const variants = item.variants && item.variants.length ? formatList(item.variants) : '—';
    const tags = item.tags && item.tags.length ? formatList(item.tags) : '—';

    const meta = document.createElement('div');
    meta.className = 'meta-line';
    meta.innerHTML = `<strong>Variants:</strong> ${escapeHtml(variants)}<br />` +
      `<strong>Tags:</strong> ${escapeHtml(tags)}`;

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(meta);
    resultsEl.appendChild(card);
  });
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

async function runSearch({ refresh = false, page = currentPage } = {}) {
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

    renderResults(data.results || []);

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
  downloadLogEl.textContent = (status.log || []).join('\n');

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
      body: JSON.stringify({ args: [] }),
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

loadFacets();
runSearch({ page: 1 });
pollDownloadStatus();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollDownloadStatus();
});
