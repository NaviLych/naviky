/**
 * Naviky – Manage page logic
 *
 * Waterfall / masonry layout for managing link groups and shortcuts.
 * All data is stored in IndexedDB via the shared db module.
 */

import { db } from '../shared/db.js';
import { loadTheme } from '../shared/theme.js';

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function escapeAttr(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ */
/*  DOM references                                                     */
/* ------------------------------------------------------------------ */

const masonry = document.getElementById('masonry');

/* ------------------------------------------------------------------ */
/*  Render                                                             */
/* ------------------------------------------------------------------ */

async function render() {
  const [groups, allLinks, shortcuts] = await Promise.all([
    db.getAll(db.STORES.GROUPS),
    db.getAll(db.STORES.LINKS),
    db.getAll(db.STORES.SHORTCUTS),
  ]);

  // Build group → links map
  const linksByGroup = {};
  for (const link of allLinks) {
    if (!linksByGroup[link.groupId]) linksByGroup[link.groupId] = [];
    linksByGroup[link.groupId].push(link);
  }

  let html = '';

  // Shortcuts card
  html += `
  <div class="masonry-card" data-type="shortcuts">
    <div class="card-header">
      <span class="card-header-icon">⚡</span>
      <span class="card-header-title">Shortcuts</span>
    </div>
    <div class="card-links">
      ${shortcuts.map(sc => `
        <div class="link-row shortcut-row" data-id="${sc.id}">
          <input type="text" class="input-sm kw-input" value="${escapeAttr(sc.keyword)}"
            data-field="keyword" placeholder="keyword">
          <input type="text" class="input-sm link-url-input" value="${escapeAttr(sc.urlTemplate)}"
            data-field="urlTemplate" placeholder="https://...?q=%s">
          <button class="btn-icon" data-action="delete-shortcut" title="Delete">✕</button>
        </div>
      `).join('')}
      ${shortcuts.length === 0 ? '<p class="empty-text">No shortcuts yet</p>' : ''}
    </div>
    <button class="btn btn-sm btn-accent" data-action="add-shortcut-inline">+ Add</button>
  </div>`;

  // Group cards
  for (const group of groups) {
    const links = linksByGroup[group.id] || [];
    html += `
    <div class="masonry-card" data-type="group" data-group-id="${group.id}">
      <div class="card-header">
        <span class="card-header-icon">📁</span>
        <input type="text" class="group-name-input" value="${escapeAttr(group.name)}"
          data-action="rename-group" data-group-id="${group.id}" placeholder="Group name">
        <button class="btn-icon" data-action="delete-group" data-group-id="${group.id}" title="Delete group">✕</button>
      </div>
      <div class="card-links">
        ${links.map(l => `
          <div class="link-row" data-id="${l.id}" data-group-id="${group.id}">
            <input type="text" class="input-sm link-title-input" value="${escapeAttr(l.title)}"
              data-field="title" placeholder="Title">
            <input type="text" class="input-sm link-url-input" value="${escapeAttr(l.url)}"
              data-field="url" placeholder="https://…">
            <button class="btn-icon" data-action="delete-link" title="Delete">✕</button>
          </div>
        `).join('')}
        ${links.length === 0 ? '<p class="empty-text">No links yet</p>' : ''}
      </div>
      <button class="btn btn-sm btn-accent" data-action="add-link" data-group-id="${group.id}">+ Add Link</button>
    </div>`;
  }

  if (groups.length === 0 && shortcuts.length === 0) {
    html += '<p class="empty-text" style="padding:3rem">No groups or shortcuts yet. Use the buttons above to get started.</p>';
  }

  masonry.innerHTML = html;
  bindEvents();
}

/* ------------------------------------------------------------------ */
/*  Event binding                                                      */
/* ------------------------------------------------------------------ */

function bindEvents() {
  // Group name rename
  masonry.querySelectorAll('[data-action="rename-group"]').forEach(input => {
    input.addEventListener('change', async () => {
      const groupId = Number(input.dataset.groupId);
      const group = await db.getById(db.STORES.GROUPS, groupId);
      if (group) {
        group.name = input.value.trim() || group.name;
        await db.update(db.STORES.GROUPS, group);
      }
    });
  });

  // Delete group
  masonry.querySelectorAll('[data-action="delete-group"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const groupId = Number(btn.dataset.groupId);
      if (!confirm('Delete this group and all its links?')) return;
      const links = await db.getByIndex(db.STORES.LINKS, 'groupId', groupId);
      for (const link of links) await db.remove(db.STORES.LINKS, link.id);
      await db.remove(db.STORES.GROUPS, groupId);
      await render();
    });
  });

  // Add link to group
  masonry.querySelectorAll('[data-action="add-link"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const groupId = Number(btn.dataset.groupId);
      const links = await db.getByIndex(db.STORES.LINKS, 'groupId', groupId);
      await db.add(db.STORES.LINKS, { groupId, title: '', url: '', order: links.length });
      await render();
      const card = masonry.querySelector(`[data-type="group"][data-group-id="${groupId}"]`);
      if (card) {
        const rows = card.querySelectorAll('.link-row');
        if (rows.length) rows[rows.length - 1].querySelector('.link-title-input')?.focus();
      }
    });
  });

  // Link field changes
  masonry.querySelectorAll('.link-row[data-group-id] input').forEach(input => {
    input.addEventListener('change', async () => {
      const row = input.closest('.link-row');
      const id = Number(row.dataset.id);
      const groupId = Number(row.dataset.groupId);
      const title = row.querySelector('[data-field="title"]').value.trim();
      const url = row.querySelector('[data-field="url"]').value.trim();
      await db.update(db.STORES.LINKS, { id, groupId, title, url });
    });
  });

  // Delete link
  masonry.querySelectorAll('[data-action="delete-link"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.link-row');
      const id = Number(row.dataset.id);
      await db.remove(db.STORES.LINKS, id);
      await render();
    });
  });

  // Shortcut field changes
  masonry.querySelectorAll('.shortcut-row input').forEach(input => {
    input.addEventListener('change', async () => {
      const row = input.closest('.shortcut-row');
      const id = Number(row.dataset.id);
      const keyword = row.querySelector('[data-field="keyword"]').value.trim();
      const urlTemplate = row.querySelector('[data-field="urlTemplate"]').value.trim();
      if (keyword || urlTemplate) {
        await db.update(db.STORES.SHORTCUTS, { id, keyword, urlTemplate });
      }
    });
  });

  // Delete shortcut
  masonry.querySelectorAll('[data-action="delete-shortcut"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.shortcut-row');
      const id = Number(row.dataset.id);
      await db.remove(db.STORES.SHORTCUTS, id);
      await render();
    });
  });

  // Add shortcut inline
  masonry.querySelectorAll('[data-action="add-shortcut-inline"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await db.add(db.STORES.SHORTCUTS, { keyword: '', urlTemplate: '' });
      await render();
      const card = masonry.querySelector('[data-type="shortcuts"]');
      if (card) {
        const rows = card.querySelectorAll('.shortcut-row');
        if (rows.length) rows[rows.length - 1].querySelector('.kw-input')?.focus();
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Header buttons                                                     */
/* ------------------------------------------------------------------ */

document.getElementById('backBtn').addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = chrome.runtime.getURL('src/newtab/newtab.html');
});

document.getElementById('addGroupBtn').addEventListener('click', async () => {
  const name = prompt('Enter group name:');
  if (!name?.trim()) return;
  const groups = await db.getAll(db.STORES.GROUPS);
  await db.add(db.STORES.GROUPS, { name: name.trim(), order: groups.length });
  await render();
});

document.getElementById('addShortcutBtn').addEventListener('click', async () => {
  await db.add(db.STORES.SHORTCUTS, { keyword: '', urlTemplate: '' });
  await render();
  const card = masonry.querySelector('[data-type="shortcuts"]');
  if (card) {
    const rows = card.querySelectorAll('.shortcut-row');
    if (rows.length) rows[rows.length - 1].querySelector('.kw-input')?.focus();
  }
});

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  await db.initDefaults();
  await loadTheme();
  await render();
}

init();
