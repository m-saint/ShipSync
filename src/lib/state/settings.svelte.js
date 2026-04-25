/**
 * Workspace preferences (v1.0).
 *
 * Tiny reactive store for cross-cutting UI choices that live with the user,
 * not the workspace data. Persisted to localStorage under
 * `shipsync.settings.v1` so they ride between sessions on the same device,
 * but never travel inside `.shipsync.json` files (those are about ship state,
 * not the captain's preferred autosave cadence).
 *
 * Architecture mirrors the autosave/UI stores: a `$state` proxy that any
 * surface can subscribe to, plus narrow setter helpers that validate and
 * write through to localStorage.
 *
 * @typedef {'auto'|'light'|'dark'} ColorScheme
 *   - 'auto'  follow the OS preference (`prefers-color-scheme`)
 *   - 'light' force the default palette regardless of OS
 *   - 'dark'  force the inverted palette regardless of OS
 *
 * @typedef {'comfortable'|'compact'} Density
 *   Tunes vertical rhythm + control heights across the dashboard.
 *
 * @typedef {Object} AppSettings
 * @property {ColorScheme} colorScheme
 * @property {Density} density
 * @property {number} autosaveDebounceMs
 *   Debounce interval for autosave writes. The default is 750ms (the same
 *   value pre-1.0 had hard-coded); the settings dialog exposes 30s / 10s /
 *   2s / 750ms presets so a user with a slow disk or cramped storage can
 *   relax the cadence. Stored in milliseconds for symmetry with the
 *   debounce primitive.
 * @property {boolean} carryOverOnCharter
 *   When true, the Charter dialog surfaces a "carry forward bridge crew &
 *   supplies" affordance that pre-fills the new ship from the most
 *   recently focused vessel. Defaults to false because it's a power-user
 *   shortcut — pleasant when you're managing a fleet of similar ships,
 *   confusing when each charter is meant to be a fresh slate.
 */

const STORAGE_KEY = 'shipsync.settings.v1'

/**
 * Lower bound on the debounce. We never want a 0ms autosave (it would fire
 * on every key press, locking up localStorage in tight loops). 250ms is
 * still snappy by human standards and leaves room for keystroke runs.
 */
export const MIN_AUTOSAVE_DEBOUNCE_MS = 250

/**
 * Upper bound on the debounce. Fifteen minutes is the longest cadence that
 * still recovers a session from a browser crash without losing meaningful
 * play. Anything longer turns autosave into manual save.
 */
export const MAX_AUTOSAVE_DEBOUNCE_MS = 15 * 60 * 1000

/**
 * The presets surfaced in the settings dialog. The numeric value is stored;
 * the label is the dialog's display string. Keeping them paired here so
 * the dialog can render directly from this list.
 */
export const AUTOSAVE_PRESETS = /** @type {const} */ ([
  { value: 750, label: 'Live (3/4s)' },
  { value: 2_000, label: 'Brisk (2s)' },
  { value: 10_000, label: 'Steady (10s)' },
  { value: 30_000, label: 'Relaxed (30s)' },
])

/**
 * Default settings used both for first boot and as the fallback when a
 * stored payload is corrupt/missing fields. v1.0 intentionally ships with
 * `colorScheme: 'auto'` and `density: 'comfortable'` so existing users
 * see no visual change after upgrading; the new behaviors are opt-in.
 *
 * @returns {AppSettings}
 */
function makeDefaultSettings() {
  return {
    colorScheme: 'auto',
    density: 'comfortable',
    autosaveDebounceMs: 750,
    carryOverOnCharter: false,
  }
}

/**
 * Coerce a possibly-untrusted parsed payload into a valid `AppSettings`.
 * Unknown enum values fall back to the default so a hand-edited
 * localStorage entry can't crash the app on boot.
 *
 * @param {unknown} raw
 * @returns {AppSettings}
 */
