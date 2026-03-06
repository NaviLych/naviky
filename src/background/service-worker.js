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

    default:
      return { error: 'Unknown message type: ' + message.type };
  }
}
