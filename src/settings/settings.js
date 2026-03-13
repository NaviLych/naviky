/**
 * Naviky – Settings page logic
 *
 * Manages: personalization and data import/export.
 * All data is stored in IndexedDB via the shared db module.
 */

import { db } from '../shared/db.js';
import { loadTheme, setTheme } from '../shared/theme.js';

/* ================================================================== */
/*  Utilities                                                          */
/* ================================================================== */

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ================================================================== */
/*  Back button                                                        */
/* ================================================================== */

document.getElementById('backBtn').addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('src/newtab/newtab.html');
});

/* ================================================================== */
/*  Personalization                                                    */
/* ================================================================== */

async function initPersonalization() {
  const greeting = (await db.getSetting('greeting')) || '';
  const userName = (await db.getSetting('userName')) || '';
  const theme = (await db.getSetting('theme')) || 'dark';
  const greetingInput = document.getElementById('greetingInput');
  const userNameInput = document.getElementById('userNameInput');
  const themeLightBtn = document.getElementById('themeLightBtn');
  const themeDarkBtn = document.getElementById('themeDarkBtn');

  greetingInput.value = greeting;
  userNameInput.value = userName;
  updateThemeButtons(theme);

  if (initPersonalization.bound) {
    return;
  }

  initPersonalization.bound = true;

  greetingInput.addEventListener(
    'input',
    debounce(async (e) => {
      await db.setSetting('greeting', e.target.value);
    }, 400),
  );

  userNameInput.addEventListener(
    'input',
    debounce(async (e) => {
      await db.setSetting('userName', e.target.value);
    }, 400),
  );

  themeLightBtn.addEventListener('click', () => applyThemeUI('light'));
  themeDarkBtn.addEventListener('click', () => applyThemeUI('dark'));
}

async function applyThemeUI(theme) {
  await setTheme(theme);
  updateThemeButtons(theme);
}

function updateThemeButtons(theme) {
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

/* ================================================================== */
/*  Data Management                                                    */
/* ================================================================== */

// Export
document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const data = await db.exportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `naviky-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Export failed: ' + err.message);
  }
});

// Import
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!confirm('This will replace ALL existing data. Continue?')) return;

    await db.importData(data);

    // Reload everything
    await loadTheme();
    await initPersonalization();

    alert('Data imported successfully!');
  } catch (err) {
    alert('Import failed: ' + err.message);
  }

  // Reset input so the same file can be re‑imported
  e.target.value = '';
});

/* ================================================================== */
/*  Init                                                               */
/* ================================================================== */

/* ================================================================== */
/*  AI Settings                                                        */
/* ================================================================== */

async function initAISettings() {
  const fields = [
    { id: 'aiEndpointInput',       key: 'aiEndpoint'         },
    { id: 'aiApiKeyInput',         key: 'aiApiKey'           },
    { id: 'aiModelInput',          key: 'aiModel'            },
    { id: 'aiTargetLangInput',     key: 'aiTargetLanguage'   },
    { id: 'aiTranslatePromptInput',key: 'aiTranslatePrompt'  },
    { id: 'aiExplainPromptInput',  key: 'aiExplainPrompt'    },
  ];

  // Load saved values
  for (const { id, key } of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = (await db.getSetting(key)) ?? '';
  }

  if (initAISettings.bound) return;
  initAISettings.bound = true;

  // Auto-save on change
  for (const { id, key } of fields) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener(
      'input',
      debounce(async (e) => {
        await db.setSetting(key, e.target.value.trim());
      }, 400),
    );
  }

  // Show/hide API key
  document.getElementById('aiApiKeyToggle')?.addEventListener('click', () => {
    const input = document.getElementById('aiApiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Test connection
  document.getElementById('aiTestBtn')?.addEventListener('click', async () => {
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
        resultEl.style.color = 'var(--danger, #f87171)';
      } else {
        resultEl.textContent = '✓ 连接成功';
        resultEl.style.color = 'var(--success, #4ade80)';
      }
    } catch (err) {
      resultEl.textContent = '✖ ' + err.message;
      resultEl.style.color = 'var(--danger, #f87171)';
    }
  });
}

/* ================================================================== */
/*  Init                                                               */
/* ================================================================== */

async function init() {
  await db.initDefaults();
  await loadTheme();
  await initPersonalization();
  await initAISettings();
}

init();
