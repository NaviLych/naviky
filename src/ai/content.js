/**
 * Naviky – AI assistant content script
 *
 * Injected into every page. Listens for text selections and shows
 * a floating action button → popup that translates or explains the
 * selected text via the user-configured OpenAI-compatible API.
 *
 * Uses Shadow DOM for full style isolation from the host page.
 */
(function () {
  'use strict';

  // Guard against double-injection
  if (window.__naviky_ai_v1__) return;
  window.__naviky_ai_v1__ = true;

  /* ---------------------------------------------------------------- */
  /*  Shadow-DOM styles                                                */
  /* ---------------------------------------------------------------- */

  const STYLES = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Floating action button ─────────────────────────────────── */
    .nai-fab {
      position: fixed;
      display: none;
      align-items: center;
      gap: 4px;
      padding: 5px 11px;
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 20px;
      font: 600 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 14px rgba(0,0,0,0.4);
      pointer-events: auto;
      white-space: nowrap;
      user-select: none;
      transition: background 0.15s, transform 0.15s;
      z-index: 1;
      animation: nai-pop 0.15s ease-out;
    }
    .nai-fab:hover { background: #4f46e5; transform: translateY(-1px); }

    @keyframes nai-pop {
      from { opacity: 0; transform: translateY(4px) scale(0.95); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── Popup ───────────────────────────────────────────────────── */
    .nai-popup {
      position: fixed;
      width: 300px;
      background: rgba(15, 15, 28, 0.93);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.55);
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e8f0;
      font-size: 13px;
      display: none;
      animation: nai-slide 0.18s ease-out;
      z-index: 1;
    }
    @keyframes nai-slide {
      from { opacity: 0; transform: translateY(-8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── Preview text ────────────────────────────────────────────── */
    .nai-preview {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Action buttons ──────────────────────────────────────────── */
    .nai-actions {
      display: flex;
      gap: 7px;
      margin-bottom: 10px;
    }
    .nai-action-btn {
      flex: 1;
      padding: 7px 0;
      background: rgba(99,102,241,0.18);
      color: #a5b4fc;
      border: 1px solid rgba(99,102,241,0.35);
      border-radius: 8px;
      font: 500 12px/1 inherit;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      pointer-events: auto;
    }
    .nai-action-btn:hover { background: rgba(99,102,241,0.4); color: #e0e7ff; }
    .nai-action-btn.active { background: #6366f1; color: #fff; border-color: transparent; }
    .nai-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Result area ─────────────────────────────────────────────── */
    .nai-result {
      display: none;
      background: rgba(255,255,255,0.04);
      border-radius: 9px;
      padding: 10px;
      max-height: 220px;
      overflow-y: auto;
    }
    .nai-result::-webkit-scrollbar { width: 4px; }
    .nai-result::-webkit-scrollbar-track { background: transparent; }
    .nai-result::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

    /* ── Loading ─────────────────────────────────────────────────── */
    .nai-loading {
      display: none;
      align-items: center;
      gap: 8px;
      color: #94a3b8;
      font-size: 12px;
    }
    .nai-spinner {
      width: 14px; height: 14px; flex-shrink: 0;
      border: 2px solid rgba(99,102,241,0.25);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: nai-spin 0.7s linear infinite;
    }
    @keyframes nai-spin { to { transform: rotate(360deg); } }

    /* ── Result text ─────────────────────────────────────────────── */
    .nai-result-text {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.55;
      color: #cbd5e1;
    }
    .nai-result-text.error { color: #f87171; }

    /* ── Close button ────────────────────────────────────────────── */
    .nai-close {
      position: absolute;
      top: 10px; right: 10px;
      background: none;
      border: none;
      color: #475569;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      padding: 3px 5px;
      border-radius: 5px;
      pointer-events: auto;
      transition: background 0.15s, color 0.15s;
    }
    .nai-close:hover { background: rgba(255,255,255,0.08); color: #94a3b8; }
  `;

  /* ---------------------------------------------------------------- */
  /*  Build shadow DOM                                                 */
  /* ---------------------------------------------------------------- */

  const host = document.createElement('div');
  host.id = 'naviky-ai-root';
  // Zero-size fixed host; children use position:fixed and overflow outside
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    overflow: 'visible',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });
  (document.documentElement || document.body).appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  shadow.appendChild(styleEl);

  /* ── Floating action button ────────────────────────────────────── */
  const fab = document.createElement('button');
  fab.className = 'nai-fab';
  fab.setAttribute('aria-label', 'Naviky AI');
  fab.innerHTML = '✦&nbsp;AI';
  shadow.appendChild(fab);

  /* ── Popup ─────────────────────────────────────────────────────── */
  const popup = document.createElement('div');
  popup.className = 'nai-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.innerHTML = `
    <button class="nai-close" aria-label="Close">✕</button>
    <div class="nai-preview"></div>
    <div class="nai-actions">
      <button class="nai-action-btn" data-action="translate">🌐 翻译</button>
      <button class="nai-action-btn" data-action="explain">💡 解释</button>
    </div>
    <div class="nai-result">
      <div class="nai-loading">
        <div class="nai-spinner"></div>
        <span>正在思考…</span>
      </div>
      <div class="nai-result-text"></div>
    </div>
  `;
  shadow.appendChild(popup);

  /* ---------------------------------------------------------------- */
  /*  State                                                            */
  /* ---------------------------------------------------------------- */

  let currentText = '';
  let fabAnchorX = 0;
  let fabAnchorY = 0; // viewport Y of the top of the selection
  let isQuerying = false;

  /* ---------------------------------------------------------------- */
  /*  Event listeners                                                  */
  /* ---------------------------------------------------------------- */

  /** Show FAB whenever the user finishes a non-trivial selection */
  document.addEventListener('mouseup', (e) => {
    // Ignore interactions inside our own UI
    if (e.composedPath().includes(host)) return;

    const sel = window.getSelection();
    const text = sel?.toString().trim();

    if (!text || text.length < 2) {
      hideFab();
      return;
    }

    currentText = text;

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      fabAnchorX = rect.left + rect.width / 2;
      fabAnchorY = rect.top; // viewport-relative top of the selection
      showFab();
    } catch (_) {
      hideFab();
    }
  });

  /** Click outside our UI → hide everything */
  document.addEventListener('mousedown', (e) => {
    if (!e.composedPath().includes(host)) {
      hideFab();
      hidePopup();
    }
  });

  /** FAB click → open popup */
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    showPopup();
    hideFab();
  });

  /** Close button */
  popup.querySelector('.nai-close').addEventListener('click', hidePopup);

  /** Action buttons (translate / explain) */
  popup.querySelectorAll('.nai-action-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (isQuerying) return;
      const action = btn.dataset.action;
      await runQuery(action, btn);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Core: run AI query                                               */
  /* ---------------------------------------------------------------- */

  async function runQuery(action, activeBtn) {
    isQuerying = true;

    const resultEl = popup.querySelector('.nai-result');
    const loadingEl = popup.querySelector('.nai-loading');
    const textEl = popup.querySelector('.nai-result-text');

    // UI: set active state & show loading
    popup.querySelectorAll('.nai-action-btn').forEach((b) => {
      b.classList.remove('active');
      b.disabled = true;
    });
    activeBtn.classList.add('active');

    resultEl.style.display = 'block';
    loadingEl.style.display = 'flex';
    textEl.textContent = '';
    textEl.className = 'nai-result-text';

    // Resize popup to fit loading state
    adjustPopupPosition();

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AI_QUERY',
        text: currentText,
        action,
      });

      loadingEl.style.display = 'none';

      if (res?.error) {
        textEl.className = 'nai-result-text error';
        textEl.textContent = res.error;
      } else {
        textEl.textContent = res?.result ?? '';
      }
    } catch (err) {
      loadingEl.style.display = 'none';
      textEl.className = 'nai-result-text error';
      // Extension context invalidated on page navigate — give a useful message
      if (err.message?.includes('Extension context invalidated')) {
        textEl.textContent = '请刷新页面后重试。';
      } else {
        textEl.textContent = '错误: ' + (err.message || String(err));
      }
    } finally {
      isQuerying = false;
      popup.querySelectorAll('.nai-action-btn').forEach((b) => (b.disabled = false));
    }
  }

  /* ---------------------------------------------------------------- */
  /*  UI helpers                                                       */
  /* ---------------------------------------------------------------- */

  function showFab() {
    const vw = window.innerWidth;
    const fabW = 68;
    const fabH = 30;
    const margin = 6;

    const fx = clamp(fabAnchorX - fabW / 2, margin, vw - fabW - margin);
    // Place above the selection; fall back to below if too close to top
    const fy = fabAnchorY - fabH - 8 < margin
      ? fabAnchorY + 8
      : fabAnchorY - fabH - 8;

    fab.style.left = fx + 'px';
    fab.style.top = fy + 'px';
    fab.style.display = 'flex';
  }

  function hideFab() {
    fab.style.display = 'none';
  }

  function showPopup() {
    // Fill preview
    const previewEl = popup.querySelector('.nai-preview');
    const preview = currentText.length > 80
      ? currentText.slice(0, 77) + '…'
      : currentText;
    previewEl.textContent = `"${preview}"`;

    // Reset result visibility
    popup.querySelector('.nai-result').style.display = 'none';
    popup.querySelector('.nai-result-text').textContent = '';
    popup.querySelectorAll('.nai-action-btn').forEach((b) => {
      b.classList.remove('active');
      b.disabled = false;
    });

    popup.style.display = 'block';
    adjustPopupPosition();
  }

  function adjustPopupPosition() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = 300;
    // Estimate current popup height
    const ph = popup.offsetHeight || 130;
    const margin = 10;

    const px = clamp(fabAnchorX - pw / 2, margin, vw - pw - margin);
    // Try above the selection anchor first
    let py = fabAnchorY - ph - 12;
    if (py < margin) py = fabAnchorY + 20; // fall back to below

    popup.style.left = px + 'px';
    popup.style.top = clamp(py, margin, vh - ph - margin) + 'px';
  }

  function hidePopup() {
    popup.style.display = 'none';
    isQuerying = false;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }
})();
