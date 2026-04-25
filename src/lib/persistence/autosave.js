/**
 * Workspace autosave to localStorage.
 *
 * - Debounced writes on workspace mutations.
 * - Tries the full snapshot first; on QuotaExceeded, retries without the image store
 *   and pushes a toast so the user knows portraits won't survive a refresh until
 *   they re-load each ship file.
 * - On boot, the dashboard reads the autosave snapshot and shows a Resume banner.
 *
 * This is a CRASH-RECOVERY mechanism, not durable storage. Source of truth lives in
 * the `.shipsync.json` files the user explicitly saves.
 */

const KEY = 'shipsync.workspace.autosave.v1'
const META_KEY = 'shipsync.workspace.autosave.meta.v1'
const DEFAULT_DEBOUNCE_MS = 750

/**
 * @typedef {Object} AutosaveMeta
 * @property {string} savedAt
 * @property {boolean} imagesStripped
 */

/**
 * Synchronously read the autosave snapshot from localStorage.
 * Returns null if absent / unparseable.
 */
export function readAutosave() {
  if (typeof localStorage === 'undefined') return null
  try {
    const text = localStorage.getItem(KEY)
    if (!text) return null
    const snapshot = JSON.parse(text)
    return snapshot
  } catch {
    return null
  }
}

/**
 * @returns {AutosaveMeta|null}
 */
export function readAutosaveMeta() {
  if (typeof localStorage === 'undefined') return null
  try {
    const text = localStorage.getItem(META_KEY)
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function clearAutosave() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(KEY)
  localStorage.removeItem(META_KEY)
}

/**
 * Persist a workspace snapshot to localStorage. Two-tier strategy: try the full
 * snapshot first, and on a quota error fall back to a slim variant that drops
 * the image store. Returns the meta describing what got written, or `null` if
 * both attempts failed (callers should surface a retry affordance).
 *
 * @param {object} workspaceSnapshot
 * @returns {AutosaveMeta | null}
 */
export function writeAutosave(workspaceSnapshot) {
  if (typeof localStorage === 'undefined') {
    return { savedAt: new Date().toISOString(), imagesStripped: false }
  }
  /** @type {AutosaveMeta} */
  const meta = { savedAt: new Date().toISOString(), imagesStripped: false }
  try {
    localStorage.setItem(KEY, JSON.stringify(workspaceSnapshot))
    localStorage.setItem(META_KEY, JSON.stringify(meta))
    return meta
  } catch (e) {
    if (isQuotaError(e)) {
      const slim = { ...workspaceSnapshot, images: {} }
      try {
        localStorage.setItem(KEY, JSON.stringify(slim))
        meta.imagesStripped = true
        localStorage.setItem(META_KEY, JSON.stringify(meta))
        return meta
      } catch {
        return null
      }
    }
    return null
  }
}

function isQuotaError(e) {
  if (!e) return false
  const name = /** @type {{ name?: string }} */ (e).name ?? ''
  // Different browsers report this differently.
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /** @type {{ code?: number }} */ (e).code === 22 ||
    /** @type {{ code?: number }} */ (e).code === 1014
  )
}

/**
 * Build a debounced autosave function. Caller hands in a snapshot getter.
 * Component drives invocation with `$effect(() => { snapshotGetter(); save() })`.
 *
 * `onWrite` fires on a successful write (full or stripped). `onError` fires
 * when both attempts failed — UI should expose a retry affordance.
 *
 * `debounceMs` accepts either a fixed number or a getter `() => number`.
 * The getter is read on every `schedule()` call so user-facing settings
 * (v1.0 SettingsDialog) flow through to the next autosave without needing
 * to re-create the autosaver.
 *
 * @param {() => object} snapshotGetter
 * @param {{ debounceMs?: number | (() => number), onWrite?: (meta: AutosaveMeta) => void, onError?: () => void }} [opts]
 */
export function makeAutosaver(snapshotGetter, opts = {}) {
  const debounceSpec = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const resolveDebounce =
    typeof debounceSpec === 'function' ? debounceSpec : () => debounceSpec
  let handle = 0
  let lastMeta = /** @type {AutosaveMeta|null} */ (null)

  function flush() {
    const snapshot = snapshotGetter()
    const meta = writeAutosave(snapshot)
    if (meta) {
      lastMeta = meta
      opts.onWrite?.(meta)
    } else {
      opts.onError?.()
    }
  }

  return {
    /** Call on every mutation; debounced flush. */
    schedule() {
      if (typeof window === 'undefined') return
      window.clearTimeout(handle)
      const ms = resolveDebounce()
      handle = window.setTimeout(flush, Number.isFinite(ms) ? ms : DEFAULT_DEBOUNCE_MS)
    },
    /** Force an immediate write (e.g. before unload, or a retry tap). */
    flushNow: flush,
    /** @returns {AutosaveMeta|null} */
    lastMeta() {
      return lastMeta
    },
  }
}
