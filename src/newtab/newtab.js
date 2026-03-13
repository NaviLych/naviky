/**
 * Naviky – New Tab page logic
 *
 * • Displays a time‑based (or custom) greeting
 * • Provides unified search: shortcuts → tabs → history → links → Google
 * • Click greeting → settings page
 */

import { db } from '../shared/db.js';
import { searchAll } from '../shared/search.js';
import { loadTheme, setTheme } from '../shared/theme.js';

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */

const greetingEl = document.getElementById('greeting');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchWrapper = document.getElementById('searchWrapper');

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function getAutoGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 23) return 'Good evening';
  return 'Good night';
}

/* ------------------------------------------------------------------ */
/*  Greeting                                                           */
/* ------------------------------------------------------------------ */

async function initGreeting() {
  const custom = await db.getSetting('greeting');
  const name = await db.getSetting('userName');
  let text = custom || getAutoGreeting();
  if (name) text += `, ${name}`;
  greetingEl.textContent = text;
}

greetingEl.addEventListener('click', openSettings);

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

const searchProviders = {
  getShortcuts: () => db.getAll(db.STORES.SHORTCUTS),
  searchTabs: () => chrome.tabs.query({}),
  searchHistory: (q) => chrome.history.search({ text: q, maxResults: 10 }),
  getLinks: () => db.getAll(db.STORES.LINKS),
  getGroups: () => db.getAll(db.STORES.GROUPS),
};

let activeIndex = -1;
let currentResults = [];

function renderResults(results) {
  currentResults = results;
  activeIndex = -1;

  if (!results.length) {
    searchResults.innerHTML = '';
    searchResults.classList.remove('visible');
    searchWrapper.classList.remove('has-results');
    return;
  }

  searchResults.innerHTML = results
    .map(
      (r, i) => `
    <li data-index="${i}" class="${r.type === 'shortcut-hint' ? 'hint' : ''}">
      <span class="result-icon">${r.icon}</span>
      <div class="result-info">
        <div class="result-title">${escapeHtml(r.title)}</div>
        <div class="result-url">${escapeHtml(r.url || r.description)}</div>
      </div>
      <span class="result-badge">${r.type.replace('-hint', '')}</span>
    </li>`,
    )
    .join('');

  searchResults.classList.add('visible');
  searchWrapper.classList.add('has-results');
}

const MANAGE_KEYWORDS = ['manage', 'links', 'groups', 'shortcuts', '管理', '链接', '分组', '快捷'];

const doSearch = debounce(async (query) => {
  if (!query.trim()) {
    renderResults([]);
    return;
  }
  const results = await searchAll(query, searchProviders);

  // Inject "Manage" entry when link results exist or query matches manage keywords
  const hasLinks = results.some((r) => r.type === 'link');
  const queryLower = query.trim().toLowerCase();
  const matchesManage = MANAGE_KEYWORDS.some((kw) => queryLower.includes(kw));
  if (hasLinks || matchesManage) {
    const manageEntry = {
      type: 'manage',
      title: 'Manage Links, Groups & Shortcuts',
      url: 'manage.html',
      description: 'Open management page',
      icon: '⚙️',
    };
    const googleIdx = results.findIndex((r) => r.type === 'google');
    if (googleIdx >= 0) {
      results.splice(googleIdx, 0, manageEntry);
    } else {
      results.push(manageEntry);
    }
  }

  renderResults(results);
}, 150);

searchInput.addEventListener('input', (e) => doSearch(e.target.value));

/* ------------------------------------------------------------------ */
/*  Result selection                                                   */
/* ------------------------------------------------------------------ */

function selectResult(result) {
  if (!result || !result.url) return;

  if (result.type === 'tab') {
    chrome.tabs.update(result.tabId, { active: true });
    if (result.windowId) {
      chrome.windows.update(result.windowId, { focused: true });
    }
  } else {
    window.location.href = result.url;
  }
}

/* ------------------------------------------------------------------ */
/*  Keyboard navigation                                                */
/* ------------------------------------------------------------------ */

searchInput.addEventListener('keydown', (e) => {
  const len = currentResults.length;
  if (!len && e.key !== 'Escape') return;

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, len - 1);
      updateActiveHighlight();
      break;

    case 'ArrowUp':
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      updateActiveHighlight();
      break;

    case 'Enter':
      e.preventDefault();
      if (activeIndex >= 0) {
        selectResult(currentResults[activeIndex]);
      } else {
        // Select first actionable result
        const first = currentResults.find((r) => r.type !== 'shortcut-hint');
        if (first) selectResult(first);
      }
      break;

    case 'Escape':
      e.preventDefault();
      renderResults([]);
      searchInput.value = '';
      searchInput.blur();
      break;
  }
});

function updateActiveHighlight() {
  const items = searchResults.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('active', i === activeIndex));
  if (activeIndex >= 0 && items[activeIndex]) {
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  }
}

/* ------------------------------------------------------------------ */
/*  Click on result                                                    */
/* ------------------------------------------------------------------ */

