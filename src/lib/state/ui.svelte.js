/**
 * Transient UI state. Lives only in memory; never persisted.
 */

/**
 * @typedef {Object} ToastEntry
 * @property {string} id
 * @property {'info'|'success'|'warning'|'error'} kind
 * @property {string} title
 * @property {string} [body]
 * @property {number} createdAt
 * @property {number} timeoutMs
 */

/**
 * @typedef {Object} ResumeBanner
 * @property {boolean} visible
 * @property {string|null} lastSavedAt
 */

/**
 * v0.7 — Captain's Log filter state. Lives in the transient UI store so it
 * resets on a fresh workspace load (filters are session ergonomics, not
 * something the user wants persisted between table sessions).
 *
 * v1.0.4 — the per-ship narrative journal was retired and the dashboard
 * widget reclaimed the "Captain's Log" name. The category filter dropped
 * its `'journal'` bucket along with the feature; legacy `'journal'` values
 * read from a stale UI snapshot land on `'all'` via the setter below.
 *
 * - `shipFilter`: a player ship id, a scene ship id, the literal `'workspace'`
 *   for events not tied to any ship, or `null` for "all".
 * - `categoryFilter`: one of `ACTION_CATEGORIES` or `'all'`.
 *
 * @typedef {Object} ActivityLogFilter
 * @property {string|null} shipFilter
 * @property {'all'|'combat'|'crew'|'refit'} categoryFilter
 */

export const ui = $state({
  /** @type {'add-ship'|'flag-conflicts'|'shore-leave'|'apply-flag'|'settings'|null} */
  openDialog: null,
  /** @type {ToastEntry[]} */
  toasts: [],
  resumeBanner: /** @type {ResumeBanner} */ ({ visible: false, lastSavedAt: null }),
  hasUnsavedChanges: false,
  activityLog: /** @type {ActivityLogFilter} */ ({
    shipFilter: null,
    categoryFilter: 'all',
  }),
  /**
   * v0.9 — Source pointer for the "apply this flag" dialog. Set by
   * `openApplyFlagDialog` alongside `openDialog = 'apply-flag'`; cleared on
   * close. Null when the dialog isn't tied to a flag (which should never be
   * the case once the dialog is open, but the union keeps the closed state
   * representable without ghost data).
   * @type {{ shipId: string, flagId: string }|null}
   */
  applyFlagSource: null,
})

let toastSeq = 0

/**
 * @param {Omit<ToastEntry, 'id'|'createdAt'|'timeoutMs'> & { timeoutMs?: number }} entry
 */
export function pushToast(entry) {
  const t = {
    id: 'toast-' + ++toastSeq,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    createdAt: Date.now(),
    timeoutMs: entry.timeoutMs ?? (entry.kind === 'error' ? 8000 : 4000),
  }
  ui.toasts.push(t)
  if (t.timeoutMs > 0) {
    setTimeout(() => dismissToast(t.id), t.timeoutMs)
  }
  return t.id
}

/** @param {string} id */
export function dismissToast(id) {
  const idx = ui.toasts.findIndex((t) => t.id === id)
  if (idx >= 0) ui.toasts.splice(idx, 1)
}

/** @param {'add-ship'|'flag-conflicts'|'shore-leave'|'apply-flag'|'settings'|null} dialogId */
export function openDialog(dialogId) {
  ui.openDialog = dialogId
}

export function closeDialog() {
  ui.openDialog = null
  // Drop dialog-bound context so a future `openDialog` call doesn't pick up
  // stale source data from a previous session.
  ui.applyFlagSource = null
}

/**
 * v0.9 — Open the apply-flag dialog with a source flag pinned. The dialog
 * UI reads `ui.applyFlagSource` to resolve the source ship name, flag name,
 * and so on; this opener guarantees the context is in place before the
 * dialog renders.
 *
 * @param {string} shipId
 * @param {string} flagId
 */
export function openApplyFlagDialog(shipId, flagId) {
  ui.applyFlagSource = { shipId, flagId }
  ui.openDialog = 'apply-flag'
}

/** @param {string|null} lastSavedAt */
export function showResumeBanner(lastSavedAt) {
  ui.resumeBanner.visible = true
  ui.resumeBanner.lastSavedAt = lastSavedAt
}

export function dismissResumeBanner() {
  ui.resumeBanner.visible = false
  ui.resumeBanner.lastSavedAt = null
}

/** @param {string|null} shipId */
export function setActivityLogShipFilter(shipId) {
  ui.activityLog.shipFilter = shipId ?? null
}

/** @param {'all'|'combat'|'crew'|'refit'} category */
export function setActivityLogCategoryFilter(category) {
  // v1.0.4 dropped the `'journal'` bucket; coerce stale values to `'all'` so
  // a leftover preference doesn't leave the user staring at an empty list.
  if (category === /** @type {any} */ ('journal')) {
    ui.activityLog.categoryFilter = 'all'
    return
  }
  ui.activityLog.categoryFilter = category
}

export function clearActivityLogFilters() {
  ui.activityLog.shipFilter = null
  ui.activityLog.categoryFilter = 'all'
}
