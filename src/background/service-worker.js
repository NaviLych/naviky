/**
 * Naviky – background service worker (MV3)
 *
 * Responsibilities:
 *  1. Seed default data on install
 *  2. Listen for Ctrl+Q command → inject search panel into active tab
 *  3. Act as message hub: proxy search / navigation requests from the
 *     injected panel (content script) which cannot access chrome.tabs,
 *     chrome.history, or the extension's IndexedDB directly.
 */

import { db } from '../shared/db.js';
import { searchAll } from '../shared/search.js';
import { MSG } from '../shared/messages.js';

/* ------------------------------------------------------------------ */
/*  Install / update – seed defaults                                   */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(async () => {
  await db.initDefaults();

  /* ── Context menu: Bookmark this page ─────────────────────────── */
  chrome.contextMenus.create({
    id: 'naviky-bookmark-page',
    title: 'Naviky – Save to Links',
    contexts: ['page'],
  });
});

/* ------------------------------------------------------------------ */
/*  Command listener – toggle search panel (Ctrl+Q)                    */
/* ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-search-panel') return;
  if (!tab?.id) return;

  // Cannot inject into privileged pages
  const url = tab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:')
  ) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/panel/panel.js'],
    });
  } catch (err) {
    console.error('[Naviky] panel injection failed:', err);
  }
});

/* ------------------------------------------------------------------ */
/*  Context menu click → inject bookmark dialog                        */
/* ------------------------------------------------------------------ */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'naviky-bookmark-page') return;
  if (!tab?.id) return;

  const url = tab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:')
  ) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/panel/bookmark.js'],
    });
  } catch (err) {
    console.error('[Naviky] bookmark dialog injection failed:', err);
  }
});

/* ------------------------------------------------------------------ */
/*  Search providers (used by the message handler below)               */
/* ------------------------------------------------------------------ */

const searchProviders = {
  getShortcuts: () => db.getAll(db.STORES.SHORTCUTS),
  searchTabs: () => chrome.tabs.query({}),
  searchHistory: (query) =>
    chrome.history.search({ text: query, maxResults: 10 }),
  getLinks: () => db.getAll(db.STORES.LINKS),
  getGroups: () => db.getAll(db.STORES.GROUPS),
};

/* ------------------------------------------------------------------ */
/*  Message handler                                                    */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Naviky] message handler error:', err);
      sendResponse({ error: err.message });
    });
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case MSG.SEARCH:
      return searchAll(message.query, searchProviders);

    case MSG.OPEN_URL:
      if (sender.tab?.id) {
        await chrome.tabs.update(sender.tab.id, { url: message.url });
      }
      return { ok: true };

    case MSG.SWITCH_TAB:
      await chrome.tabs.update(message.tabId, { active: true });
      if (message.windowId) {
        await chrome.windows.update(message.windowId, { focused: true });
      }
      return { ok: true };

    case MSG.GET_SETTINGS: {
      const greeting = await db.getSetting('greeting');
      const userName = await db.getSetting('userName');
      const theme = await db.getSetting('theme');
      return { greeting, userName, theme };
    }

    case MSG.GET_GROUPS:
      return db.getAll(db.STORES.GROUPS);

    case MSG.ADD_GROUP: {
      const groupId = await db.add(db.STORES.GROUPS, {
        name: message.name,
        order: message.order ?? 0,
      });
      return { id: groupId, name: message.name };
    }

    case MSG.ADD_LINK: {
      const linkId = await db.add(db.STORES.LINKS, {
        groupId: message.groupId,
        title: message.title,
        url: message.url,
        order: message.order ?? 0,
      });
      return { id: linkId };
    }

    case MSG.AI_QUERY:
      return handleAIQuery(message);

    default:
      return { error: 'Unknown message type: ' + message.type };
  }
}

/* ------------------------------------------------------------------ */
/*  AI Query – calls any OpenAI-compatible chat completions endpoint   */
/* ------------------------------------------------------------------ */

async function handleAIQuery(message) {
  const endpoint = await db.getSetting('aiEndpoint');
  const apiKey   = await db.getSetting('aiApiKey');
  const model    = (await db.getSetting('aiModel')) || 'gpt-4o-mini';

  if (!endpoint || !apiKey) {
    return {
      error:
        '未配置 AI 接口。请在扩展设置页面的"AI 助手"部分填写 API 地址和密钥。',
    };
  }

  let systemPrompt;
  let userPrompt;

  if (message.action === 'translate') {
    const targetLang = (await db.getSetting('aiTargetLanguage')) || 'Chinese';
    const template =
      (await db.getSetting('aiTranslatePrompt')) ||
      'Translate the following text to {lang}. Output only the translation:\n\n{text}';
    systemPrompt = 'You are a professional translator.';
    userPrompt = template
      .replace('{lang}', targetLang)
      .replace('{text}', message.text);
  } else {
    const targetLang = (await db.getSetting('aiTargetLanguage')) || 'Chinese';
    const template =
      (await db.getSetting('aiExplainPrompt')) ||
      'Explain the following text briefly and clearly in {lang}:\n\n{text}';
    systemPrompt = 'You are a helpful assistant that explains concepts clearly and concisely.';
    userPrompt = template
      .replace('{lang}', targetLang)
      .replace('{text}', message.text);
  }

  // Normalise base URL: strip trailing slash then append path
  const apiUrl = endpoint.replace(/\/+$/, '') + '/chat/completions';

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens: 1000,
        stream: false,
      }),
    });
  } catch (networkErr) {
    return { error: '网络请求失败: ' + networkErr.message };
  }

  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch (_) {}
    // Avoid leaking the full body which may be large; cap at 200 chars
    const preview = body.length > 200 ? body.slice(0, 200) + '…' : body;
    return { error: `API 错误 ${response.status}: ${preview}` };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseErr) {
    return { error: '无法解析 API 响应: ' + parseErr.message };
  }

  const result = data?.choices?.[0]?.message?.content?.trim() ?? '';
  if (!result) return { error: 'API 返回了空响应。' };

  return { result };
}
