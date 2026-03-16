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

let _availableModels = [];

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

  document.getElementById('aiFetchModelsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('aiFetchModelsBtn');
    const resultEl = document.getElementById('aiTestResult');
    btn.disabled = true;
    btn.textContent = '…';
    resultEl.textContent = '获取模型中…';
    resultEl.style.color = '';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'AI_FETCH_MODELS' });
      if (res?.error) {
        resultEl.textContent = '✖ ' + res.error;
        resultEl.style.color = '#f87171';
      } else {
        _availableModels = res.models;
        resultEl.textContent = `✓ 获取到 ${res.models.length} 个模型`;
        resultEl.style.color = '#4ade80';
        // Refresh dropdown if it's currently open
        if (!modelDropdown.hidden) renderList('');
      }
    } catch (err) {
      resultEl.textContent = '✖ ' + err.message;
      resultEl.style.color = '#f87171';
    } finally {
      btn.disabled = false;
      btn.textContent = '↻';
    }
  });

  // ── Model combobox ──────────────────────────────────────────────
  const modelInput    = document.getElementById('aiModelInput');
  const modelDropdown = document.getElementById('aiModelDropdown');
  const modelSearch   = document.getElementById('aiModelSearch');
  const modelList     = document.getElementById('aiModelList');
  let _activeIdx = -1;

  function positionDropdown() {
    const r = modelInput.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const dropH = Math.min(288, _availableModels.length * 33 + 52);
    modelDropdown.style.left  = r.left + 'px';
    modelDropdown.style.width = r.width + 'px';
    if (spaceBelow >= dropH || spaceBelow >= 140) {
      modelDropdown.style.top    = (r.bottom + 4) + 'px';
      modelDropdown.style.bottom = '';
    } else {
      modelDropdown.style.top    = '';
      modelDropdown.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    }
  }

  function renderList(filter) {
    const q = (filter ?? modelSearch.value).trim().toLowerCase();
    const matches = q
      ? _availableModels.filter((m) => m.toLowerCase().includes(q))
      : [..._availableModels];
    _activeIdx = -1;
    if (!matches.length) {
      modelList.innerHTML = `<li style="color:var(--text-muted);cursor:default">无匹配结果</li>`;
    } else {
      modelList.innerHTML = matches.map((m) => `<li>${escapeHtml(m)}</li>`).join('');
    }
  }

  function openModelDropdown() {
    if (!_availableModels.length) return;
    renderList('');
    modelSearch.value = '';
    positionDropdown();
    modelDropdown.hidden = false;
    modelSearch.focus();
  }

  function closeModelDropdown() {
    modelDropdown.hidden = true;
    _activeIdx = -1;
  }

  function pickModel(id) {
    modelInput.value = id;
    closeModelDropdown();
    db.setSetting('aiModel', id);
  }

  function highlightItem(idx) {
    const items = modelList.querySelectorAll('li');
    items.forEach((li, i) => li.classList.toggle('nk-active', i === idx));
    if (idx >= 0) items[idx]?.scrollIntoView({ block: 'nearest' });
  }

  // Main input: click / focus opens dropdown
  modelInput.addEventListener('mousedown', (e) => {
    if (_availableModels.length) { e.preventDefault(); openModelDropdown(); }
  });

  // Search input: typing filters the list
  modelSearch.addEventListener('input', () => renderList(modelSearch.value));

  // Keyboard navigation on search input
  modelSearch.addEventListener('keydown', (e) => {
    const items = [...modelList.querySelectorAll('li')];
    const selectable = items.filter((li) => li.style.cursor !== 'default');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, selectable.length - 1);
      highlightItem(_activeIdx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      highlightItem(_activeIdx);
    } else if (e.key === 'Enter') {
      const active = modelList.querySelector('li.nk-active');
      if (active && active.style.cursor !== 'default') { e.preventDefault(); pickModel(active.textContent); }
    } else if (e.key === 'Escape') {
      e.preventDefault(); closeModelDropdown(); modelInput.focus();
    }
  });

  // Click on list item
  modelList.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li && li.style.cursor !== 'default') { e.preventDefault(); pickModel(li.textContent); }
  });

  // Close when focus leaves both the input and the dropdown
  modelInput.addEventListener('blur', () => setTimeout(() => {
    if (!modelDropdown.contains(document.activeElement)) closeModelDropdown();
  }, 150));

  modelSearch.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== modelInput) closeModelDropdown();
  }, 150));

  window.addEventListener('scroll', closeModelDropdown, true);
  window.addEventListener('resize', () => { if (!modelDropdown.hidden) positionDropdown(); });

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
/*  Settings – Custom prompt buttons                                   */
/* ------------------------------------------------------------------ */

async function initCustomPromptsPanel() {
  const container = document.getElementById('stCustomPromptsContainer');
  const addBtn    = document.getElementById('stAddCustomPromptBtn');
  if (!container || !addBtn) return;

  let prompts = [];
  try {
    const raw = (await db.getSetting('aiCustomPrompts')) || '[]';
    prompts = JSON.parse(raw);
  } catch (_) {
    prompts = [];
  }

  async function save() {
    await db.setSetting('aiCustomPrompts', JSON.stringify(prompts));
  }

  function renderRows() {
    container.innerHTML = '';
    prompts.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'st-custom-prompt-row';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'st-input';
      nameInput.placeholder = '按钮名称';
      nameInput.value = p.name;
      nameInput.addEventListener('input', debounce(() => {
        prompts[i].name = nameInput.value;
        save();
      }, 400));

      const promptInput = document.createElement('textarea');
      promptInput.className = 'st-input st-textarea';
      promptInput.rows = 2;
      promptInput.placeholder = 'Prompt，用 {text} 代表所选文字';
      promptInput.value = p.prompt;
      promptInput.addEventListener('input', debounce(() => {
        prompts[i].prompt = promptInput.value;
        save();
      }, 400));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'st-btn st-btn-sm st-btn-danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', () => {
        prompts.splice(i, 1);
        save();
        renderRows();
      });

      row.appendChild(nameInput);
      row.appendChild(promptInput);
      row.appendChild(delBtn);
      container.appendChild(row);
    });
  }

  // Re-register add button only once
  if (!initCustomPromptsPanel.bound) {
    initCustomPromptsPanel.bound = true;
    addBtn.addEventListener('click', () => {
      prompts.push({ name: '自定义', prompt: '{text}' });
      save();
      renderRows();
    });
  }

  renderRows();
}

/* ------------------------------------------------------------------ */
/*  Init settings panel (called each time panel opens)                 */
/* ------------------------------------------------------------------ */

async function initSettingsPanel() {
  await initPersonalization();
  await initAISettings();
  await initCustomPromptsPanel();
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
