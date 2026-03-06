/**
 * Message type constants for communication between
 * content scripts, service worker, and extension pages.
 */
export const MSG = {
  // Search request from panel → service worker
  SEARCH: 'SEARCH',

  // Navigation actions from panel → service worker
  OPEN_URL: 'OPEN_URL',
  SWITCH_TAB: 'SWITCH_TAB',

  // Settings retrieval (panel → service worker)
  GET_SETTINGS: 'GET_SETTINGS',

  // Bookmark (context menu → service worker → content script)
  GET_GROUPS: 'GET_GROUPS',
  ADD_LINK: 'ADD_LINK',
  ADD_GROUP: 'ADD_GROUP',
  BOOKMARK_PAGE: 'BOOKMARK_PAGE',
};
