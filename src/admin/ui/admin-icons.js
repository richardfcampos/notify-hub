/**
 * Inline SVG icons (ADMIN-07: no external icon font / CDN, 100%
 * self-contained). Each export is a small, hardcoded, trusted markup
 * string -- never interpolated with user/channel data -- so it is safe to
 * assign via `el(..., { html: ICON_X })` (see admin-dom.js).
 */

export const ICON_EYE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>'

export const ICON_EYE_OFF =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.6 6.7C4 8.3 1.5 12 1.5 12s3.5 7 10.5 7c1.9 0 3.6-.5 5-1.2' +
  'M17.4 17.3C20 15.7 22.5 12 22.5 12s-1.2-2.4-3.4-4.4"/></svg>'

export const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12"/></svg>'

export const ICON_REFRESH =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></svg>'

export const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M5 12.5 10 17l9-11"/></svg>'

export const ICON_CROSS =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">' +
  '<path d="M6 6l12 12M18 6L6 18"/></svg>'

export const ICON_SPINNER =
  '<svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">' +
  '<circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>'

export const ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'

export const ICON_BELL =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">' +
  '<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'
