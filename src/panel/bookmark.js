/**
 * Naviky – Bookmark dialog (content script)
 *
 * Injected when user right-clicks → "Naviky – Save to Links".
 * Shows a small dialog to pick or create a group, then saves
 * the current page as a link.
 */
(function () {
  'use strict';

  const HOST_ID = 'naviky-bookmark-host';

  /* ── Remove if already open ───────────────────────────────────── */
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  /* ── Create host & shadow root ────────────────────────────────── */
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all:initial !important;position:fixed !important;top:0 !important;left:0 !important;' +
    'width:100vw !important;height:100vh !important;z-index:2147483647 !important;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  /* ── Load shared panel CSS ────────────────────────────────────── */
  const cssUrl = chrome.runtime.getURL('src/panel/panel.css');
  fetch(cssUrl)
    .then((r) => r.text())
    .then((cssText) => {
      const style = document.createElement('style');
      style.textContent = cssText;
      shadow.insertBefore(style, shadow.firstChild);
    })
    .catch((err) => console.warn('[Naviky] CSS load failed:', err));

  /* ── State ─────────────────────────────────────────────────────── */
  let allGroups = [];
  let filteredGroups = [];
  let activeIdx = -1;

  /* ── Build UI ─────────────────────────────────────────────────── */
  const overlay = document.createElement('div');
  overlay.className = 'nk-overlay';

  const container = document.createElement('div');
  container.className = 'nk-container nk-bookmark-container';

  // Header
  const header = document.createElement('div');
  header.className = 'nk-bm-header';
  header.innerHTML =
    '<span class="nk-bm-icon">⭐</span>' +
    '<span class="nk-bm-title">Save to Links</span>';

  // Page info
  const pageInfo = document.createElement('div');
  pageInfo.className = 'nk-bm-page-info';
  pageInfo.innerHTML =
    `<div class="nk-title">${escapeHtml(document.title)}</div>` +
    `<div class="nk-url">${escapeHtml(location.href)}</div>`;

  // Group input
  const groupLabel = document.createElement('div');
  groupLabel.className = 'nk-bm-label';
  groupLabel.textContent = 'Group';

  const groupInput = document.createElement('input');
  groupInput.type = 'text';
  groupInput.className = 'nk-input nk-bm-input';
  groupInput.placeholder = 'Type to search or create a group…';
  groupInput.setAttribute('autocomplete', 'off');
  groupInput.setAttribute('spellcheck', 'false');

  // Suggestions dropdown
  const suggestions = document.createElement('ul');
  suggestions.className = 'nk-results nk-bm-suggestions';

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'nk-bm-save';
  saveBtn.textContent = 'Save';

  // Status message
  const status = document.createElement('div');
  status.className = 'nk-bm-status';

  container.appendChild(header);
  container.appendChild(pageInfo);
  container.appendChild(groupLabel);
  container.appendChild(groupInput);
  container.appendChild(suggestions);
  container.appendChild(saveBtn);
  container.appendChild(status);
  overlay.appendChild(container);
  shadow.appendChild(overlay);

  requestAnimationFrame(() => groupInput.focus());

  /* ── Helpers ────────────────────────────────────────────────────── */
  function escapeHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function closeDialog() {
    host.remove();
  }

  /* ── Load groups from DB ────────────────────────────────────────── */
  chrome.runtime.sendMessage({ type: 'GET_GROUPS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[Naviky]', chrome.runtime.lastError.message);
      return;
    }
    if (Array.isArray(response)) {
      allGroups = response;
    }
  });

  /* ── Group search / filter ──────────────────────────────────────── */
  groupInput.addEventListener('input', () => {
    const query = groupInput.value.trim().toLowerCase();
    if (!query) {
      renderSuggestions([]);
      return;
    }
    filteredGroups = allGroups.filter((g) =>
      g.name.toLowerCase().includes(query),
    );

    // If no exact match, show "new group" option
    const exactMatch = allGroups.some(
      (g) => g.name.toLowerCase() === query,
    );
    renderSuggestions(filteredGroups, exactMatch ? null : query);
  });

  function renderSuggestions(groups, newGroupName) {
    activeIdx = -1;
    suggestions.innerHTML = '';

    if (!groups.length && !newGroupName) {
      suggestions.classList.remove('visible');
      return;
    }

    groups.forEach((g, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      li.innerHTML =
        `<span class="nk-icon">📁</span>` +
        `<div class="nk-info"><div class="nk-title">${escapeHtml(g.name)}</div></div>` +
        `<span class="nk-badge">group</span>`;
      li.addEventListener('click', () => pickGroup(g));
      suggestions.appendChild(li);
    });

    if (newGroupName) {
      const li = document.createElement('li');
      li.dataset.index = groups.length;
      li.classList.add('nk-bm-new');
      li.innerHTML =
        `<span class="nk-icon">➕</span>` +
        `<div class="nk-info"><div class="nk-title">Create "<strong>${escapeHtml(newGroupName)}</strong>"</div></div>` +
        `<span class="nk-badge">new</span>`;
      li.addEventListener('click', () => createAndPick(newGroupName));
      suggestions.appendChild(li);
    }

    suggestions.classList.add('visible');
  }

  function pickGroup(group) {
    groupInput.value = group.name;
    groupInput.dataset.groupId = group.id;
    suggestions.innerHTML = '';
    suggestions.classList.remove('visible');
    activeIdx = -1;
  }

  function createAndPick(name) {
    chrome.runtime.sendMessage(
      { type: 'ADD_GROUP', name, order: allGroups.length },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to create group', true);
          return;
        }
        const newGroup = { id: response.id, name };
        allGroups.push(newGroup);
        pickGroup(newGroup);
      },
    );
  }

  /* ── Keyboard navigation in suggestions ─────────────────────────── */
  groupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
      return;
    }

    const items = suggestions.querySelectorAll('li');
    const total = items.length;

    if (e.key === 'ArrowDown' && total) {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, total - 1);
      updateActiveSuggestion(items);
    } else if (e.key === 'ArrowUp' && total) {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, -1);
      updateActiveSuggestion(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < total) {
        items[activeIdx].click();
      } else if (groupInput.dataset.groupId) {
        save();
      } else {
        // auto‑select or create
        const query = groupInput.value.trim();
        if (!query) return;
        const match = allGroups.find(
          (g) => g.name.toLowerCase() === query.toLowerCase(),
        );
        if (match) {
          pickGroup(match);
          save();
        } else {
          // create group then save
          chrome.runtime.sendMessage(
            { type: 'ADD_GROUP', name: query, order: allGroups.length },
            (response) => {
              if (chrome.runtime.lastError) {
                showStatus('Failed to create group', true);
                return;
              }
              const newGroup = { id: response.id, name: query };
              allGroups.push(newGroup);
              pickGroup(newGroup);
              save();
            },
          );
        }
      }
    }
  });

  function updateActiveSuggestion(items) {
    items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    if (activeIdx >= 0 && items[activeIdx]) {
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  /* ── Save ────────────────────────────────────────────────────────── */
  saveBtn.addEventListener('click', () => {
    const query = groupInput.value.trim();
    if (!query) {
      showStatus('Please enter a group name', true);
      return;
    }

    if (groupInput.dataset.groupId) {
      save();
    } else {
      const match = allGroups.find(
        (g) => g.name.toLowerCase() === query.toLowerCase(),
      );
      if (match) {
        pickGroup(match);
        save();
      } else {
        chrome.runtime.sendMessage(
          { type: 'ADD_GROUP', name: query, order: allGroups.length },
          (response) => {
            if (chrome.runtime.lastError) {
              showStatus('Failed to create group', true);
              return;
            }
            const newGroup = { id: response.id, name: query };
            allGroups.push(newGroup);
            pickGroup(newGroup);
            save();
          },
        );
      }
    }
  });

  function save() {
    const groupId = Number(groupInput.dataset.groupId);
    if (!groupId) {
      showStatus('Please select a group first', true);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'ADD_LINK',
        groupId,
        title: document.title || location.href,
        url: location.href,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to save link', true);
          return;
        }
        showStatus('Saved!', false);
        setTimeout(closeDialog, 600);
      },
    );
  }

  function showStatus(text, isError) {
    status.textContent = text;
    status.className = 'nk-bm-status ' + (isError ? 'error' : 'success');
    status.style.display = 'block';
  }

  /* ── Close on overlay click / Escape ─────────────────────────────── */
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById(HOST_ID)) {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  }, true);
})();
