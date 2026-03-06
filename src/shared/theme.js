/**
 * Theme management for Naviky.
 * Reads / writes the "theme" setting in IndexedDB and applies it
 * via the `data-theme` attribute on `<html>`.
 */

import { db } from './db.js';

/** Read the persisted theme and apply it to the document. */
export async function loadTheme() {
  const theme = (await db.getSetting('theme')) || 'dark';
  applyTheme(theme);
  return theme;
}

/** Apply a theme string to the DOM (does NOT persist). */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Toggle between dark ↔ light and persist the choice. */
export async function toggleTheme() {
  const current =
    document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await db.setSetting('theme', next);
  return next;
}

/** Set a specific theme and persist it. */
export async function setTheme(theme) {
  applyTheme(theme);
  await db.setSetting('theme', theme);
}
