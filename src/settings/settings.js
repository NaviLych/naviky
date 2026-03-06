/**
 * Naviky – Settings page logic
 *
 * Manages: personalization, shortcuts, link groups, data import/export.
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

function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  document.getElementById('greetingInput').value = greeting;
  document.getElementById('userNameInput').value = userName;
  updateThemeButtons(theme);

  // Auto‑save inputs
  document.getElementById('greetingInput').addEventListener(
    'input',
    debounce(async (e) => {
      await db.setSetting('greeting', e.target.value);
    }, 400),
  );

  document.getElementById('userNameInput').addEventListener(
    'input',
    debounce(async (e) => {
      await db.setSetting('userName', e.target.value);
    }, 400),
  );

  // Theme buttons
  document
    .getElementById('themeLightBtn')
    .addEventListener('click', () => applyThemeUI('light'));
  document
    .getElementById('themeDarkBtn')
    .addEventListener('click', () => applyThemeUI('dark'));
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
/*  Shortcuts                                                          */
/* ================================================================== */

async function loadShortcuts() {
  const shortcuts = await db.getAll(db.STORES.SHORTCUTS);
  const container = document.getElementById('shortcutList');

  container.innerHTML = shortcuts
    .map(
      (sc) => `
    <div class="shortcut-row" data-id="${sc.id}">
      <input type="text" class="input-sm" value="${escapeAttr(sc.keyword)}"
             data-field="keyword" placeholder="keyword">
      <input type="text" class="input-sm input-wide" value="${escapeAttr(sc.urlTemplate)}"
             data-field="urlTemplate" placeholder="https://example.com/search?q=%s">
      <button class="btn-icon" title="Delete shortcut">✕</button>
    </div>`,
    )
    .join('');

  // Bind events per row
  container.querySelectorAll('.shortcut-row').forEach((row) => {
    const id = Number(row.dataset.id);

    // Auto‑save on change
    row.querySelectorAll('input').forEach((input) => {
      input.addEventListener(
        'change',
        async () => {
          const keyword = row
            .querySelector('[data-field="keyword"]')
            .value.trim();
          const urlTemplate = row
            .querySelector('[data-field="urlTemplate"]')
            .value.trim();
          if (keyword || urlTemplate) {
            await db.update(db.STORES.SHORTCUTS, { id, keyword, urlTemplate });
          }
        },
      );
    });

    // Delete
    row.querySelector('.btn-icon').addEventListener('click', async () => {
      await db.remove(db.STORES.SHORTCUTS, id);
      await loadShortcuts();
    });
  });
}

document.getElementById('addShortcutBtn').addEventListener('click', async () => {
  await db.add(db.STORES.SHORTCUTS, { keyword: '', urlTemplate: '' });
  await loadShortcuts();
  // Focus the last row's keyword input
  const rows = document.querySelectorAll('.shortcut-row');
  if (rows.length) {
    rows[rows.length - 1].querySelector('[data-field="keyword"]')?.focus();
  }
});

/* ================================================================== */
/*  Link Groups                                                        */
/* ================================================================== */

let selectedGroupId = null;

async function loadGroups() {
  const groups = await db.getAll(db.STORES.GROUPS);
  const list = document.getElementById('groupList');

  if (groups.length === 0) {
    list.innerHTML = '<li class="placeholder-text" style="padding:1rem 0;font-size:0.82rem">No groups yet</li>';
    return;
  }

  list.innerHTML = groups
    .map(
      (g) => `
    <li class="group-item ${g.id === selectedGroupId ? 'active' : ''}" data-id="${g.id}">
      <span class="group-name">${escapeHtml(g.name)}</span>
      <button class="btn-icon" title="Delete group">✕</button>
    </li>`,
    )
    .join('');

  // Bind events
  list.querySelectorAll('.group-item').forEach((item) => {
    const id = Number(item.dataset.id);

    // Select group
    item.querySelector('.group-name').addEventListener('click', () => {
      selectedGroupId = id;
      loadGroups();
      loadLinks(id);
    });

    // Delete group
    item.querySelector('.btn-icon').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this group and all its links?')) return;

      // Remove all links in this group
      const links = await db.getByIndex(db.STORES.LINKS, 'groupId', id);
      for (const link of links) {
        await db.remove(db.STORES.LINKS, link.id);
      }
      await db.remove(db.STORES.GROUPS, id);

      if (selectedGroupId === id) {
        selectedGroupId = null;
        loadLinks(null);
      }
      await loadGroups();
    });
  });
}

async function loadLinks(groupId) {
  const detail = document.getElementById('groupDetail');

  if (!groupId) {
    detail.innerHTML =
      '<p class="placeholder-text">Select a group to manage its links</p>';
    return;
  }

  const group = await db.getById(db.STORES.GROUPS, groupId);
  const links = await db.getByIndex(db.STORES.LINKS, 'groupId', groupId);

  detail.innerHTML = `
    <h3>${escapeHtml(group?.name || 'Group')}</h3>
    <div class="link-list" id="linkList">
      ${links
        .map(
          (l) => `
        <div class="link-row" data-id="${l.id}">
          <input type="text" class="input-sm" value="${escapeAttr(l.title)}"
                 data-field="title" placeholder="Title">
          <input type="text" class="input-sm input-wide" value="${escapeAttr(l.url)}"
                 data-field="url" placeholder="https://…">
          <button class="btn-icon" title="Delete link">✕</button>
        </div>`,
        )
        .join('')}
    </div>
    <button class="btn btn-accent btn-sm" id="addLinkBtn">+ Add Link</button>
  `;

  // Add link
  detail.querySelector('#addLinkBtn').addEventListener('click', async () => {
    await db.add(db.STORES.LINKS, {
      groupId,
      title: '',
      url: '',
      order: links.length,
    });
    await loadLinks(groupId);
    // Focus last row
    const rows = detail.querySelectorAll('.link-row');
    if (rows.length) {
      rows[rows.length - 1].querySelector('[data-field="title"]')?.focus();
    }
  });

  // Per‑row events
  detail.querySelectorAll('.link-row').forEach((row) => {
    const id = Number(row.dataset.id);

    row.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', async () => {
        const title = row.querySelector('[data-field="title"]').value.trim();
        const url = row.querySelector('[data-field="url"]').value.trim();
        await db.update(db.STORES.LINKS, { id, groupId, title, url });
      });
    });

    row.querySelector('.btn-icon').addEventListener('click', async () => {
      await db.remove(db.STORES.LINKS, id);
      await loadLinks(groupId);
    });
  });
}

document.getElementById('addGroupBtn').addEventListener('click', async () => {
  const name = prompt('Enter group name:');
  if (!name?.trim()) return;

  const groups = await db.getAll(db.STORES.GROUPS);
  const id = await db.add(db.STORES.GROUPS, {
    name: name.trim(),
    order: groups.length,
  });
  selectedGroupId = id;
  await loadGroups();
  await loadLinks(id);
});

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
    await loadShortcuts();
    selectedGroupId = null;
    await loadGroups();
    loadLinks(null);

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

async function init() {
  await db.initDefaults();
  await loadTheme();
  await initPersonalization();
  await loadShortcuts();
  await loadGroups();
}

init();
