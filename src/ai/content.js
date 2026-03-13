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
      flex-wrap: wrap;
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

    /* ── Result footer (copy button) ─────────────────────────────── */
    .nai-result-footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 7px;
      padding-top: 6px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    .nai-copy-btn {
      background: none;
      border: 1px solid rgba(99,102,241,0.35);
      border-radius: 6px;
      color: #a5b4fc;
      font: 11px/1 inherit;
      padding: 4px 9px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      pointer-events: auto;
    }
    .nai-copy-btn:hover { background: rgba(99,102,241,0.25); color: #e0e7ff; }
    .nai-copy-btn.copied { color: #4ade80; border-color: rgba(74,222,128,0.4); }

    /* ── Follow-up input ─────────────────────────────────────────── */
    .nai-followup {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      align-items: center;
    }
    .nai-followup-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 8px;
      color: #e2e8f0;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 6px 10px;
      outline: none;
      min-width: 0;
      pointer-events: auto;
    }
    .nai-followup-input:focus { border-color: rgba(99,102,241,0.7); }
    .nai-followup-input::placeholder { color: #475569; }
    .nai-followup-send {
      background: #6366f1;
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      line-height: 1;
      padding: 6px 10px;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
      pointer-events: auto;
    }
    .nai-followup-send:hover { background: #4f46e5; }
    .nai-followup-send:disabled { opacity: 0.45; cursor: not-allowed; }

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
    <div class="nai-actions"></div>
    <div class="nai-result">
      <div class="nai-loading">
        <div class="nai-spinner"></div>
        <span>正在思考…</span>
      </div>
      <div class="nai-result-text"></div>
      <div class="nai-result-footer" style="display:none">
        <button class="nai-copy-btn">📋 复制</button>
      </div>
    </div>
    <div class="nai-followup" style="display:none">
      <input type="text" class="nai-followup-input" placeholder="继续提问…">
      <button class="nai-followup-send" aria-label="发送">↑</button>
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
  /** Full conversation history for follow-up support */
  let conversationHistory = []; // { role, content }[]
  /** Custom prompt buttons loaded from settings */
  let customPrompts = []; // { name, prompt }[]

  /* ---------------------------------------------------------------- */
  /*  Load custom prompts from service worker                          */
  /* ---------------------------------------------------------------- */

  async function loadCustomPrompts() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'AI_GET_CUSTOM_PROMPTS' });
      customPrompts = res?.prompts ?? [];
    } catch (_) {
      customPrompts = [];
    }
  }

  /** Render action buttons (built-in + custom) into .nai-actions */
  function renderActionButtons() {
    const actionsEl = popup.querySelector('.nai-actions');
    actionsEl.innerHTML = '';

    const builtIn = [
      { action: 'translate', label: '🌐 翻译' },
      { action: 'explain',   label: '💡 解释' },
    ];

    builtIn.forEach(({ action, label }) => {
      const btn = document.createElement('button');
      btn.className = 'nai-action-btn';
      btn.dataset.action = action;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (isQuerying) return;
        runQuery({ action, btn });
      });
      actionsEl.appendChild(btn);
    });

    customPrompts.forEach(({ name, prompt }, i) => {
      const btn = document.createElement('button');
      btn.className = 'nai-action-btn';
      btn.dataset.action = 'custom';
      btn.textContent = name || `自定义${i + 1}`;
      btn.addEventListener('click', () => {
        if (isQuerying) return;
        runQuery({ action: 'custom', btn, customPrompt: prompt });
      });
      actionsEl.appendChild(btn);
    });
  }

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

  /** Copy button */
  popup.querySelector('.nai-copy-btn').addEventListener('click', () => {
    const text = popup.querySelector('.nai-result-text').textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = popup.querySelector('.nai-copy-btn');
      btn.textContent = '✓ 已复制';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋 复制';
        btn.classList.remove('copied');
      }, 1500);
    }).catch(() => {});
  });

  /** Follow-up: send on Enter key or send button click */
  const followupInput = popup.querySelector('.nai-followup-input');
  const followupSend  = popup.querySelector('.nai-followup-send');

  function submitFollowup() {
    const question = followupInput.value.trim();
    if (!question || isQuerying) return;
    followupInput.value = '';
    runFollowup(question);
  }

  followupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitFollowup();
    }
  });
  followupSend.addEventListener('click', submitFollowup);

  /* ---------------------------------------------------------------- */
  /*  Core: run AI query                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Run a built-in (translate/explain) or custom prompt query.
   * @param {{ action: string, btn: HTMLElement, customPrompt?: string }} opts
   */
  async function runQuery({ action, btn, customPrompt }) {
    isQuerying = true;

    const resultEl = popup.querySelector('.nai-result');
    const loadingEl = popup.querySelector('.nai-loading');
    const textEl = popup.querySelector('.nai-result-text');
    const footerEl = popup.querySelector('.nai-result-footer');
    const followupEl = popup.querySelector('.nai-followup');

    // UI: set active state & show loading
    popup.querySelectorAll('.nai-action-btn').forEach((b) => {
      b.classList.remove('active');
      b.disabled = true;
    });
    btn.classList.add('active');

    resultEl.style.display = 'block';
    loadingEl.style.display = 'flex';
    footerEl.style.display = 'none';
    followupEl.style.display = 'none';
    textEl.textContent = '';
    textEl.className = 'nai-result-text';

    adjustPopupPosition();

    try {
      let message;
      if (action === 'custom' && customPrompt) {
        // Build messages array locally for custom prompt
        const userContent = customPrompt.replace('{text}', currentText);
        const initMessages = [{ role: 'user', content: userContent }];
        message = { type: 'AI_QUERY', messages: initMessages };
        conversationHistory = [...initMessages];
      } else {
        // Built-in actions: service worker builds prompts
        message = { type: 'AI_QUERY', text: currentText, action };
        conversationHistory = [];
      }

      const res = await chrome.runtime.sendMessage(message);

      loadingEl.style.display = 'none';

      if (res?.error) {
        textEl.className = 'nai-result-text error';
        textEl.textContent = res.error;
        conversationHistory = [];
      } else {
        const result = res?.result ?? '';
        textEl.textContent = result;

        // Build history for follow-up (use prompts returned by service worker if available)
        if (action !== 'custom') {
          if (res.systemPrompt) conversationHistory = [{ role: 'system', content: res.systemPrompt }];
          if (res.userPrompt)   conversationHistory.push({ role: 'user', content: res.userPrompt });
        }
        conversationHistory.push({ role: 'assistant', content: result });

        footerEl.style.display = 'flex';
        followupEl.style.display = 'flex';
        popup.querySelector('.nai-followup-input').focus();
      }
    } catch (err) {
      loadingEl.style.display = 'none';
      textEl.className = 'nai-result-text error';
      conversationHistory = [];
      if (err.message?.includes('Extension context invalidated')) {
        textEl.textContent = '请刷新页面后重试。';
      } else {
        textEl.textContent = '错误: ' + (err.message || String(err));
      }
    } finally {
      isQuerying = false;
      popup.querySelectorAll('.nai-action-btn').forEach((b) => (b.disabled = false));
      adjustPopupPosition();
    }
  }

  /**
   * Send a follow-up question using the existing conversation history.
   * @param {string} question
   */
  async function runFollowup(question) {
    if (!conversationHistory.length) return;
    isQuerying = true;

    const resultEl = popup.querySelector('.nai-result');
    const loadingEl = popup.querySelector('.nai-loading');
    const textEl = popup.querySelector('.nai-result-text');
    const footerEl = popup.querySelector('.nai-result-footer');
    const followupSendBtn = popup.querySelector('.nai-followup-send');

    loadingEl.style.display = 'flex';
    footerEl.style.display = 'none';
    textEl.textContent = '';
    textEl.className = 'nai-result-text';
    resultEl.style.display = 'block';
    followupSendBtn.disabled = true;
    popup.querySelectorAll('.nai-action-btn').forEach((b) => (b.disabled = true));

    // Extend history with user follow-up
    conversationHistory.push({ role: 'user', content: question });

    adjustPopupPosition();

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'AI_QUERY',
        messages: conversationHistory,
      });

      loadingEl.style.display = 'none';

      if (res?.error) {
        textEl.className = 'nai-result-text error';
        textEl.textContent = res.error;
        // Roll back the failed user message
        conversationHistory.pop();
      } else {
        const result = res?.result ?? '';
        textEl.textContent = result;
        conversationHistory.push({ role: 'assistant', content: result });
        footerEl.style.display = 'flex';
      }
    } catch (err) {
      loadingEl.style.display = 'none';
      textEl.className = 'nai-result-text error';
      conversationHistory.pop();
      if (err.message?.includes('Extension context invalidated')) {
        textEl.textContent = '请刷新页面后重试。';
      } else {
        textEl.textContent = '错误: ' + (err.message || String(err));
      }
    } finally {
      isQuerying = false;
      followupSendBtn.disabled = false;
      popup.querySelectorAll('.nai-action-btn').forEach((b) => (b.disabled = false));
      adjustPopupPosition();
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

    // Reset conversation
    conversationHistory = [];

    // Re-render action buttons (picks up latest custom prompts)
    renderActionButtons();

    // Reset result visibility
    popup.querySelector('.nai-result').style.display = 'none';
    popup.querySelector('.nai-result-text').textContent = '';
    popup.querySelector('.nai-result-footer').style.display = 'none';
    popup.querySelector('.nai-followup').style.display = 'none';
    popup.querySelector('.nai-followup-input').value = '';
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
    conversationHistory = [];
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // Initial load: fetch custom prompts so first popup open is fast
  loadCustomPrompts();
})();
