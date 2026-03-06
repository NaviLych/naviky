/**
 * Naviky – New Tab page logic
 *
 * • Displays a time‑based (or custom) greeting
 * • Provides unified search: shortcuts → tabs → history → links → Google
 * • Click greeting → settings page
 */

import { db } from '../shared/db.js';
import { searchAll } from '../shared/search.js';
import { loadTheme } from '../shared/theme.js';

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

greetingEl.addEventListener('click', () => {
  window.location.href = chrome.runtime.getURL('src/settings/settings.html');
});

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

const searchProviders = {
  getShortcuts: () => db.getAll(db.STORES.SHORTCUTS),
  searchTabs: () => chrome.tabs.query({}),
  searchHistory: (q) => chrome.history.search({ text: q, maxResults: 10 }),
  getLinks: () => db.getAll(db.STORES.LINKS),
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

const doSearch = debounce(async (query) => {
  if (!query.trim()) {
    renderResults([]);
    return;
  }
  const results = await searchAll(query, searchProviders);
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
/*  Init                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  await db.initDefaults();
  await loadTheme();
  await initGreeting();
  searchInput.focus();
}

init();
