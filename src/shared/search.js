/**
 * Unified search engine for Naviky.
 *
 * Uses dependency‑injection so the same logic works in:
 *   - Extension pages (direct chrome.* API access)
 *   - Service worker (proxy for content‑script panel)
 */

/* ------------------------------------------------------------------ */
/*  Shortcut URL builder                                               */
/* ------------------------------------------------------------------ */

/**
 * Replace `%s` in a URL template with the user query.
 * If the template contains `%s{X}`, spaces in the query are replaced with char X.
 *   e.g.  template = "https://bing.com/search?q=%s{+}"
 *         query    = "hello world"
 *         result   = "https://bing.com/search?q=hello+world"
 *
 * If no `{X}` marker, spaces are standard URL‑encoded (%20).
 */
export function buildShortcutUrl(template, query) {
  const marker = template.match(/%s\{(.)\}/);
  if (marker) {
    const spaceChar = marker[1];
    const processed = query.split(' ').join(spaceChar);
    return template.replace(/%s\{.\}/, processed);
  }
  return template.replace('%s', encodeURIComponent(query));
}

/* ------------------------------------------------------------------ */
/*  Main search                                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {string} query
 * @param {Object} providers
 * @param {() => Promise<{keyword:string,urlTemplate:string}[]>} providers.getShortcuts
 * @param {(q:string) => Promise<chrome.tabs.Tab[]>}              providers.searchTabs
 * @param {(q:string) => Promise<chrome.history.HistoryItem[]>}   providers.searchHistory
 * @param {() => Promise<{title:string,url:string}[]>}            providers.getLinks
 * @returns {Promise<SearchResult[]>}
 */
export async function searchAll(query, providers) {
  if (!query || !query.trim()) return [];

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const results = [];

  /* 1 ── Shortcuts ------------------------------------------------- */
  try {
    const shortcuts = await providers.getShortcuts();
    const firstWord = lower.split(' ')[0];
    const restRaw = trimmed.slice(firstWord.length).trim();

    for (const sc of shortcuts) {
      const kw = sc.keyword.toLowerCase();
      if (kw === firstWord) {
        if (restRaw) {
          // Keyword + query → resolved URL
          results.push({
            type: 'shortcut',
            title: `${sc.keyword}: ${restRaw}`,
            url: buildShortcutUrl(sc.urlTemplate, restRaw),
            description: sc.urlTemplate,
            icon: '⚡',
          });
        } else {
          // Just the keyword → hint
          results.push({
            type: 'shortcut-hint',
            title: `${sc.keyword} — type a query after the keyword…`,
            url: '',
            description: sc.urlTemplate,
            icon: '⚡',
          });
        }
      } else if (kw.startsWith(lower)) {
        // Partial keyword match → suggest shortcut
        results.push({
          type: 'shortcut-hint',
          title: `${sc.keyword} → ${sc.urlTemplate}`,
          url: '',
          description: 'Shortcut',
          icon: '⚡',
        });
      }
    }
  } catch (e) {
    console.warn('[Naviky] shortcut search failed:', e);
  }

  /* 2 ── Open tabs ------------------------------------------------- */
  try {
    const tabs = await providers.searchTabs(trimmed);
    const matched = tabs.filter(
      (t) =>
        (t.title && t.title.toLowerCase().includes(lower)) ||
        (t.url && t.url.toLowerCase().includes(lower)),
    );
    for (const tab of matched.slice(0, 5)) {
      results.push({
        type: 'tab',
        title: tab.title || 'Untitled',
        url: tab.url || '',
        description: 'Switch to tab',
        icon: '📑',
        tabId: tab.id,
        windowId: tab.windowId,
      });
    }
  } catch (e) {
    console.warn('[Naviky] tab search failed:', e);
  }

  /* 3 ── History --------------------------------------------------- */
  try {
    const items = await providers.searchHistory(trimmed);
    for (const h of items.slice(0, 5)) {
      if (results.some((r) => r.url === h.url)) continue;
      results.push({
        type: 'history',
        title: h.title || h.url,
        url: h.url,
        description: `Visited ${h.visitCount || 0} times`,
        icon: '🕐',
      });
    }
  } catch (e) {
    console.warn('[Naviky] history search failed:', e);
  }

  /* 4 ── Saved links ----------------------------------------------- */
  try {
    const links = await providers.getLinks();
    const matched = links.filter(
      (l) =>
        (l.title && l.title.toLowerCase().includes(lower)) ||
        (l.url && l.url.toLowerCase().includes(lower)),
    );
    for (const link of matched.slice(0, 5)) {
      if (results.some((r) => r.url === link.url)) continue;
      results.push({
        type: 'link',
        title: link.title || link.url,
        url: link.url,
        description: 'Saved link',
        icon: '📌',
      });
    }
  } catch (e) {
    console.warn('[Naviky] link search failed:', e);
  }

  /* 5 ── Google fallback ------------------------------------------- */
  results.push({
    type: 'google',
    title: `Search Google for "${trimmed}"`,
    url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
    description: 'google.com',
    icon: '🔍',
  });

  return results;
}