function normalizeSettings(raw) {
  const def = makeDefaultSettings()
  if (!raw || typeof raw !== 'object') return def
  const obj = /** @type {Record<string, unknown>} */ (raw)

  /** @type {ColorScheme} */
  const colorScheme =
    obj.colorScheme === 'light' || obj.colorScheme === 'dark' || obj.colorScheme === 'auto'
      ? obj.colorScheme
      : def.colorScheme

  /** @type {Density} */
  const density =
    obj.density === 'comfortable' || obj.density === 'compact' ? obj.density : def.density

  const rawDebounce = Number(obj.autosaveDebounceMs)
  const autosaveDebounceMs = Number.isFinite(rawDebounce)
    ? Math.max(MIN_AUTOSAVE_DEBOUNCE_MS, Math.min(MAX_AUTOSAVE_DEBOUNCE_MS, rawDebounce))
    : def.autosaveDebounceMs

  const carryOverOnCharter =
    typeof obj.carryOverOnCharter === 'boolean' ? obj.carryOverOnCharter : def.carryOverOnCharter

  return { colorScheme, density, autosaveDebounceMs, carryOverOnCharter }
}

/**
 * Synchronously read settings from localStorage. Returns defaults when
 * nothing is stored or parsing fails. Safe to call during module init.
 *
 * @returns {AppSettings}
 */
function loadSettings() {
  if (typeof localStorage === 'undefined') return makeDefaultSettings()
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return makeDefaultSettings()
    return normalizeSettings(JSON.parse(text))
  } catch {
    return makeDefaultSettings()
  }
}

/**
 * Reactive settings store. Surfaces should read fields off this directly
 * (`settings.colorScheme`) and use the setter helpers below to mutate, so
 * the localStorage write side-effect is centralized.
 *
 * @type {AppSettings}
 */
export const settings = $state(loadSettings())

/**
 * Persist the current `settings` object to localStorage. Failures are
 * intentionally swallowed — a private-mode browser without storage still
 * gets the in-memory settings for the session, just without persistence.
 */
function persist() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(settings)))
  } catch {
    /* private mode / quota — settings still apply this session */
  }
}

/** @param {ColorScheme} next */
export function setColorScheme(next) {
  if (next !== 'auto' && next !== 'light' && next !== 'dark') return
  if (settings.colorScheme === next) return
  settings.colorScheme = next
  persist()
}

/** @param {Density} next */
export function setDensity(next) {
  if (next !== 'comfortable' && next !== 'compact') return
  if (settings.density === next) return
  settings.density = next
  persist()
}

/**
 * Set the autosave debounce. Clamped into [MIN, MAX]; non-finite values
 * are dropped silently rather than corrupting the stored value.
 *
 * @param {number} ms
 */
export function setAutosaveDebounceMs(ms) {
  if (!Number.isFinite(ms)) return
  const clamped = Math.max(MIN_AUTOSAVE_DEBOUNCE_MS, Math.min(MAX_AUTOSAVE_DEBOUNCE_MS, ms))
  if (settings.autosaveDebounceMs === clamped) return
  settings.autosaveDebounceMs = clamped
  persist()
}

/** @param {boolean} next */
export function setCarryOverOnCharter(next) {
  const flag = next === true
  if (settings.carryOverOnCharter === flag) return
  settings.carryOverOnCharter = flag
  persist()
}

/**
 * Reset every setting to its default value. Useful for tests and for the
 * "Restore defaults" button in the settings dialog.
 */
export function resetSettings() {
  Object.assign(settings, makeDefaultSettings())
  persist()
}

/**
 * Resolve the effective color scheme — 'auto' translates to 'light' or
 * 'dark' based on the OS preference. Centralized so every surface that
 * needs the boolean answer ("am I dark right now?") gets the same logic.
 *
 * @returns {'light'|'dark'}
 */
export function effectiveColorScheme() {
  if (settings.colorScheme === 'light') return 'light'
  if (settings.colorScheme === 'dark') return 'dark'
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
