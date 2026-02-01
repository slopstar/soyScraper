const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { ensureDownloadDir } = require('../fs/localFileManager');

const dbCache = new Map();

function ensureDbDir(dbPath) {
  const dir = path.dirname(dbPath);
  ensureDownloadDir(dir);
  return dir;
}

function initMetadataStore(dbPath) {
  if (dbCache.has(dbPath)) return dbCache.get(dbPath);
  ensureDbDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_metadata (
      post_number TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  dbCache.set(dbPath, db);
  return db;
}

function upsertMetadata(dbPath, postNumber, payload) {
  if (!postNumber) return;
  const db = initMetadataStore(dbPath);
  const stmt = db.prepare(`
    INSERT INTO post_metadata (post_number, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(post_number) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const updatedAt = payload && payload.savedAt ? String(payload.savedAt) : new Date().toISOString();
  stmt.run(String(postNumber), JSON.stringify(payload || {}), updatedAt);
}

function upsertMetadataBatch(dbPath, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const db = initMetadataStore(dbPath);
  const stmt = db.prepare(`
    INSERT INTO post_metadata (post_number, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(post_number) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      if (!row || !row.postNumber) continue;
      const payload = row.payload || {};
      const updatedAt = payload.savedAt ? String(payload.savedAt) : new Date().toISOString();
      stmt.run(String(row.postNumber), JSON.stringify(payload), updatedAt);
    }
  });
  tx(items);
}

function loadMetadataMap(dbPath) {
  if (!dbPath) return new Map();
  if (!fs.existsSync(dbPath)) return new Map();
  const db = initMetadataStore(dbPath);
  const rows = db.prepare('SELECT post_number, payload_json FROM post_metadata').all();
  const map = new Map();
  for (const row of rows) {
    if (!row || !row.post_number) continue;
    try {
      const data = JSON.parse(row.payload_json);
      map.set(String(row.post_number), data);
    } catch (err) {
      // Skip invalid rows to avoid blocking the index.
    }
  }
  return map;
}

function closeAllMetadataStores() {
  for (const db of dbCache.values()) {
    try {
      db.close();
    } catch (err) {
      // ignore
    }
  }
  dbCache.clear();
}

module.exports = {
  initMetadataStore,
  upsertMetadata,
  upsertMetadataBatch,
  loadMetadataMap,
  closeAllMetadataStores,
};
