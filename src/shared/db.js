/**
 * IndexedDB wrapper for Naviky.
 * Database: "naviky", version 1
 * Stores: groups, links, shortcuts, settings
 *
 * Used by extension pages (newtab, settings) directly,
 * and by the service worker as a proxy for content scripts.
 */

const DB_NAME = 'naviky';
const DB_VERSION = 1;

let dbInstance = null;

/** Object store name constants */
const STORES = {
  GROUPS: 'groups',
  LINKS: 'links',
  SHORTCUTS: 'shortcuts',
  SETTINGS: 'settings',
};

/** Default shortcuts seeded on first install */
const DEFAULT_SHORTCUTS = [
  { keyword: 'g', urlTemplate: 'https://www.google.com/search?q=%s{+}' },
  { keyword: 'bing', urlTemplate: 'https://www.bing.com/search?q=%s{+}' },
  { keyword: 'yt', urlTemplate: 'https://www.youtube.com/results?search_query=%s{+}' },
  { keyword: 'gh', urlTemplate: 'https://github.com/search?q=%s{+}&type=repositories' },
  { keyword: 'wiki', urlTemplate: 'https://en.wikipedia.org/wiki/Special:Search?search=%s{+}' },
];

/** Default settings seeded on first install */
const DEFAULT_SETTINGS = [
  { key: 'greeting', value: '' },
  { key: 'userName', value: '' },
  { key: 'theme', value: 'dark' },
  // AI assistant
  { key: 'aiEndpoint', value: '' },
  { key: 'aiApiKey', value: '' },
  { key: 'aiModel', value: 'gpt-4o-mini' },
  { key: 'aiTargetLanguage', value: 'Chinese' },
  { key: 'aiTranslatePrompt', value: 'Translate the following text to {lang}. Output only the translation, no explanation:\n\n{text}' },
  { key: 'aiExplainPrompt', value: 'Explain the following text briefly and clearly in {lang}:\n\n{text}' },
];

/* ------------------------------------------------------------------ */
/*  Core: open / close                                                 */
/* ------------------------------------------------------------------ */

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const idb = event.target.result;

      // Groups: { id (auto), name, order }
      if (!idb.objectStoreNames.contains(STORES.GROUPS)) {
        const store = idb.createObjectStore(STORES.GROUPS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('name', 'name', { unique: true });
        store.createIndex('order', 'order', { unique: false });
      }

      // Links: { id (auto), groupId, title, url, order }
      if (!idb.objectStoreNames.contains(STORES.LINKS)) {
        const store = idb.createObjectStore(STORES.LINKS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('groupId', 'groupId', { unique: false });
        store.createIndex('order', 'order', { unique: false });
      }

      // Shortcuts: { id (auto), keyword, urlTemplate }
      if (!idb.objectStoreNames.contains(STORES.SHORTCUTS)) {
        const store = idb.createObjectStore(STORES.SHORTCUTS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('keyword', 'keyword', { unique: false });
      }

      // Settings: { key, value }  — key‑value store
      if (!idb.objectStoreNames.contains(STORES.SETTINGS)) {
        idb.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      // Re‑open on unexpected close (e.g. service‑worker restart)
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => reject(event.target.error);
  });
}

/* ------------------------------------------------------------------ */
/*  Generic CRUD helpers                                               */
/* ------------------------------------------------------------------ */

async function getAll(storeName) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getById(storeName, id) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function add(storeName, data) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).add(data);
    req.onsuccess = () => resolve(req.result); // returns generated key
    req.onerror = () => reject(req.error);
  });
}

async function update(storeName, data) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function remove(storeName, id) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getByIndex(storeName, indexName, value) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName) {
  const idb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------------------------------------------ */
/*  Seed defaults (safe to call multiple times)                        */
/* ------------------------------------------------------------------ */

async function initDefaults() {
  try {
    const shortcuts = await getAll(STORES.SHORTCUTS);
    if (shortcuts.length === 0) {
      for (const s of DEFAULT_SHORTCUTS) {
        try { await add(STORES.SHORTCUTS, s); } catch (_) { /* ignore race */ }
      }
    }
  } catch (_) { /* store may not exist yet */ }

  // Seed individual missing settings (safe for both fresh installs and upgrades)
  try {
    for (const s of DEFAULT_SETTINGS) {
      const existing = await getById(STORES.SETTINGS, s.key);
      if (!existing) {
        try { await add(STORES.SETTINGS, s); } catch (_) { /* ignore race */ }
      }
    }
  } catch (_) { /* store may not exist yet */ }
}

/* ------------------------------------------------------------------ */
/*  Settings convenience                                               */
/* ------------------------------------------------------------------ */

async function getSetting(key) {
  const row = await getById(STORES.SETTINGS, key);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  return update(STORES.SETTINGS, { key, value });
}

/* ------------------------------------------------------------------ */
/*  Import / Export                                                     */
/* ------------------------------------------------------------------ */

async function exportData() {
  const data = {};
  for (const name of Object.values(STORES)) {
    data[name] = await getAll(name);
  }
  return {
    app: 'naviky',
    version: DB_VERSION,
    exportDate: new Date().toISOString(),
    data,
  };
}

/**
 * Import previously‑exported JSON. Clears all stores first.
 * Uses put() so explicit IDs (including groupId references) are preserved.
 */
async function importData(jsonData) {
  if (jsonData.app !== 'naviky') {
    throw new Error('Invalid data file: not a Naviky export.');
  }

  for (const storeName of Object.values(STORES)) {
    await clearStore(storeName);
    const items = jsonData.data?.[storeName] || [];
    for (const item of items) {
      await update(storeName, item); // put() preserves original keys
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export const db = {
  STORES,
  openDB,
  getAll,
  getById,
  add,
  update,
  remove,
  getByIndex,
  clearStore,
  initDefaults,
  getSetting,
  setSetting,
  exportData,
  importData,
};