searchResults.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const idx = parseInt(li.dataset.index, 10);
  if (idx >= 0 && idx < currentResults.length) {
    selectResult(currentResults[idx]);
  }
});

/* ------------------------------------------------------------------ */
/*  Close dropdown on outside click                                    */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (e) => {
  if (!searchWrapper.contains(e.target)) {
    renderResults([]);
  }
});

/* ------------------------------------------------------------------ */
/*  Settings panel – open / close                                      */
/* ------------------------------------------------------------------ */

const stOverlay = document.getElementById('stOverlay');

function openSettings() {
  stOverlay.hidden = false;
  // Populate fields fresh each time (in case DB changed elsewhere)
  initSettingsPanel();
}

function closeSettings() {
  stOverlay.hidden = true;
}

document.getElementById('stClose').addEventListener('click', closeSettings);

// Click on the dark overlay background (not on the panel) → close
stOverlay.addEventListener('click', (e) => {
  if (e.target === stOverlay) closeSettings();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !stOverlay.hidden) closeSettings();
});

/* ------------------------------------------------------------------ */
/*  Settings – Personalization                                         */
/* ------------------------------------------------------------------ */

async function initPersonalization() {
  const greeting = (await db.getSetting('greeting')) || '';
  const userName = (await db.getSetting('userName')) || '';
  const theme    = (await db.getSetting('theme'))    || 'dark';

  document.getElementById('greetingInput').value = greeting;
  document.getElementById('userNameInput').value  = userName;
  updateThemeButtons(theme);

  if (initPersonalization.bound) return;
  initPersonalization.bound = true;

  document.getElementById('greetingInput').addEventListener(
    'input',
    debounce(async (e) => {
      await db.setSetting('greeting', e.target.value);
      await initGreeting(); // live-update greeting text
    }, 400),
  );

  document.getElementById('userNameInput').addEventListener(
    'input',
    debounce(async (e) => {
      await db.setSetting('userName', e.target.value);
      await initGreeting();
    }, 400),
  );

  document.getElementById('themeLightBtn').addEventListener('click', () => applyThemeUI('light'));
  document.getElementById('themeDarkBtn').addEventListener('click',  () => applyThemeUI('dark'));
}

async function applyThemeUI(theme) {
  await setTheme(theme);
  updateThemeButtons(theme);
}

function updateThemeButtons(theme) {
  document.querySelectorAll('.st-theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

/* ------------------------------------------------------------------ */
/*  Settings – AI                                                      */
/* ------------------------------------------------------------------ */

async function initAISettings() {
  const fields = [
    { id: 'aiEndpointInput',        key: 'aiEndpoint'        },
    { id: 'aiApiKeyInput',          key: 'aiApiKey'          },
    { id: 'aiModelInput',           key: 'aiModel'           },
    { id: 'aiTargetLangInput',      key: 'aiTargetLanguage'  },
    { id: 'aiTranslatePromptInput', key: 'aiTranslatePrompt' },
    { id: 'aiExplainPromptInput',   key: 'aiExplainPrompt'   },
  ];

  for (const { id, key } of fields) {
    const el = document.getElementById(id);
    if (el) el.value = (await db.getSetting(key)) ?? '';
  }

  if (initAISettings.bound) return;
  initAISettings.bound = true;

  for (const { id, key } of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener(
      'input',
      debounce(async (e) => db.setSetting(key, e.target.value.trim()), 400),
    );
  }

  document.getElementById('aiApiKeyToggle').addEventListener('click', () => {
    const inp = document.getElementById('aiApiKeyInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('aiTestBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('aiTestResult');
    resultEl.textContent = '测试中…';
    resultEl.style.color = '';
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AI_QUERY',
        text: 'Hello',
        action: 'explain',
      });
      if (res?.error) {
        resultEl.textContent = '✖ ' + res.error;
        resultEl.style.color = '#f87171';
      } else {
        resultEl.textContent = '✓ 连接成功';
        resultEl.style.color = '#4ade80';
      }
    } catch (err) {
      resultEl.textContent = '✖ ' + err.message;
      resultEl.style.color = '#f87171';
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Settings – Data management                                         */
/* ------------------------------------------------------------------ */

function initDataManagement() {
  if (initDataManagement.bound) return;
  initDataManagement.bound = true;

  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const data = await db.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `naviky-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm('This will replace ALL existing data. Continue?')) return;
      await db.importData(data);
      await loadTheme();
      await initSettingsPanel();
      await initGreeting();
      alert('Data imported successfully!');
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    e.target.value = '';
  });
}

/* ------------------------------------------------------------------ */
/*  Init settings panel (called each time panel opens)                 */
/* ------------------------------------------------------------------ */

async function initSettingsPanel() {
  await initPersonalization();
  await initAISettings();
  initDataManagement();
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  await db.initDefaults();
  await loadTheme();
  await initGreeting();
  searchInput.focus();
}

init();
