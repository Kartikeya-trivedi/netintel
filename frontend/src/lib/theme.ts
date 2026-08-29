import { useSyncExternalStore } from 'react'

/** Theme preference and the colour it resolves to.
 *
 *  A tiny external store rather than context: NetworkGraph and TimelineChart
 *  paint with colour strings read out of CSS custom properties, so they need to
 *  re-read on every theme change no matter where the toggle lives in the tree.
 */

export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'netintel.theme'

const listeners = new Set<() => void>()
let pref: ThemePref = readStoredPref()

function readStoredPref(): ThemePref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // Private mode or blocked storage: fall through to the system default.
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(value: ThemePref): ResolvedTheme {
  if (value === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return value
}

/** Stamps the root element so the CSS [data-theme] blocks win over the media
 *  query. 'system' clears the stamp and lets the media query decide. */
function applyToDocument(value: ThemePref) {
  const root = document.documentElement
  if (value === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', value)
}

export function getThemePref(): ThemePref {
  return pref
}

export function getResolvedTheme(): ResolvedTheme {
  return resolve(pref)
}

export function setThemePref(next: ThemePref) {
  pref = next
  applyToDocument(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Preference is lost on reload, but the session still honours it.
  }
  listeners.forEach((listener) => listener())
}

/** Flip to the opposite of what is currently on screen, pinning the choice. */
export function toggleTheme() {
  setThemePref(getResolvedTheme() === 'dark' ? 'light' : 'dark')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Track the OS while the reader is on 'system', so the graph repaints too.
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (pref === 'system') listeners.forEach((listener) => listener())
  })
}

// Keep the module and the DOM in agreement on load. index.html stamps inline
// before first paint so the page never flashes the wrong ground.
applyToDocument(pref)

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref, getThemePref)
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, getResolvedTheme, getResolvedTheme)
}

/** Reads a colour out of the cascade. Used by the canvas and SVG renderers,
 *  which cannot consume the oklch tokens directly. */
export function readThemeColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
