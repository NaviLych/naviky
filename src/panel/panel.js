/**
 * Naviky – Global search panel (content script)
 *
 * Injected into the active tab via chrome.scripting.executeScript
 * when the user presses Ctrl+Q.
 *
 * • Uses Shadow DOM (open) for style isolation.
 * • Loads its own CSS from the extension via web_accessible_resources.
 * • Communicates with the service worker via chrome.runtime.sendMessage
 *   for search, navigation, and tab switching.
 * • Idempotent: re‑executing this script toggles the panel.
 */
(function () {
  'use strict';

  const HOST_ID = 'naviky-panel-host';

  /* ── Toggle if panel already exists ────────────────────────────── */
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    const hidden = existing.style.display === 'none';
    existing.style.display = hidden ? 'block' : 'none';
    if (hidden) {
      const input = existing.shadowRoot?.querySelector('.nk-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
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

  /* ── Load styles into shadow DOM ──────────────────────────────── */
  const cssUrl = chrome.runtime.getURL('src/panel/panel.css');
  fetch(cssUrl)
    .then((r) => r.text())
    .then((cssText) => {
      const style = document.createElement('style');
      style.textContent = cssText;
      shadow.insertBefore(style, shadow.firstChild);
    })
    .catch((err) => console.warn('[Naviky] CSS load failed:', err));

  /* ── Build UI ─────────────────────────────────────────────────── */
  const overlay = document.createElement('div');
  overlay.className = 'nk-overlay';

  const container = document.createElement('div');
  container.className = 'nk-container';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nk-input';
  input.placeholder = 'Search tabs, history, links, or the web…';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const resultsList = document.createElement('ul');
  resultsList.className = 'nk-results';

  container.appendChild(input);
  container.appendChild(resultsList);
  overlay.appendChild(container);
  shadow.appendChild(overlay);

  // Focus after a tick so the DOM is settled
  requestAnimationFrame(() => input.focus());

  /* ── State ─────────────────────────────────────────────────────── */
  let results = [];
  let activeIdx = -1;
  let searchTimer = null;

  /* ── Helpers ────────────────────────────────────────────────────── */
  function escapeHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function closePanel() {
    host.style.display = 'none';
    results = [];
    activeIdx = -1;
    resultsList.innerHTML = '';
    resultsList.classList.remove('visible');
    container.classList.remove('has-results');
    input.value = '';
  }

  /* ── Search ─────────────────────────────────────────────────────── */
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = input.value;
    if (!query.trim()) {
      renderResults([]);
      return;
    }
    searchTimer = setTimeout(() => {
      chrome.runtime.sendMessage(
        { type: 'SEARCH', query },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[Naviky]', chrome.runtime.lastError.message);
            return;
          }
          if (Array.isArray(response)) {
            renderResults(response);
          }
        },
      );
    }, 150);
  });

  function renderResults(newResults) {
    results = newResults;
    activeIdx = -1;
    resultsList.innerHTML = '';

    if (!results.length) {
      resultsList.classList.remove('visible');
      container.classList.remove('has-results');
      return;
    }

    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.dataset.index = i;
      if (r.type === 'shortcut-hint') li.classList.add('hint');

      li.innerHTML = `
        <span class="nk-icon">${r.icon}</span>
        <div class="nk-info">
          <div class="nk-title">${escapeHtml(r.title)}</div>
          <div class="nk-url">${escapeHtml(r.url || r.description)}</div>
        </div>
        <span class="nk-badge">${r.type.replace('-hint', '')}</span>
      `;

      li.addEventListener('click', () => selectResult(r));
      resultsList.appendChild(li);
    });

    resultsList.classList.add('visible');
    container.classList.add('has-results');
  }

  /* ── Result selection ────────────────────────────────────────────── */
  function selectResult(result) {
    if (!result || !result.url) return;

    if (result.type === 'tab') {
      chrome.runtime.sendMessage({
        type: 'SWITCH_TAB',
        tabId: result.tabId,
        windowId: result.windowId,
      });
    } else {
      chrome.runtime.sendMessage({ type: 'OPEN_URL', url: result.url });
    }
    closePanel();
  }

  /* ── Keyboard navigation ─────────────────────────────────────────── */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
      return;
    }

    if (!results.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, results.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, -1);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0) {
        selectResult(results[activeIdx]);
      } else {
        const first = results.find((r) => r.type !== 'shortcut-hint');
        if (first) selectResult(first);
      }
    }
  });

  function updateActive() {
    const items = resultsList.querySelectorAll('li');
    items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    if (activeIdx >= 0 && items[activeIdx]) {
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  /* ── Close on overlay click ──────────────────────────────────────── */
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePanel();
  });

  /* ── Close on Escape anywhere on the page ─────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && host.style.display !== 'none') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }
  }, true);
})();
