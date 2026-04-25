/**
 * Workspace state for ShipSync. Single source of truth for the dashboard.
 *
 * Architecture:
 *   - `workspace` is a Svelte 5 `$state` proxy mutated directly by mutator functions below.
 *   - Every mutator goes through `commit(action, mutate)`, which:
 *       1. Snapshots the workspace before/after via `$state.snapshot`,
 *       2. Pushes the snapshot pair onto an in-memory plain undo stack,
 *       3. Appends a lightweight log entry to the affected ship's session history.
 *   - Undo/redo replays workspace snapshots (RAM only; never persisted).
 *   - The on-disk per-ship action log lives in `ship.sessionHistory`.
 *
 * Why are the undo/redo stacks plain arrays (not `$state`)?
 *   `$state(...)` deep-wraps everything inside in Svelte 5 proxies. Pushing a snapshot
 *   into a `$state` array would re-wrap it, which then makes the snapshot unclonable
 *   and indistinguishable from live workspace state. We keep the stacks plain and
 *   expose just the things UIs need to react to (lengths, recent actions) through a
 *   small reactive `stackInfo` mirror.
 */

import {
  collectImageIds,
  composeDamageSummary,
  composeRepairSummary,
  composeShoreLeaveSummary,
  makeEmptyWorkspace,
  makeId,
  normalizeReputation,
  nowIso,
  makeShip,
  makeSceneShip,
  makePursuit,
  reputationsEqual,
} from '../domain/derivations.js'
import {
  CARDINALS,
  MOBILITY_OPTIONS,
  REPUTATION_AXES,
  REPUTATION_AXIS_LABELS,
  SHIP_SIZES,
  STATIONS,
  STATION_LABELS,
} from '../domain/rules.js'
import { pushToast } from './ui.svelte.js'

/**
 * Cap on how many distinct undo entries we retain. The cap is a memory
 * safety guard — without it a long session that touches many resources
 * grows the undo arena unbounded, since each entry packs a deep clone
 * of the workspace before/after. 200 is enough headroom for a long
 * play session (a typical 4-hour session lands well under 100 commits)
 * while keeping the worst-case footprint bounded; older entries get
 * pruned silently from the bottom of the stack and the count of
 * pruned actions is surfaced to the Activity Log as a soft boundary
 * hint so the user sees why old actions can't be undone anymore.
 */
const UNDO_LIMIT = 200

/** @type {import('../domain/types.js').Workspace} */
export const workspace = $state(makeEmptyWorkspace())

/**
 * Each entry packs the workspace snapshots before/after the commit, the
 * LogAction surfaced to the Activity Log, and an optional `coalesceKey`
 * used to merge sequential same-bucket commits (see `commit()` for details).
 *
 * @type {Array<{ before: any, after: any, action: import('../domain/types.js').LogAction, coalesceKey: string|null }>}
 */
const undoStack = []

/** @type {Array<{ before: any, after: any, action: import('../domain/types.js').LogAction, coalesceKey: string|null }>} */
const redoStack = []

/**
 * Reactive mirror of the (plain) undo/redo stacks. UIs that need to react to
 * undo/redo changes read these instead of the stacks themselves. `prunedCount`
 * tracks how many entries fell off the bottom because of UNDO_LIMIT — the
 * Activity Log uses it to render a tiny "older history pruned" boundary hint.
 */
const stackInfo = $state({ undoLen: 0, redoLen: 0, prunedCount: 0, version: 0 })

function syncStackInfo() {
  stackInfo.undoLen = undoStack.length
  stackInfo.redoLen = redoStack.length
  stackInfo.version++
}

/** Read-only view of how many steps can be undone or redone. */
export function undoableCount() {
  return stackInfo.undoLen
}
export function redoableCount() {
  return stackInfo.redoLen
}

/**
 * How many actions have been pruned from the bottom of the undo stack
 * because the cap was hit. Resets when the workspace is cleared.
 * Exposed so the Activity Log can render a "history pruned" hint at
 * the oldest-entry boundary without leaking the raw stack to UI code.
 */
export function prunedActionCount() {
  return stackInfo.prunedCount
}

/**
 * Most recent N actions from any ship + workspace, newest-first.
 * Used by the Activity Log and the per-ship Captain's Log narrative.
 * @param {number} [limit]
 */
export function recentActions(limit = 50) {
  void stackInfo.version
  return undoStack
    .slice(-limit)
    .reverse()
    .map((e) => e.action)
}

/**
 * Deep-clone a JSON-shaped snapshot. We use JSON round-tripping rather than
 * `structuredClone` because some Svelte 5 proxy traps can leak into snapshots
 * (e.g. via Symbol-keyed metadata) and `structuredClone` fails on those.
 * Our domain state is fully JSON-serializable by design (only strings, numbers,
 * booleans, plain objects/arrays, and ISO date strings).
 */
function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot))
}

/**
 * Wrap a mutation in a transactional commit so it's logged and undoable.
 *
 * `coalesceKey` is the per-round / per-bucket merge knob used by combat-resource
 * mutators (mettle, crew, fires). When the most recent undo entry shares the
 * same key, we treat the new commit as a continuation of the same bucket: the
 * existing entry's `after` snapshot is replaced with the latest, and the log
 * line's `summary` and `timestamp` are rewritten in place. The original `before`
 * is preserved so that a single undo unwinds the entire chain back to the state
 * before the first commit in the bucket.
 *
 * Coalescing is broken by:
 *   - any commit with no `coalesceKey` (e.g. ship.rename, supplies.update)
 *   - any commit whose `coalesceKey` differs from the last entry's
 *   - an `undo()` (which pops the entry and clears the chain anchor)
 *
 * Important: redo is still cleared on every commit (coalesced or not) — once
 * you've made a forward edit, the parallel timeline is gone.
 *
 * @param {{ kind: string, summary: string, shipId?: string|null, coalesceKey?: string|null }} action
 * @param {() => void} mutate
 */
function commit(action, mutate) {
  const before = cloneSnapshot($state.snapshot(workspace))
  mutate()
  const after = cloneSnapshot($state.snapshot(workspace))

  const coalesceKey = action.coalesceKey ?? null
  const lastEntry = undoStack[undoStack.length - 1] ?? null
  const canCoalesce =
    coalesceKey != null && lastEntry != null && lastEntry.coalesceKey === coalesceKey

  if (canCoalesce) {
    // Merge into the existing entry: keep the original `before`, advance
    // `after`, rewrite the log line. We REPLACE the LogAction object rather
    // than mutating it in place — Svelte 5's keyed `{#each}` over the global
    // Activity Log diffs by `action.id`, and reused DOM nodes don't re-read
    // string properties when the bound object identity stays the same. A
    // fresh reference forces text-content re-evaluation.
    const updatedAction = {
      ...lastEntry.action,
      summary: action.summary,
      timestamp: nowIso(),
    }
    // Sync into the ship's open SessionEntry so the per-ship Captain's Log
    // (read via `ship.sessionHistory`) also picks up the new identity.
    if (updatedAction.shipId) {
      const ship = workspace.ships[updatedAction.shipId]
      if (ship) {
        for (let s = ship.sessionHistory.length - 1; s >= 0; s--) {
          const sess = ship.sessionHistory[s]
          const idx = sess.actions.findIndex((a) => a.id === updatedAction.id)
          if (idx >= 0) {
            sess.actions[idx] = updatedAction
            break
          }
        }
      }
    }
    lastEntry.after = after
    lastEntry.action = updatedAction
    redoStack.length = 0
    syncStackInfo()
    return
  }

  /** @type {import('../domain/types.js').LogAction} */
  const logAction = {
    id: makeId(),
    timestamp: nowIso(),
    kind: action.kind,
    summary: action.summary,
    shipId: action.shipId ?? null,
    before: {},
    after: {},
  }

  undoStack.push({ before, after, action: logAction, coalesceKey })
  while (undoStack.length > UNDO_LIMIT) {
    undoStack.shift()
    stackInfo.prunedCount++
  }
  redoStack.length = 0
  syncStackInfo()

  if (action.shipId && workspace.ships[action.shipId]) {
    appendShipLog(action.shipId, logAction)
  }
}

/**
 * Append a log entry to the current open SessionEntry of the given ship.
 * If no session is open for the ship, start one implicitly.
 * @param {string} shipId
 * @param {import('../domain/types.js').LogAction} action
 */
function appendShipLog(shipId, action) {
  const ship = workspace.ships[shipId]
  if (!ship) return
  const last = ship.sessionHistory[ship.sessionHistory.length - 1]
  if (!last || last.endedAt != null) {
    ship.sessionHistory.push({
      id: makeId(),
      workspaceSessionId: workspace.workspaceSessionId,
      startedAt: nowIso(),
      endedAt: null,
      title: 'Session',
      narrative: '',
      actions: [action],
      sessionDate: '',
      location: '',
      encounterName: '',
    })
    return
  }
  ship.sessionHistory[ship.sessionHistory.length - 1].actions.push(action)
}

/**
 * Replace the entire workspace state with a snapshot, in place.
 * We mutate existing arrays/objects rather than reassign so Svelte 5 deep reactivity
 * tracks the change cleanly across all $derived consumers.
 */
function replaceWorkspaceWith(snapshot) {
  for (const key of Object.keys(workspace.ships)) {
    delete workspace.ships[key]
  }
  for (const [k, v] of Object.entries(snapshot.ships ?? {})) {
    workspace.ships[k] = v
  }

  workspace.shipOrder.length = 0
  for (const id of snapshot.shipOrder ?? []) {
    workspace.shipOrder.push(id)
  }

  if (snapshot.scene) {
    const incoming = snapshot.scene
    workspace.scene.mode = incoming.mode ?? 'idle'
    workspace.scene.windDirection = incoming.windDirection ?? 'N'
    workspace.scene.weatherGageHolderId = incoming.weatherGageHolderId ?? null
    workspace.scene.round = incoming.round ?? 0
    workspace.scene.phase = incoming.phase ?? 'idle'
    workspace.scene.pursuit = incoming.pursuit ?? null

    // sceneShips dict + sceneShipOrder mutate in place so consumers holding a
    // ref into `workspace.scene.sceneShips` keep tracking after a snapshot restore.
    if (!workspace.scene.sceneShips) workspace.scene.sceneShips = {}
    if (!workspace.scene.sceneShipOrder) workspace.scene.sceneShipOrder = []
    for (const key of Object.keys(workspace.scene.sceneShips)) {
      delete workspace.scene.sceneShips[key]
    }
    for (const [k, v] of Object.entries(incoming.sceneShips ?? {})) {
      workspace.scene.sceneShips[k] = v
    }
    workspace.scene.sceneShipOrder.length = 0
    for (const id of incoming.sceneShipOrder ?? []) {
      workspace.scene.sceneShipOrder.push(id)
    }

    // Scene-only ship conditions (heeling, in irons, …) live here. Migrate the
    // dict in place so existing reactive references stay live, and tolerate
    // older autosaves that predate the field.
    if (!workspace.scene.shipConditions) workspace.scene.shipConditions = {}
    for (const key of Object.keys(workspace.scene.shipConditions)) {
      delete workspace.scene.shipConditions[key]
    }
    for (const [k, v] of Object.entries(incoming.shipConditions ?? {})) {
      workspace.scene.shipConditions[k] = Array.isArray(v) ? [...v] : []
    }
  }

  for (const key of Object.keys(workspace.images)) {
    delete workspace.images[key]
  }
  for (const [k, v] of Object.entries(snapshot.images ?? {})) {
    workspace.images[k] = v
  }

  for (const key of Object.keys(workspace.lastSavedAtByShipId)) {
    delete workspace.lastSavedAtByShipId[key]
  }
  for (const [k, v] of Object.entries(snapshot.lastSavedAtByShipId ?? {})) {
    workspace.lastSavedAtByShipId[k] = v
  }

  workspace.focusedShipId = snapshot.focusedShipId ?? null
  workspace.workspaceSessionId = snapshot.workspaceSessionId ?? null
}

// ---------- Mutators ----------

/**
 * Add a new ship to the workspace.
 * @param {Partial<import('../domain/types.js').Ship>} overrides
 * @returns {string} the new ship's id
 */
export function addShip(overrides = {}) {
  const ship = makeShip(overrides)
  commit(
    {
      kind: 'ship.add',
      summary: `Chartered ${ship.name}.`,
      shipId: ship.id,
    },
    () => {
      workspace.ships[ship.id] = ship
      workspace.shipOrder.push(ship.id)
      workspace.focusedShipId = ship.id
    },
  )
  return ship.id
}

/**
 * Remove a ship from the workspace.
 * @param {string} shipId
 */
export function removeShip(shipId) {
  const ship = workspace.ships[shipId]
  if (!ship) return
  commit(
    {
      kind: 'ship.remove',
      summary: `Cast off ${ship.name}.`,
      shipId,
    },
    () => {
      delete workspace.ships[shipId]
      workspace.shipOrder = workspace.shipOrder.filter((id) => id !== shipId)
      delete workspace.lastSavedAtByShipId[shipId]
      if (workspace.focusedShipId === shipId) {
        workspace.focusedShipId = workspace.shipOrder[0] ?? null
      }
      if (workspace.scene.weatherGageHolderId === shipId) {
        workspace.scene.weatherGageHolderId = null
      }
      if (workspace.scene.pursuit) {
        if (workspace.scene.pursuit.pursuerId === shipId) {
          workspace.scene.pursuit.pursuerId = null
        }
        if (workspace.scene.pursuit.quarryId === shipId) {
          workspace.scene.pursuit.quarryId = null
        }
      }
      if (workspace.scene.shipConditions[shipId]) {
        delete workspace.scene.shipConditions[shipId]
      }
    },
  )
}

/** @param {string|null} shipId */
export function focusShip(shipId) {
  if (workspace.focusedShipId === shipId) return
  workspace.focusedShipId = shipId
}

/**
 * v0.9 — Replace `workspace.shipOrder` with a permutation of itself.
 *
 * Defensive in three layers (any failure is a silent no-op so a buggy caller
 * cannot corrupt fleet order):
 *   1. `newOrder` must be an array with the same length as the current order.
 *   2. It must contain exactly the same set of ship ids — no additions, no
 *      removals, no duplicates.
 *   3. It must actually differ from the current order; otherwise we skip the
 *      commit so undo history stays clean (no zero-effect entries).
 *
 * One commit, one log entry. Used as the primitive behind `moveShipUp` /
 * `moveShipDown` and the future drag-and-drop reorder, if ever revisited.
 *
 * @param {string[]} newOrder
 */
export function setShipOrder(newOrder) {
  if (!Array.isArray(newOrder)) return
  const current = workspace.shipOrder
  if (newOrder.length !== current.length) return

  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const currentSet = new Set(current)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const proposedSet = new Set()
  for (const id of newOrder) {
    if (typeof id !== 'string') return
    if (!currentSet.has(id)) return
    if (proposedSet.has(id)) return
    proposedSet.add(id)
  }
  if (proposedSet.size !== current.length) return

  let changed = false
  for (let i = 0; i < newOrder.length; i++) {
    if (newOrder[i] !== current[i]) {
      changed = true
      break
    }
  }
  if (!changed) return

  commit(
    {
      kind: 'workspace.ship-order',
      summary: `Reordered the fleet (${newOrder.length} ships).`,
    },
    () => {
      workspace.shipOrder.length = 0
      for (const id of newOrder) workspace.shipOrder.push(id)
    },
  )
}

/**
 * v0.9 — Move one ship one slot earlier in `workspace.shipOrder`.
 *
 * No-op if the ship doesn't exist or is already at the head of the order.
 * The summary names both the moved ship and the one it now sails ahead of so
 * the Activity Log reads as a directed change rather than "Lassie moved" with
 * no anchor.
 *
 * @param {string} shipId
 */
export function moveShipUp(shipId) {
  const idx = workspace.shipOrder.indexOf(shipId)
  if (idx <= 0) return
  const ship = workspace.ships[shipId]
  if (!ship) return
  const aboveId = workspace.shipOrder[idx - 1]
  const above = workspace.ships[aboveId]
  if (!above) return

  commit(
    {
      kind: 'workspace.ship-order',
      summary: `Sailed ${ship.name} ahead of ${above.name}.`,
      shipId,
    },
    () => {
      const tmp = workspace.shipOrder[idx - 1]
      workspace.shipOrder[idx - 1] = workspace.shipOrder[idx]
      workspace.shipOrder[idx] = tmp
    },
  )
}

/**
 * v0.9 — Move one ship one slot later in `workspace.shipOrder`.
 *
 * No-op if the ship doesn't exist or is already at the tail of the order.
 * Mirror of `moveShipUp`; the summary names the ship and the one it now
 * sails astern of.
 *
 * @param {string} shipId
 */
export function moveShipDown(shipId) {
  const idx = workspace.shipOrder.indexOf(shipId)
  if (idx < 0 || idx >= workspace.shipOrder.length - 1) return
  const ship = workspace.ships[shipId]
  if (!ship) return
  const belowId = workspace.shipOrder[idx + 1]
  const below = workspace.ships[belowId]
  if (!below) return

  commit(
    {
      kind: 'workspace.ship-order',
      summary: `Sailed ${ship.name} astern of ${below.name}.`,
      shipId,
    },
    () => {
      const tmp = workspace.shipOrder[idx + 1]
      workspace.shipOrder[idx + 1] = workspace.shipOrder[idx]
      workspace.shipOrder[idx] = tmp
    },
  )
}

/**
 * Add a fully-formed Ship (e.g. from a loaded file). Bypasses the factory but still commits.
 * Imported imageStore entries are merged into the workspace image store.
 * @param {import('../domain/types.js').Ship} ship
 * @param {import('../domain/types.js').ImageStore} [imagesFromFile]
 * @param {{ markSaved?: boolean }} [opts]
 */
export function importShip(ship, imagesFromFile = {}, opts = {}) {
  commit(
    {
      kind: 'ship.import',
      summary: `Loaded ${ship.name} from file.`,
      shipId: ship.id,
    },
    () => {
      workspace.ships[ship.id] = ship
      if (!workspace.shipOrder.includes(ship.id)) workspace.shipOrder.push(ship.id)
      Object.assign(workspace.images, imagesFromFile)
      workspace.focusedShipId = ship.id
      if (opts.markSaved) workspace.lastSavedAtByShipId[ship.id] = nowIso()
    },
  )
}

/**
 * Load an entire workspace from a parsed `.shipsync.bundle.json` file
 * (v1.0). Replaces ships, ship order, scene, and image store; stamps
 * every loaded ship as freshly-saved at the bundle's `savedAt` (so
 * "dirty" derivations behave as if the captain had just saved each
 * ship individually).
 *
 * The mutation is a single `commit()` so undo restores whatever was on
 * the dashboard before the bundle landed. We don't issue per-ship log
 * entries here — the bundle's `sessionHistory` for each ship is part
 * of the file payload and adding "imported via bundle" lines on top
 * would clutter the freshly-loaded history. The workspace-level
 * summary is enough breadcrumb to find the import in the Activity Log.
 *
 * @param {{
 *   shipOrder: string[],
 *   ships: Record<string, import('../domain/types.js').Ship>,
 *   scene: import('../domain/types.js').Scene,
 *   images: import('../domain/types.js').ImageStore,
 *   savedAt?: string
 * }} bundle
 * @param {{ replaceMode?: 'replace' }} [opts]
 */
export function loadBundleIntoWorkspace(bundle, opts = {}) {
  void opts // Reserved for a future 'merge' mode; v1.0 only supports replace.
  const shipCount = bundle.shipOrder.length
  const stampedAt = bundle.savedAt || nowIso()
  /** @type {Record<string, string>} */
  const lastSavedAtByShipId = {}
  for (const id of bundle.shipOrder) {
    if (bundle.ships[id]) lastSavedAtByShipId[id] = stampedAt
  }

  commit(
    {
      kind: 'workspace.loadBundle',
      summary:
        shipCount === 0
          ? 'Loaded an empty fleet bundle.'
          : `Loaded a fleet bundle (${shipCount} ${shipCount === 1 ? 'ship' : 'ships'}).`,
    },
    () => {
      replaceWorkspaceWith({
        ships: bundle.ships,
        shipOrder: bundle.shipOrder,
        scene: bundle.scene,
        images: bundle.images,
        lastSavedAtByShipId,
        focusedShipId: bundle.shipOrder[0] ?? null,
        workspaceSessionId: workspace.workspaceSessionId,
      })
    },
  )
}

/**
 * Mark a ship as saved at the given timestamp (or now). Does not commit / undo.
 * @param {string} shipId
 * @param {string} [iso]
 */
export function markShipSaved(shipId, iso = nowIso()) {
  workspace.lastSavedAtByShipId[shipId] = iso
}

/** Clear the entire workspace (used by Reset / for tests). */
export function clearWorkspace() {
  commit({ kind: 'workspace.clear', summary: 'Cleared the dashboard.' }, () => {
    const empty = makeEmptyWorkspace()
    replaceWorkspaceWith(empty)
  })
}

// ---------- Ship-edit mutators (v0.2) ----------
// Each mutator below funnels through commit() so every edit is undoable and
// surfaced in the Activity Log. Image-touching mutators prune any image that
// becomes unreferenced after the change so the workspace store stays lean.

/**
 * Drop any entries from `workspace.images` that are no longer referenced by any
 * ship's portrait, PC portrait, officer portrait, or flag art.
 */
function pruneUnreferencedImages() {
  // Ephemeral local set used only inside this function; never observed reactively.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const referenced = new Set()
  for (const ship of Object.values(workspace.ships)) {
    for (const id of collectImageIds(ship)) referenced.add(id)
  }
  for (const id of Object.keys(workspace.images)) {
    if (!referenced.has(id)) delete workspace.images[id]
  }
}

/**
 * Replace an existing imageId-bearing field with a new data URL (or clear it).
 * Returns the new image id, or null when clearing.
 * The caller is responsible for assigning the returned id back onto the ship.
 */
function commitImageReplacement(dataUrl) {
  if (!dataUrl) return null
  const id = `img-${makeId()}`
  workspace.images[id] = dataUrl
  return id
}

/**
 * Soft cap on the total bytes held in `workspace.images`. We store images as
 * base64 data URLs in-memory, so the limit guards three things at once:
 *   1. localStorage autosave (browsers commonly cap a single origin at 5–10 MB
 *      of synchronously-written storage; once we cross that the autosave
 *      starts silently failing).
 *   2. Save-to-file size — `.shipsync.json` ships every referenced image
 *      embedded in the file, so a fleet with megabytes of photos turns into
 *      a slow re-save and a hostile email attachment.
 *   3. RAM and undo-snapshot size — every commit deep-clones `workspace.images`
 *      into the undo stack twice (before/after).
 *
 * 10 MB lines up with the headroom most browsers give a single localStorage
 * origin and is generous for the player audience (a typical 1024×1024 PNG
 * portrait runs ~600 KB after base64 expansion, so this cap supports ~16
 * portraits — well over a single ship plus its officers).
 */
export const IMAGE_STORE_MAX_BYTES = 10 * 1024 * 1024

/**
 * Public accessor for the current image-store byte total. Used by tests
 * and (eventually) the settings dialog to surface a "you've used X of
 * the cap" hint. Cheap to call (single pass over the in-memory map).
 */
export function imageStoreSizeBytes() {
  return currentImageStoreBytes()
}

/**
 * Total bytes currently held in `workspace.images`. Uses the data-URL string
 * length as a conservative byte estimate (a base64 string is roughly 4/3 the
 * size of the underlying binary it encodes; using `.length` over-counts
 * slightly, which is what we want for a soft cap).
 */
function currentImageStoreBytes() {
  let total = 0
  for (const value of Object.values(workspace.images)) {
    total += value.length
  }
  return total
}

/**
 * Predicate: would assigning `dataUrl` (and dropping `replacingImageId`,
 * if non-null) push the image store past `IMAGE_STORE_MAX_BYTES`?
 *
 * Mirrors what `pruneUnreferencedImages` will eventually do — the replaced
 * image's bytes don't count toward the projected total because pruning
 * removes them right after the commit lands. That keeps replacement uploads
 * (the common case) from failing falsely just because the new bytes
 * temporarily double up with the old.
 *
 * Returns null when the upload fits, or an object with the projected size
 * and the cap so the caller can build a useful toast.
 *
 * @param {string|null} replacingImageId
 * @param {string} dataUrl
 * @returns {{ projectedBytes: number, capBytes: number }|null}
 */
function projectImageStoreOverflow(replacingImageId, dataUrl) {
  const replacingBytes =
    replacingImageId && workspace.images[replacingImageId]
      ? workspace.images[replacingImageId].length
      : 0
  const projectedBytes = currentImageStoreBytes() - replacingBytes + dataUrl.length
  if (projectedBytes <= IMAGE_STORE_MAX_BYTES) return null
  return { projectedBytes, capBytes: IMAGE_STORE_MAX_BYTES }
}

/**
 * Format a byte count as a friendly "8.3 MB" / "740 KB" label for the
 * image-cap toast. Kept local because no other surface needs it yet.
 *
 * @param {number} bytes
 */
function formatBytesShort(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Count how many fields across the workspace point at `imageId`. Used by
 * `setShipFlagArt` to decide whether replacing the art will actually free
 * bytes — flag art can be shared across ships after `applyFlagToShips` runs.
 *
 * @param {string} imageId
 */
function countImageReferences(imageId) {
  let count = 0
  for (const ship of Object.values(workspace.ships)) {
    for (const id of collectImageIds(ship)) {
      if (id === imageId) count++
    }
  }
  return count
}

/**
 * Reject an over-cap upload with a toast. The toast is `warning` rather
 * than `error` because the workspace is still healthy — only this single
 * upload is being declined — and the user has a clear remediation
 * (remove other portraits or use a smaller file).
 *
 * @param {{ projectedBytes: number, capBytes: number }} overflow
 */
function pushImageCapToast(overflow) {
  pushToast({
    kind: 'warning',
    title: 'Image store is full',
    body:
      `Adding this image would push the workspace to ${formatBytesShort(overflow.projectedBytes)}` +
      ` (cap is ${formatBytesShort(overflow.capBytes)}). Remove another portrait or upload a smaller file.`,
  })
}

/** @param {string} shipId */
function getShipOrThrow(shipId) {
  const ship = workspace.ships[shipId]
  if (!ship) throw new Error(`Ship ${shipId} is not in the workspace.`)
  return ship
}

/**
 * Rename a ship.
 * @param {string} shipId
 * @param {string} nextName
 */
export function setShipName(shipId, nextName) {
  const trimmed = String(nextName ?? '').trim()
  if (!trimmed) return
  const ship = getShipOrThrow(shipId)
  if (ship.name === trimmed) return
  const previous = ship.name
  commit(
    {
      kind: 'ship.rename',
      summary: `Renamed ${previous} to ${trimmed}.`,
      shipId,
    },
    () => {
      ship.name = trimmed
    },
  )
}

/**
 * Set a ship's free-text type ("Sloop", "Frigate", ...).
 * @param {string} shipId
 * @param {string} nextType
 */
export function setShipType(shipId, nextType) {
  const trimmed = String(nextType ?? '').trim()
  const ship = getShipOrThrow(shipId)
  if (ship.type === trimmed) return
  commit(
    {
      kind: 'ship.profile',
      summary: trimmed
        ? `Set type to ${trimmed} on ${ship.name}.`
        : `Cleared type on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.type = trimmed
    },
  )
}

/**
 * @param {string} shipId
 * @param {import('../domain/types.js').Mobility} nextMobility
 */
export function setShipMobility(shipId, nextMobility) {
  const ship = getShipOrThrow(shipId)
  if (ship.mobility === nextMobility) return
  commit(
    {
      kind: 'ship.profile',
      summary: `Set mobility to ${nextMobility} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.mobility = nextMobility
    },
  )
}

/**
 * Update either or both speed components in a single commit.
 * Pass `undefined` for any component you don't want to change.
 * @param {string} shipId
 * @param {{ knots?: number, squares?: number }} patch
 */
export function setShipSpeed(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  const nextKnots = patch.knots != null ? Math.max(0, Number(patch.knots) || 0) : ship.speed.knots
  const nextSquares =
    patch.squares != null ? Math.max(0, Number(patch.squares) || 0) : ship.speed.squares
  if (nextKnots === ship.speed.knots && nextSquares === ship.speed.squares) return
  commit(
    {
      kind: 'ship.profile',
      summary: `Set speed to ${nextKnots} kt / ${nextSquares} sq on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.speed = { knots: nextKnots, squares: nextSquares }
    },
  )
}

/**
 * Set HP max. If max drops below current, current is clamped.
 * @param {string} shipId
 * @param {number} hpMax
 */
export function setShipHpMax(shipId, hpMax) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(1, Math.floor(Number(hpMax) || 0))
  if (next === ship.hp.max) return
  const previousMax = ship.hp.max
  const clampedCurrent = Math.min(ship.hp.current, next)
  commit(
    {
      kind: 'ship.hp',
      summary: `Hull max ${previousMax} → ${next} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.hp = { current: clampedCurrent, max: next }
    },
  )
}

/**
 * Set HP current. Clamped to [0, hp.max].
 * @param {string} shipId
 * @param {number} hpCurrent
 */
export function setShipHpCurrent(shipId, hpCurrent) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.min(ship.hp.max, Math.floor(Number(hpCurrent) || 0)))
  if (next === ship.hp.current) return
  const previous = ship.hp.current
  commit(
    {
      kind: 'ship.hp',
      summary: `Hull ${previous} → ${next} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.hp.current = next
    },
  )
}

/**
 * @param {string} shipId
 * @param {number} dc
 */
export function setShipExplosionDC(shipId, dc) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(1, Math.floor(Number(dc) || 0))
  if (next === ship.explosionDC) return
  const previous = ship.explosionDC
  commit(
    {
      kind: 'ship.profile',
      summary: `Explosion DC ${previous} → ${next} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.explosionDC = next
    },
  )
}

/**
 * Patch any subset of weapon slots and/or `heavyEligible` in a single commit.
 * @param {string} shipId
 * @param {Partial<import('../domain/types.js').WeaponSlots>} patch
 */
export function setShipWeapons(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  /** @type {Partial<import('../domain/types.js').WeaponSlots>} */
  const next = {}
  for (const key of /** @type {const} */ (['bow', 'port', 'starboard', 'stern'])) {
    if (patch[key] != null) {
      const value = Math.max(0, Math.floor(Number(patch[key]) || 0))
      if (value !== ship.weapons[key]) next[key] = value
    }
  }
  if (typeof patch.heavyEligible === 'boolean' && patch.heavyEligible !== ship.weapons.heavyEligible) {
    next.heavyEligible = patch.heavyEligible
  }
  if (Object.keys(next).length === 0) return

  const summaryParts = []
  for (const key of /** @type {const} */ (['bow', 'port', 'starboard', 'stern'])) {
    if (next[key] != null) summaryParts.push(`${key} ${ship.weapons[key]} → ${next[key]}`)
  }
  if (next.heavyEligible != null) {
    summaryParts.push(next.heavyEligible ? 'heavy weapons eligible' : 'heavy weapons not eligible')
  }
  commit(
    {
      kind: 'ship.weapons',
      summary: `Weapons on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
    },
    () => {
      Object.assign(ship.weapons, next)
    },
  )
}

/**
 * Update one or more supply tracks (Grub / Grog / Gear) on a ship.
 * Coalesces a multi-track patch into a single commit so e.g. "took on grub
 * and gear after a port stop" reads as one log line.
 *
 * @param {string} shipId
 * @param {Partial<import('../domain/types.js').Supplies>} patch
 */
export function setShipSupplies(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  /** @type {Partial<import('../domain/types.js').Supplies>} */
  const next = {}
  for (const key of /** @type {const} */ (['grub', 'grog', 'gear'])) {
    if (patch[key] != null) {
      const value = Math.max(0, Math.floor(Number(patch[key]) || 0))
      if (value !== ship.supplies[key]) next[key] = value
    }
  }
  if (Object.keys(next).length === 0) return

  const summaryParts = []
  for (const key of /** @type {const} */ (['grub', 'grog', 'gear'])) {
    if (next[key] != null) summaryParts.push(`${key} ${ship.supplies[key]} → ${next[key]}`)
  }
  commit(
    {
      kind: 'ship.supplies',
      summary: `Supplies on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
    },
    () => {
      Object.assign(ship.supplies, next)
    },
  )
}

/**
 * Replace (or set the first) ship portrait. Pass null to clear.
 * @param {string} shipId
 * @param {string|null} dataUrl
 * @returns {boolean} false when the upload was rejected for being over the
 *   image-store cap; true on a successful commit (or a no-op clear).
 */
export function setShipPortrait(shipId, dataUrl) {
  const ship = getShipOrThrow(shipId)
  const replacing = ship.portraitImageId
  const action = dataUrl ? (replacing ? 'Replaced' : 'Added') : 'Removed'
  if (!dataUrl && !replacing) return true
  if (dataUrl) {
    const overflow = projectImageStoreOverflow(replacing, dataUrl)
    if (overflow) {
      pushImageCapToast(overflow)
      return false
    }
  }
  commit(
    {
      kind: 'ship.portrait',
      summary: `${action} portrait on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.portraitImageId = commitImageReplacement(dataUrl)
      pruneUnreferencedImages()
    },
  )
  return true
}

/**
 * Update fields on a single officer station in one commit.
 * `patch` may include name, rank, status. Portrait edits go through
 * setOfficerPortrait so the image store stays consistent.
 * @param {string} shipId
 * @param {import('../domain/types.js').StationKey} station
 * @param {{ name?: string|null, rank?: import('../domain/types.js').OfficerRank, status?: import('../domain/types.js').OfficerStatus }} patch
 */
export function setOfficer(shipId, station, patch) {
  if (!STATIONS.includes(station)) {
    throw new Error(`Unknown officer station: ${station}`)
  }
  const ship = getShipOrThrow(shipId)
  const officer = ship.officers[station]
  /** @type {Record<string, any>} */
  const next = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const trimmed =
      patch.name == null ? null : String(patch.name).trim().length > 0 ? String(patch.name).trim() : null
    if (trimmed !== officer.name) next.name = trimmed
  }
  if (patch.rank != null) {
    const rank = /** @type {import('../domain/types.js').OfficerRank} */ (
      Math.max(1, Math.min(5, Math.floor(Number(patch.rank) || 1)))
    )
    if (rank !== officer.rank) next.rank = rank
  }
  if (patch.status != null && patch.status !== officer.status) {
    next.status = patch.status
  }
  if (Object.keys(next).length === 0) return

  const summaryParts = []
  if ('name' in next) summaryParts.push(`name → ${next.name ?? '(blank)'}`)
  if ('rank' in next) summaryParts.push(`rank ${officer.rank} → ${next.rank}`)
  if ('status' in next) summaryParts.push(`status ${officer.status} → ${next.status}`)

  commit(
    {
      kind: 'officer.update',
      summary: `${STATION_LABELS[station]} on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
    },
    () => {
      Object.assign(ship.officers[station], next)
    },
  )
}

/**
 * v0.7 — Set the free-text "duties / quirks" notes for an officer station.
 * Empty string clears the field. Notes ride along in the ship file.
 * @param {string} shipId
 * @param {import('../domain/types.js').StationKey} station
 * @param {string} notes
 */
export function setOfficerNotes(shipId, station, notes) {
  if (!STATIONS.includes(station)) {
    throw new Error(`Unknown officer station: ${station}`)
  }
  const ship = getShipOrThrow(shipId)
  const officer = ship.officers[station]
  const next = String(notes ?? '')
  if (next === officer.notes) return
  const wasEmpty = !officer.notes || officer.notes.length === 0
  const isEmpty = next.length === 0
  const verb = wasEmpty ? 'Added' : isEmpty ? 'Cleared' : 'Updated'
  commit(
    {
      kind: 'officer.notes',
      summary: `${verb} ${STATION_LABELS[station]} notes on ${ship.name}.`,
      shipId,
    },
    () => {
      officer.notes = next
    },
  )
}

/**
 * Replace an officer's portrait. Pass null to clear.
 * @param {string} shipId
 * @param {import('../domain/types.js').StationKey} station
 * @param {string|null} dataUrl
 * @returns {boolean} false when the upload was rejected for being over the
 *   image-store cap; true on a successful commit (or a no-op clear).
 */
export function setOfficerPortrait(shipId, station, dataUrl) {
  if (!STATIONS.includes(station)) {
    throw new Error(`Unknown officer station: ${station}`)
  }
  const ship = getShipOrThrow(shipId)
  const officer = ship.officers[station]
  const replacing = officer.portraitImageId
  if (!dataUrl && !replacing) return true
  if (dataUrl) {
    const overflow = projectImageStoreOverflow(replacing, dataUrl)
    if (overflow) {
      pushImageCapToast(overflow)
      return false
    }
  }
  const action = dataUrl ? (replacing ? 'Replaced' : 'Added') : 'Removed'
  commit(
    {
      kind: 'officer.portrait',
      summary: `${action} ${STATION_LABELS[station]} portrait on ${ship.name}.`,
      shipId,
    },
    () => {
      officer.portraitImageId = commitImageReplacement(dataUrl)
      pruneUnreferencedImages()
    },
  )
  return true
}

/**
 * Toggle whether a ship has a player-character extension.
 * Adds or removes `ship.playerCharacter`. Removal also cleans up the PC portrait.
 * @param {string} shipId
 * @param {boolean} enabled
 */
export function setPlayerCharacterEnabled(shipId, enabled) {
  const ship = getShipOrThrow(shipId)
  const hasIt = ship.playerCharacter != null
  if (hasIt === enabled) return
  commit(
    {
      kind: 'pc.toggle',
      summary: enabled
        ? `Marked ${ship.name} as a player-character ship.`
        : `Removed player-character extension from ${ship.name}.`,
      shipId,
    },
    () => {
      if (enabled) {
        ship.playerCharacter = {
          characterName: ship.officers.captain.name ?? ship.name,
          traits: '',
          portraitImageId: null,
        }
      } else {
        ship.playerCharacter = null
        pruneUnreferencedImages()
      }
    },
  )
}

/**
 * Patch the player character's name and/or traits.
 * @param {string} shipId
 * @param {{ characterName?: string, traits?: string }} patch
 */
export function setPlayerCharacterFields(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  if (!ship.playerCharacter) return
  const pc = ship.playerCharacter
  /** @type {Record<string, string>} */
  const next = {}
  if (patch.characterName != null) {
    const trimmed = String(patch.characterName).trim() || ship.name
    if (trimmed !== pc.characterName) next.characterName = trimmed
  }
  if (patch.traits != null) {
    const traits = String(patch.traits)
    if (traits !== pc.traits) next.traits = traits
  }
  if (Object.keys(next).length === 0) return

  const summaryParts = []
  if ('characterName' in next) summaryParts.push(`name → ${next.characterName}`)
  if ('traits' in next) summaryParts.push('traits updated')

  commit(
    {
      kind: 'pc.update',
      summary: `Player character on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
    },
    () => {
      Object.assign(pc, next)
    },
  )
}

/**
 * Replace the player character's portrait. Pass null to clear.
 * @param {string} shipId
 * @param {string|null} dataUrl
 * @returns {boolean} false when the upload was rejected for being over the
 *   image-store cap; true on a successful commit (or a no-op clear).
 */
export function setPlayerCharacterPortrait(shipId, dataUrl) {
  const ship = getShipOrThrow(shipId)
  if (!ship.playerCharacter) return true
  const pc = ship.playerCharacter
  const replacing = pc.portraitImageId
  if (!dataUrl && !replacing) return true
  if (dataUrl) {
    const overflow = projectImageStoreOverflow(replacing, dataUrl)
    if (overflow) {
      pushImageCapToast(overflow)
      return false
    }
  }
  const action = dataUrl ? (replacing ? 'Replaced' : 'Added') : 'Removed'
  commit(
    {
      kind: 'pc.portrait',
      summary: `${action} player character portrait on ${ship.name}.`,
      shipId,
    },
    () => {
      pc.portraitImageId = commitImageReplacement(dataUrl)
      pruneUnreferencedImages()
    },
  )
  return true
}

// ---------- Scene mutators (v0.4) ----------
// Scene state is session-scoped: scene ships, weather gage, pursuit, round, phase,
// and wind direction never get written into a `.shipsync.json` (they're not on
// `Ship`). They do ride along in the autosave snapshot so a crash mid-fight can
// be recovered. Boarding is the lone exception — it's a Ship field per v0.4
// product decision, so it persists with the ship and goes through `commit()`.

/**
 * Set the free-text "boarded by" label on a ship. Empty / null clears the field.
 *
 * Locking together two ships in a boarding action zeroes both of their
 * speeds (PDF p. 196 — once the grappling lines are taut neither ship can
 * make way until the boarding ends), so we force `speed.squares` to 0 and
 * flip `sceneFlags.speedZero` on as part of the same atomic commit. When
 * the boarding clears we don't auto-restore speed — the captain chooses
 * whether the ship is dead in the water, drifting, or about to make sail
 * again.
 *
 * @param {string} shipId
 * @param {string|null} value
 */
export function setShipBoardedBy(shipId, value) {
  const ship = getShipOrThrow(shipId)
  const trimmed = value == null ? null : String(value).trim()
  const next = trimmed && trimmed.length > 0 ? trimmed : null
  if (next === ship.boardedBy) return
  const previous = ship.boardedBy
  const willLockSpeed = next != null
  const speedClause = willLockSpeed && (ship.speed?.squares ?? 0) > 0 ? ' Speed locked at 0.' : ''
  commit(
    {
      kind: 'ship.boarding',
      summary:
        next == null
          ? `${ship.name} no longer boarded${previous ? ` by ${previous}` : ''}.`
          : previous
            ? `${ship.name} boarded by ${next} (was ${previous}).${speedClause}`
            : `${ship.name} boarded by ${next}.${speedClause}`,
      shipId,
    },
    () => {
      ship.boardedBy = next
      if (willLockSpeed) {
        if (ship.speed && ship.speed.squares !== 0) ship.speed.squares = 0
        if (ship.sceneFlags && !ship.sceneFlags.speedZero) ship.sceneFlags.speedZero = true
      }
    },
  )
}

/**
 * Add an ephemeral non-player ship to the current scene. Returns the id so callers
 * can immediately focus / edit it.
 * @param {Partial<import('../domain/types.js').SceneShip>} [overrides]
 * @returns {string}
 */
export function addSceneShip(overrides = {}) {
  const sceneShip = makeSceneShip(overrides)
  commit(
    {
      kind: 'scene.shipAdd',
      summary: `Sighted ${sceneShip.name} in the scene.`,
    },
    () => {
      workspace.scene.sceneShips[sceneShip.id] = sceneShip
      workspace.scene.sceneShipOrder.push(sceneShip.id)
    },
  )
  return sceneShip.id
}

/**
 * Remove a scene ship. Also clears the weather-gage pointer and pursuit pointers
 * that referenced this ship, so we never leave a dangling id behind.
 * @param {string} sceneShipId
 */
export function removeSceneShip(sceneShipId) {
  const sceneShip = workspace.scene.sceneShips[sceneShipId]
  if (!sceneShip) return
  commit(
    {
      kind: 'scene.shipRemove',
      summary: `${sceneShip.name} left the scene.`,
    },
    () => {
      delete workspace.scene.sceneShips[sceneShipId]
      workspace.scene.sceneShipOrder = workspace.scene.sceneShipOrder.filter(
        (id) => id !== sceneShipId,
      )
      if (workspace.scene.weatherGageHolderId === sceneShipId) {
        workspace.scene.weatherGageHolderId = null
      }
      if (workspace.scene.pursuit) {
        if (workspace.scene.pursuit.pursuerId === sceneShipId) {
          workspace.scene.pursuit.pursuerId = null
        }
        if (workspace.scene.pursuit.quarryId === sceneShipId) {
          workspace.scene.pursuit.quarryId = null
        }
      }
      if (workspace.scene.shipConditions[sceneShipId]) {
        delete workspace.scene.shipConditions[sceneShipId]
      }
    },
  )
}

/**
 * Patch any subset of a scene ship's fields in a single commit. Numeric fields
 * are coerced and clamped to sensible bounds. HP current is clamped to [0, max].
 * @param {string} sceneShipId
 * @param {Partial<{
 *   name: string,
 *   size: import('../domain/types.js').ShipSize,
 *   mobility: import('../domain/types.js').Mobility,
 *   disposition: import('../domain/types.js').Disposition,
 *   hp: { current?: number, max?: number },
 *   explosionDC: number,
 *   fires: number,
 *   threat: string
 * }>} patch
 */
export function setSceneShip(sceneShipId, patch) {
  const sceneShip = workspace.scene.sceneShips[sceneShipId]
  if (!sceneShip) return

  /** @type {Record<string, unknown>} */
  const next = {}
  /** @type {string[]} */
  const summaryParts = []

  if (patch.name != null) {
    const trimmed = String(patch.name).trim()
    if (trimmed && trimmed !== sceneShip.name) {
      next.name = trimmed
      summaryParts.push(`name → ${trimmed}`)
    }
  }
  if (patch.size != null && SHIP_SIZES.includes(patch.size) && patch.size !== sceneShip.size) {
    next.size = patch.size
    summaryParts.push(`size → ${patch.size}`)
  }
  if (
    patch.mobility != null &&
    MOBILITY_OPTIONS.includes(patch.mobility) &&
    patch.mobility !== sceneShip.mobility
  ) {
    next.mobility = patch.mobility
    summaryParts.push(`mobility → ${patch.mobility}`)
  }
  if (
    patch.disposition != null &&
    ['hostile', 'neutral', 'allied', 'unknown'].includes(patch.disposition) &&
    patch.disposition !== sceneShip.disposition
  ) {
    next.disposition = patch.disposition
    summaryParts.push(`disposition → ${patch.disposition}`)
  }
  if (patch.explosionDC != null) {
    const dc = Math.max(1, Math.floor(Number(patch.explosionDC) || 0))
    if (dc !== sceneShip.explosionDC) {
      next.explosionDC = dc
      summaryParts.push(`explosion DC ${sceneShip.explosionDC} → ${dc}`)
    }
  }
  if (patch.fires != null) {
    const fires = Math.max(0, Math.floor(Number(patch.fires) || 0))
    if (fires !== sceneShip.fires) {
      next.fires = fires
      summaryParts.push(`fires ${sceneShip.fires} → ${fires}`)
    }
  }
  if (patch.threat != null) {
    const threat = String(patch.threat)
    if (threat !== sceneShip.threat) {
      next.threat = threat
      summaryParts.push('threat updated')
    }
  }
  if (patch.hp != null) {
    const max =
      patch.hp.max != null ? Math.max(1, Math.floor(Number(patch.hp.max) || 0)) : sceneShip.hp.max
    let current =
      patch.hp.current != null
        ? Math.max(0, Math.floor(Number(patch.hp.current) || 0))
        : sceneShip.hp.current
    current = Math.min(current, max)
    if (max !== sceneShip.hp.max || current !== sceneShip.hp.current) {
      next.hp = { current, max }
      const parts = []
      if (max !== sceneShip.hp.max) parts.push(`max ${sceneShip.hp.max} → ${max}`)
      if (current !== sceneShip.hp.current) parts.push(`hull ${sceneShip.hp.current} → ${current}`)
      summaryParts.push(parts.join(', '))
    }
  }

  if (Object.keys(next).length === 0) return

  commit(
    {
      kind: 'scene.shipUpdate',
      summary: `${sceneShip.name} (scene): ${summaryParts.join(', ')}.`,
    },
    () => {
      Object.assign(sceneShip, next)
    },
  )
}

/**
 * Set the Weather Gage holder pointer. Accepts a player ship id, a scene ship id,
 * or null (no holder / in irons / drifting).
 * @param {string|null} idOrNull
 */
export function setWeatherGageHolder(idOrNull) {
  const next = idOrNull && String(idOrNull).length > 0 ? String(idOrNull) : null
  if (next === workspace.scene.weatherGageHolderId) return

  const previous = workspace.scene.weatherGageHolderId
  const nextLabel = next ? labelForShipId(next) : 'no holder'
  const previousLabel = previous ? labelForShipId(previous) : 'no holder'
  commit(
    {
      kind: 'scene.weatherGage',
      summary: `Weather Gage: ${previousLabel} → ${nextLabel}.`,
    },
    () => {
      workspace.scene.weatherGageHolderId = next
    },
  )
}

/**
 * Toggle the pursuit tracker on or off. Activating creates a fresh tracker; deactivating
 * clears it (player can re-open later with a new starting state).
 * @param {boolean} active
 */
export function togglePursuit(active) {
  const isActive = workspace.scene.pursuit?.active === true
  if (isActive === active) return
  commit(
    {
      kind: 'scene.pursuitToggle',
      summary: active ? 'Pursuit underway.' : 'Pursuit broken off.',
    },
    () => {
      workspace.scene.pursuit = active ? makePursuit() : null
    },
  )
}

/**
 * Patch the live pursuit tracker. No-op if pursuit isn't active — caller must
 * `togglePursuit(true)` first.
 * @param {Partial<import('../domain/types.js').Pursuit>} patch
 */
export function setPursuit(patch) {
  const pursuit = workspace.scene.pursuit
  if (!pursuit) return

  /** @type {Record<string, unknown>} */
  const next = {}
  /** @type {string[]} */
  const summaryParts = []

  if (Object.prototype.hasOwnProperty.call(patch, 'pursuerId')) {
    const v = patch.pursuerId == null || patch.pursuerId === '' ? null : String(patch.pursuerId)
    if (v !== pursuit.pursuerId) {
      next.pursuerId = v
      summaryParts.push(`pursuer → ${v ? labelForShipId(v) : '(none)'}`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'quarryId')) {
    const v = patch.quarryId == null || patch.quarryId === '' ? null : String(patch.quarryId)
    if (v !== pursuit.quarryId) {
      next.quarryId = v
      summaryParts.push(`quarry → ${v ? labelForShipId(v) : '(none)'}`)
    }
  }
  if (patch.gap != null) {
    const gap = Math.max(0, Math.floor(Number(patch.gap) || 0))
    if (gap !== pursuit.gap) {
      next.gap = gap
      summaryParts.push(`gap ${pursuit.gap} → ${gap}`)
    }
  }
  if (patch.escapeTimer != null) {
    const timer = Math.max(0, Math.floor(Number(patch.escapeTimer) || 0))
    const current = pursuit.escapeTimer ?? 0
    if (timer !== current) {
      next.escapeTimer = timer
      summaryParts.push(`escape timer ${current} → ${timer}`)
    }
  }
  if (patch.escapeCondition != null) {
    const cond = String(patch.escapeCondition)
    if (cond !== pursuit.escapeCondition) {
      next.escapeCondition = cond
      summaryParts.push('escape condition updated')
    }
  }

  if (Object.keys(next).length === 0) return

  commit(
    {
      kind: 'scene.pursuit',
      summary: `Pursuit: ${summaryParts.join(', ')}.`,
    },
    () => {
      Object.assign(pursuit, next)
    },
  )
}

/**
 * Set the scene round counter to an absolute value. Clamped to [0, +∞).
 * The primary round mutator — `advanceRound(delta)` is a thin wrapper for
 * +1/-1 stepper buttons.
 * @param {number} value
 */
export function setSceneRound(value) {
  const next = Math.max(0, Math.floor(Number(value) || 0))
  const previous = workspace.scene.round
  if (next === previous) return
  commit(
    {
      kind: 'scene.round',
      summary: `Round ${previous} → ${next}.`,
    },
    () => {
      workspace.scene.round = next
    },
  )
}

/**
 * Step the scene round counter by `delta` (clamped to ≥ 0 after the step).
 * Pass +1 for "advance", -1 for "retreat" if the player needs to back out
 * of an accidental tap.
 * @param {number} delta
 */
export function advanceRound(delta) {
  const step = Math.trunc(Number(delta) || 0)
  if (step === 0) return
  setSceneRound(workspace.scene.round + step)
}

/**
 * @param {import('../domain/types.js').Phase} phase
 */
export function setScenePhase(phase) {
  if (!['idle', 'movement', 'attack', 'status'].includes(phase)) return
  if (workspace.scene.phase === phase) return
  const previous = workspace.scene.phase
  commit(
    {
      kind: 'scene.phase',
      summary: `Phase ${previous} → ${phase}.`,
    },
    () => {
      workspace.scene.phase = phase
    },
  )
}

/**
 * @param {import('../domain/types.js').Cardinal} direction
 */
export function setSceneWind(direction) {
  if (!CARDINALS.includes(direction)) return
  if (workspace.scene.windDirection === direction) return
  const previous = workspace.scene.windDirection
  commit(
    {
      kind: 'scene.wind',
      summary: `Wind ${previous} → ${direction}.`,
    },
    () => {
      workspace.scene.windDirection = direction
    },
  )
}

/**
 * v0.7 — End the current scene and reset every ephemeral piece of state in
 * one undoable commit:
 *
 *   - round → 0, phase → idle, wind → N
 *   - weather gage holder → cleared
 *   - sighted scene ships → emptied
 *   - pursuit tracker → cleared
 *   - per-ship scene conditions → cleared
 *   - boardedBy on every player ship → cleared (boarding is tactical state
 *     per v0.7 product decision; it doesn't carry over a session break)
 *
 * Persistent ship state (HP, crew, fires, mettle, supplies, persistent
 * conditions, journal) is left alone — the player decides what gets restored
 * between sessions, and conflating persistence boundaries here would be a
 * surprise. The single workspace-level Activity Log entry summarizes what
 * was reset; per-ship Captain's Logs stay untouched until the player
 * explicitly closes a session.
 *
 * No-op when there's nothing to reset (idle scene, no boarding pointers).
 */
export function endScene() {
  const previousRound = workspace.scene.round
  const sceneShipCount = Object.keys(workspace.scene.sceneShips).length
  const sceneConditionCount = Object.values(workspace.scene.shipConditions).reduce(
    (acc, list) => acc + (list?.length ?? 0),
    0,
  )
  const hadPursuit = workspace.scene.pursuit != null
  const hadGageHolder = workspace.scene.weatherGageHolderId != null
  const hadAnyScene =
    previousRound > 0 ||
    workspace.scene.phase !== 'idle' ||
    workspace.scene.windDirection !== 'N' ||
    hadGageHolder ||
    hadPursuit ||
    sceneShipCount > 0 ||
    sceneConditionCount > 0

  /** @type {string[]} */
  const boardedShipIds = []
  /** @type {string[]} */
  const boardedShipNames = []
  for (const id of workspace.shipOrder) {
    const ship = workspace.ships[id]
    if (ship?.boardedBy) {
      boardedShipIds.push(id)
      boardedShipNames.push(ship.name)
    }
  }

  if (!hadAnyScene && boardedShipIds.length === 0) return

  /** @type {string[]} */
  const summaryParts = []
  if (previousRound > 0) summaryParts.push(`was round ${previousRound}`)
  if (sceneShipCount > 0) {
    summaryParts.push(
      `${sceneShipCount} sighted ship${sceneShipCount === 1 ? '' : 's'} dismissed`,
    )
  }
  if (hadPursuit) summaryParts.push('pursuit broken off')
  if (sceneConditionCount > 0) summaryParts.push('scene conditions cleared')
  if (boardedShipNames.length > 0) {
    summaryParts.push(`boarding cleared on ${boardedShipNames.join(', ')}`)
  }
  const summary =
    summaryParts.length > 0 ? `Scene ended (${summaryParts.join('; ')}).` : 'Scene ended.'

  commit(
    {
      kind: 'scene.end',
      summary,
    },
    () => {
      workspace.scene.mode = 'idle'
      workspace.scene.windDirection = 'N'
      workspace.scene.weatherGageHolderId = null
      workspace.scene.round = 0
      workspace.scene.phase = 'idle'
      for (const k of Object.keys(workspace.scene.sceneShips)) {
        delete workspace.scene.sceneShips[k]
      }
      workspace.scene.sceneShipOrder.length = 0
      workspace.scene.pursuit = null
      for (const k of Object.keys(workspace.scene.shipConditions)) {
        delete workspace.scene.shipConditions[k]
      }
      for (const id of boardedShipIds) {
        const ship = workspace.ships[id]
        if (ship) ship.boardedBy = null
      }
    },
  )
}

// ---------- Combat resource mutators (v0.5) ----------
// Mettle, crew, and fires all change rapidly during a fight. Per the v0.5
// product decision, sequential edits to the same resource on the same ship
// inside a single scene round are coalesced into one Activity Log line and
// one undo step. The user-visible summary always reads "from chain-start →
// to latest"; pressing undo unwinds the entire chain back to the round's
// opening state. Crossing a round boundary, switching resource (mettle vs
// fires vs crew current), or any non-coalescing edit in between (e.g. a
// supplies tweak) breaks the chain so the next edit starts a new entry.

/**
 * Build the per-round coalesce key for a combat-resource mutator.
 * Keeps the kind in the key so two mutators in the same round don't merge
 * accidentally (e.g. mettle and fires both at round 3).
 * @param {string} shipId
 * @param {string} kind
 */
function combatResourceCoalesceKey(shipId, kind) {
  return `${kind}|${shipId}|r${workspace.scene.round}`
}

/**
 * Peek at the workspace snapshot captured at the start of the current
 * coalescing chain, if there is one. Returns `null` when this commit is the
 * first in its bucket — caller should fall back to the live state for the
 * "from" value.
 * @param {string|null} coalesceKey
 * @returns {any|null}
 */
function getCoalescedBefore(coalesceKey) {
  if (coalesceKey == null) return null
  const lastEntry = undoStack[undoStack.length - 1]
  if (lastEntry?.coalesceKey === coalesceKey) return lastEntry.before
  return null
}

/**
 * Set Mettle current. Clamped to ≥ 0; no upper bound (baseline + spend can
 * net out higher than baseline if the table rules it). Coalesces per round.
 * @param {string} shipId
 * @param {number} value
 */
export function setShipMettleCurrent(shipId, value) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.floor(Number(value) || 0))
  if (next === ship.mettle.current) return

  const coalesceKey = combatResourceCoalesceKey(shipId, 'ship.mettle')
  const chainBefore = getCoalescedBefore(coalesceKey)
  const fromValue = chainBefore?.ships?.[shipId]?.mettle?.current ?? ship.mettle.current

  commit(
    {
      kind: 'ship.mettle',
      summary: `Mettle ${fromValue} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.mettle.current = next
    },
  )
}

/**
 * Replace the free-text Mettle notes. No coalescing — notes are typed prose
 * and commit on blur; long pauses between edits are intentional.
 * @param {string} shipId
 * @param {string} notes
 */
export function setShipMettleNotes(shipId, notes) {
  const ship = getShipOrThrow(shipId)
  const next = String(notes ?? '')
  if (next === ship.mettle.notes) return
  commit(
    {
      kind: 'ship.mettleNotes',
      summary: next.trim().length > 0
        ? `Updated mettle notes on ${ship.name}.`
        : `Cleared mettle notes on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.mettle.notes = next
    },
  )
}

/**
 * Set the number of fires burning on the player ship. Clamped to ≥ 0.
 * Coalesces per round so a flurry of "+1 fire / +1 fire / -1 fire" reads as
 * one log line.
 * @param {string} shipId
 * @param {number} count
 */
export function setShipFires(shipId, count) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.floor(Number(count) || 0))
  if (next === ship.fires) return

  const coalesceKey = combatResourceCoalesceKey(shipId, 'ship.fires')
  const chainBefore = getCoalescedBefore(coalesceKey)
  const fromValue = chainBefore?.ships?.[shipId]?.fires ?? ship.fires

  commit(
    {
      kind: 'ship.fires',
      summary: `Fires ${fromValue} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.fires = next
    },
  )
}

/**
 * Set crew.current. Clamped to [0, crew.max]. Coalesces per round so a wave
 * of casualties on the same round shows up as one entry.
 * @param {string} shipId
 * @param {number} value
 */
export function setShipCrewCurrent(shipId, value) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.min(ship.crew.max, Math.floor(Number(value) || 0)))
  if (next === ship.crew.current) return

  const coalesceKey = combatResourceCoalesceKey(shipId, 'ship.crewCurrent')
  const chainBefore = getCoalescedBefore(coalesceKey)
  const fromValue = chainBefore?.ships?.[shipId]?.crew?.current ?? ship.crew.current

  commit(
    {
      kind: 'ship.crewCurrent',
      summary: `Crew ${fromValue} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.crew.current = next
    },
  )
}

/**
 * Set crew.max. If max drops below current, current is clamped down to match.
 * Not coalesced — ship rosters change at port (refit / recruitment), not in
 * the middle of a round.
 * @param {string} shipId
 * @param {number} value
 */
export function setShipCrewMax(shipId, value) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(1, Math.floor(Number(value) || 0))
  if (next === ship.crew.max) return
  const previousMax = ship.crew.max
  const clampedCurrent = Math.min(ship.crew.current, next)
  commit(
    {
      kind: 'ship.crewMax',
      summary: `Crew max ${previousMax} → ${next} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.crew.max = next
      ship.crew.current = clampedCurrent
    },
  )
}

/**
 * Set crew.skeleton — the threshold below which the ship is short-handed.
 * Clamped to [0, crew.max]. Not coalesced (config-style edit).
 * @param {string} shipId
 * @param {number} value
 */
export function setShipCrewSkeleton(shipId, value) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.min(ship.crew.max, Math.floor(Number(value) || 0)))
  if (next === ship.crew.skeleton) return
  const previous = ship.crew.skeleton
  commit(
    {
      kind: 'ship.crewSkeleton',
      summary: `Skeleton crew mark ${previous} → ${next} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.crew.skeleton = next
    },
  )
}

// ---------- Damage / repair composers (v0.8) ----------
// At the table the same combat event usually hits multiple resources at once
// — a broadside might shave hull, rattle Mettle, ignite a fire, and shred a
// few crew. Threading those through four separate stepper commits clutters
// the Activity Log and bloats the undo stack. The composers below take a
// `damages` (or `repair`) object plus an optional source string and produce
// a single coalesced commit with one human-readable summary line.
//
// We deliberately avoid `coalesceKey` here: each composer "Apply" press is a
// discrete, intentional event, not a stepper flurry. One commit per press,
// one undo step per press.

/**
 * Apply a multi-resource damage event in a single commit.
 *
 * `damages` accepts positive integers for each resource being reduced
 * (`hull`, `mettle`, `crew`) plus `fires` for new fires igniting. Any field
 * may be omitted or zero; if every field is zero (after coercion + clamping
 * against the ship's current values), the call is a no-op and no log entry
 * is created.
 *
 * Hull, Mettle, and Crew are clamped at 0 (a ship can't take negative damage
 * past zero). Fires has no upper bound — the rules don't define one and the
 * UI surfaces fires as a free count.
 *
 * `source` is an optional free-text descriptor that appears parenthetically
 * in the log summary (e.g. "Black Spear broadside"). Whitespace-only
 * sources are treated as absent.
 *
 * @param {string} shipId
 * @param {{ hull?: number, mettle?: number, crew?: number, fires?: number }} damages
 * @param {string} [source]
 */
export function applyCombatDamage(shipId, damages = {}, source = '') {
  const ship = getShipOrThrow(shipId)

  const requestedHull = Math.max(0, Math.floor(Number(damages.hull) || 0))
  const requestedMettle = Math.max(0, Math.floor(Number(damages.mettle) || 0))
  const requestedCrew = Math.max(0, Math.floor(Number(damages.crew) || 0))
  const requestedFires = Math.max(0, Math.floor(Number(damages.fires) || 0))

  const appliedHull = Math.min(requestedHull, ship.hp.current)
  const appliedMettle = Math.min(requestedMettle, ship.mettle.current)
  const appliedCrew = Math.min(requestedCrew, ship.crew.current)
  const appliedFires = requestedFires

  if (appliedHull === 0 && appliedMettle === 0 && appliedCrew === 0 && appliedFires === 0) {
    return
  }

  const summary = composeDamageSummary(
    {
      hull: appliedHull,
      mettle: appliedMettle,
      crew: appliedCrew,
      fires: appliedFires,
    },
    ship.name,
    source,
  )
  if (summary == null) return

  commit(
    {
      kind: 'ship.damage',
      summary,
      shipId,
    },
    () => {
      ship.hp.current = Math.max(0, ship.hp.current - appliedHull)
      ship.mettle.current = Math.max(0, ship.mettle.current - appliedMettle)
      ship.crew.current = Math.max(0, ship.crew.current - appliedCrew)
      ship.fires = ship.fires + appliedFires
    },
  )
}

/**
 * Apply a hull repair (and optional supply costs) in a single commit.
 *
 * `hullRestored` is a positive integer; it is clamped so current HP can't
 * exceed `ship.hp.max`. `costs.grub`/`grog`/`gear` are positive consumption
 * values clamped at the ship's current supply level (you can't spend more
 * grog than you have).
 *
 * If neither hull is actually restored nor any supplies actually consumed
 * (e.g. the ship is already at full HP and no costs were entered), the call
 * is a no-op.
 *
 * @param {string} shipId
 * @param {number} hullRestored
 * @param {{ grub?: number, grog?: number, gear?: number }} costs
 * @param {string} [source]
 */
export function applyRepair(shipId, hullRestored = 0, costs = {}, source = '') {
  const ship = getShipOrThrow(shipId)

  const requestedHull = Math.max(0, Math.floor(Number(hullRestored) || 0))
  const headroom = Math.max(0, ship.hp.max - ship.hp.current)
  const appliedHull = Math.min(requestedHull, headroom)

  const requestedGrub = Math.max(0, Math.floor(Number(costs.grub) || 0))
  const requestedGrog = Math.max(0, Math.floor(Number(costs.grog) || 0))
  const requestedGear = Math.max(0, Math.floor(Number(costs.gear) || 0))

  const appliedGrub = Math.min(requestedGrub, ship.supplies.grub)
  const appliedGrog = Math.min(requestedGrog, ship.supplies.grog)
  const appliedGear = Math.min(requestedGear, ship.supplies.gear)

  if (appliedHull === 0 && appliedGrub === 0 && appliedGrog === 0 && appliedGear === 0) {
    return
  }

  const summary = composeRepairSummary(
    appliedHull,
    { grub: appliedGrub, grog: appliedGrog, gear: appliedGear },
    ship.name,
    source,
  )
  if (summary == null) return

  commit(
    {
      kind: 'ship.repair',
      summary,
      shipId,
    },
    () => {
      ship.hp.current = Math.min(ship.hp.max, ship.hp.current + appliedHull)
      ship.supplies.grub = Math.max(0, ship.supplies.grub - appliedGrub)
      ship.supplies.grog = Math.max(0, ship.supplies.grog - appliedGrog)
      ship.supplies.gear = Math.max(0, ship.supplies.gear - appliedGear)
    },
  )
}

/**
 * v0.9 Shore Leave — apply a tunable refit across one or more player ships in
 * a SINGLE undo step. Unlike `applyRepair`, supplies are *added* (the ships
 * took on stores at port) and there's no upper bound on supply totals; only
 * hull is clamped, against each ship's individual `hp.max`. Optionally clears
 * each affected ship's scene conditions (the per-ship `boardedBy` flag is
 * left alone — that's `endScene`'s job).
 *
 * The whole batch lives on one entry of the undo stack so a single Cmd+Z
 * unwinds the entire shore leave. The Activity Log gets one workspace-level
 * summary; each affected ship's Captain's Log gets its own per-ship line via
 * direct `appendShipLog` calls (intentionally bypassing `commit`'s built-in
 * auto-logger, which only knows how to attach to one ship at a time).
 *
 * Behavior:
 *   - Unknown ship ids are silently filtered out (defensive against stale
 *     selection state from a dialog left open during a fleet edit).
 *   - Duplicate ids are deduped, preserving caller order.
 *   - "Meaningful" per-ship guard: a ship that's already at full HP, gets
 *     no positive supply additions, and has no scene conditions to clear is
 *     dropped from the batch — keeps the log clean and matches the no-op
 *     conventions of applyRepair / applyCombatDamage.
 *   - If no ship would receive a meaningful change, the entire call is a
 *     no-op (no commit, no log entries, no undo step).
 *
 * @param {string[]} shipIds
 * @param {{ hull?: number, grub?: number, grog?: number, gear?: number }} deltas
 * @param {{ clearSceneConditions?: boolean }} [options]
 * @param {string} [source]
 */
export function applyShoreLeave(shipIds, deltas = {}, options = {}, source = '') {
  if (!Array.isArray(shipIds) || shipIds.length === 0) return

  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seen = new Set()
  /** @type {string[]} */
  const validIds = []
  for (const id of shipIds) {
    if (typeof id !== 'string' || seen.has(id)) continue
    if (!workspace.ships[id]) continue
    seen.add(id)
    validIds.push(id)
  }
  if (validIds.length === 0) return

  const requestedHull = Math.max(0, Math.floor(Number(deltas.hull) || 0))
  const requestedGrub = Math.max(0, Math.floor(Number(deltas.grub) || 0))
  const requestedGrog = Math.max(0, Math.floor(Number(deltas.grog) || 0))
  const requestedGear = Math.max(0, Math.floor(Number(deltas.gear) || 0))
  const clearScene = options.clearSceneConditions === true

  /**
   * Per-ship effective changes, computed up front so the commit callback can
   * apply them directly and the post-commit log loop can reuse the same
   * numbers without re-clamping.
   * @type {Array<{
   *   id: string,
   *   ship: import('../domain/types.js').Ship,
   *   appliedHull: number,
   *   appliedGrub: number,
   *   appliedGrog: number,
   *   appliedGear: number,
   *   willClearScene: boolean,
   * }>}
   */
  const planned = []
  for (const id of validIds) {
    const ship = workspace.ships[id]
    const headroom = Math.max(0, ship.hp.max - ship.hp.current)
    const appliedHull = Math.min(requestedHull, headroom)
    const sceneList = workspace.scene.shipConditions[id] ?? []
    const willClearScene = clearScene && sceneList.length > 0

    const meaningful =
      appliedHull > 0 ||
      requestedGrub > 0 ||
      requestedGrog > 0 ||
      requestedGear > 0 ||
      willClearScene
    if (!meaningful) continue

    planned.push({
      id,
      ship,
      appliedHull,
      appliedGrub: requestedGrub,
      appliedGrog: requestedGrog,
      appliedGear: requestedGear,
      willClearScene,
    })
  }

  if (planned.length === 0) return

  const trimmedSource = String(source ?? '').trim()
  const sourceClause = trimmedSource ? ` (${trimmedSource})` : ''
  const shipNames = planned.map((p) => p.ship.name)
  // Three-name threshold mirrors the natural read-aloud length: "Lassie,
  // Black Pearl, Interceptor" stays scannable; four+ collapses to a count
  // and defers the per-ship details to each Captain's Log.
  const workspaceSummary =
    shipNames.length <= 3
      ? `Shore leave on ${shipNames.join(', ')}${sourceClause}.`
      : `Shore leave across ${shipNames.length} ships${sourceClause}.`

  commit(
    {
      kind: 'workspace.shore-leave',
      summary: workspaceSummary,
    },
    () => {
      for (const p of planned) {
        const ship = p.ship
        if (p.appliedHull > 0) {
          ship.hp.current = Math.min(ship.hp.max, ship.hp.current + p.appliedHull)
        }
        if (p.appliedGrub > 0) ship.supplies.grub = ship.supplies.grub + p.appliedGrub
        if (p.appliedGrog > 0) ship.supplies.grog = ship.supplies.grog + p.appliedGrog
        if (p.appliedGear > 0) ship.supplies.gear = ship.supplies.gear + p.appliedGear
        if (p.willClearScene) {
          delete workspace.scene.shipConditions[p.id]
        }
      }
    },
  )

  // Per-ship Captain's-Log entries. Manual appendShipLog (rather than
  // multiple commit() calls) keeps the whole shore leave on one undo step
  // while still surfacing per-ship details where the captain reads them.
  // These appended entries persist with the ship via autosave snapshot but
  // are intentionally NOT in the undo stack; they share the redo-gap caveat
  // with single-ship commits — same trade-off, same precedent.
  for (const p of planned) {
    const perShipSummary = composeShoreLeaveSummary(
      {
        hull: p.appliedHull,
        grub: p.appliedGrub,
        grog: p.appliedGrog,
        gear: p.appliedGear,
      },
      { clearSceneConditions: p.willClearScene },
      p.ship.name,
      source,
    )
    if (perShipSummary == null) continue
    appendShipLog(p.id, {
      id: makeId(),
      timestamp: nowIso(),
      kind: 'ship.shore-leave',
      summary: perShipSummary,
      shipId: p.id,
      before: {},
      after: {},
    })
  }
}

// ---------- Flag mutators (v0.5) ----------
// §3 reputation is per-flag, not per-ship — when you raise The Black Spear on
// a second hull, that hull inherits the rep your first hull earned. We model
// this by replicating the flag *instance* on each ship that flies it, with the
// reputation field synchronized across all instances. Other fields (name,
// isFalse, isPirate, art) stay per-ship: one captain might fly the same flag
// false, another might keep their colors true; one might commission a fancier
// banner than the other.
//
// Conflict detection (`flagConflicts.js`) catches the case where ship files
// loaded from disk disagree on a flag's reputation; our mutators here keep the
// in-workspace state in sync so that case only arises across loads, not edits.

/**
 * Find a flag instance on a ship, looking through both `flown` and `known`.
 * Returns null if no match. The same flag id can't appear twice on one ship
 * (we de-dupe in `addShipFlag`), so the first match is the only match.
 * @param {import('../domain/types.js').Ship} ship
 * @param {string} flagId
 * @returns {import('../domain/types.js').Flag|null}
 */
function findFlagOnShip(ship, flagId) {
  for (const f of ship.flags?.flown ?? []) if (f.id === flagId) return f
  for (const f of ship.flags?.known ?? []) if (f.id === flagId) return f
  return null
}

/**
 * Find any existing copy of a flag id elsewhere in the workspace, for
 * inheritance purposes when raising the flag on a new hull.
 * @param {string} flagId
 * @returns {import('../domain/types.js').Flag|null}
 */
function findFlagAnywhere(flagId) {
  for (const ship of Object.values(workspace.ships)) {
    const found = findFlagOnShip(ship, flagId)
    if (found) return found
  }
  return null
}

/**
 * Push a new flag onto a ship's `flown` list. If the ship already has the
 * flag id (in flown or known), no-op and return the existing id. If another
 * ship in the workspace flies the same id, the new copy inherits its
 * four-axis reputation so rep stays per-flag.
 *
 * @param {string} shipId
 * @param {Partial<import('../domain/types.js').Flag>} input
 * @returns {string} the flag id (new or existing)
 */
export function addShipFlag(shipId, input = {}) {
  const ship = getShipOrThrow(shipId)
  const id = input.id ?? makeId()

  if (findFlagOnShip(ship, id)) return id

  /** @type {import('../domain/types.js').Reputation} */
  const inheritedRep =
    input.reputation != null
      ? normalizeReputation(input.reputation)
      : normalizeReputation(findFlagAnywhere(id)?.reputation)

  /** @type {import('../domain/types.js').Flag} */
  const flag = {
    id,
    name: input.name?.trim() || 'Untitled flag',
    isFalse: input.isFalse === true,
    isPirate: input.isPirate === true,
    isFaction: input.isFaction === true,
    artImageId: null,
    reputation: inheritedRep,
  }

  commit(
    {
      kind: 'ship.flagAdd',
      summary: `Raised flag ${flag.name} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.flags.flown.push(flag)
      if (!ship.flags.flyingId) {
        ship.flags.flyingId = flag.id
      }
    },
  )

  return id
}

/**
 * Patch a flag's per-ship fields, with `reputation` propagated workspace-wide
 * across every other ship that flies (or knows) the same flag id.
 *
 * Name / isFalse / isPirate / isFaction stay per-ship — one captain might fly
 * The Black Spear as a false flag while another flies it openly, and that's
 * a feature. Reputation is the four-axis tally (PDF p. 200): callers can
 * patch any subset of axes (`{ reputation: { good: 3 } }`) without touching
 * the others; missing axes preserve their current value.
 *
 * @param {string} shipId
 * @param {string} flagId
 * @param {Partial<import('../domain/types.js').Flag> & { reputation?: Partial<import('../domain/types.js').Reputation> | number }} patch
 */
export function setShipFlag(shipId, flagId, patch) {
  const ship = getShipOrThrow(shipId)
  const flag = findFlagOnShip(ship, flagId)
  if (!flag) return

  /** @type {Record<string, unknown>} */
  const next = {}
  /** @type {string[]} */
  const summaryParts = []

  if (patch.name != null) {
    const trimmed = String(patch.name).trim() || flag.name
    if (trimmed !== flag.name) {
      next.name = trimmed
      summaryParts.push(`name → ${trimmed}`)
    }
  }
  if (typeof patch.isFalse === 'boolean' && patch.isFalse !== flag.isFalse) {
    next.isFalse = patch.isFalse
    summaryParts.push(patch.isFalse ? 'flying false' : 'flying true')
  }
  if (typeof patch.isPirate === 'boolean' && patch.isPirate !== flag.isPirate) {
    next.isPirate = patch.isPirate
    summaryParts.push(patch.isPirate ? 'marked pirate' : 'no longer pirate')
  }
  if (typeof patch.isFaction === 'boolean' && patch.isFaction !== flag.isFaction) {
    next.isFaction = patch.isFaction
    summaryParts.push(patch.isFaction ? 'marked faction' : 'no longer faction')
  }
  if (patch.reputation != null) {
    const current = normalizeReputation(flag.reputation)
    /** @type {import('../domain/types.js').Reputation} */
    const desired = { ...current }
    if (typeof patch.reputation === 'number') {
      desired.good = Math.max(0, Math.floor(patch.reputation))
    } else {
      for (const axis of REPUTATION_AXES) {
        const v = /** @type {any} */ (patch.reputation)[axis]
        if (typeof v === 'number' && Number.isFinite(v)) {
          desired[axis] = Math.max(0, Math.floor(v))
        }
      }
    }
    if (!reputationsEqual(current, desired)) {
      next.reputation = desired
      const changed = REPUTATION_AXES.filter((axis) => current[axis] !== desired[axis])
      if (changed.length === 1) {
        const axis = changed[0]
        summaryParts.push(
          `${REPUTATION_AXIS_LABELS[axis]} reputation ${current[axis]} → ${desired[axis]}`,
        )
      } else {
        const before = REPUTATION_AXES.reduce((sum, axis) => sum + current[axis], 0)
        const after = REPUTATION_AXES.reduce((sum, axis) => sum + desired[axis], 0)
        summaryParts.push(`reputation ${before} → ${after}`)
      }
    }
  }

  if (Object.keys(next).length === 0) return

  commit(
    {
      kind: 'ship.flagUpdate',
      summary: `Flag ${flag.name} on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
    },
    () => {
      Object.assign(flag, next)
      if (next.reputation != null) {
        const rep = /** @type {import('../domain/types.js').Reputation} */ (next.reputation)
        for (const other of Object.values(workspace.ships)) {
          if (other.id === ship.id) continue
          for (const f of other.flags?.flown ?? []) {
            if (f.id === flagId) f.reputation = { ...rep }
          }
          for (const f of other.flags?.known ?? []) {
            if (f.id === flagId) f.reputation = { ...rep }
          }
        }
      }
    },
  )
}

/**
 * Pull a flag off a ship's flown list. If the flag had art, the image is
 * pruned from the workspace store iff no other ship still references it.
 * If the removed flag was the flying one, the flyingId pivots to whatever
 * remains (or null when no flags are left).
 *
 * Other ships keep their copy of the flag — rep follows the player; struck
 * colors only mean "this hull isn't currently flying it."
 *
 * @param {string} shipId
 * @param {string} flagId
 */
export function removeShipFlag(shipId, flagId) {
  const ship = getShipOrThrow(shipId)
  const idx = ship.flags?.flown?.findIndex((f) => f.id === flagId) ?? -1
  if (idx < 0) return
  const flag = ship.flags.flown[idx]

  commit(
    {
      kind: 'ship.flagRemove',
      summary: `Lowered flag ${flag.name} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.flags.flown.splice(idx, 1)
      if (ship.flags.flyingId === flagId) {
        ship.flags.flyingId = ship.flags.flown[0]?.id ?? null
      }
      pruneUnreferencedImages()
    },
  )
}

/**
 * Pick which of the flown flags is currently being flown. Pass null to strike
 * colors entirely. The id must already be in `flown` — passing an unknown id
 * is a silent no-op (the picker UI never offers anything outside flown).
 * @param {string} shipId
 * @param {string|null} flagId
 */
export function setShipFlagFlying(shipId, flagId) {
  const ship = getShipOrThrow(shipId)
  const next = flagId == null || flagId === '' ? null : flagId
  if (next != null && !ship.flags.flown.some((f) => f.id === next)) return
  if (next === ship.flags.flyingId) return

  const previousId = ship.flags.flyingId
  const previousName = previousId ? findFlagOnShip(ship, previousId)?.name ?? null : null
  const nextName = next ? findFlagOnShip(ship, next)?.name ?? null : null

  commit(
    {
      kind: 'ship.flagFlying',
      summary:
        next == null
          ? `Struck colors on ${ship.name}${previousName ? ` (was ${previousName})` : ''}.`
          : `Flying ${nextName ?? next} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.flags.flyingId = next
    },
  )
}

/**
 * Replace flag art on a single ship. Art does NOT propagate — each captain's
 * banner is their own. Pass null to clear.
 *
 * Note on the cap pre-check: `applyFlagToShips` shares the same `artImageId`
 * across copied flags (art is copied by reference, not duplicated). When the
 * replaced art is still referenced by at least one other flag we don't
 * subtract its bytes, since pruning won't free them — we want the cap to
 * reject the upload before the image-store actually overflows.
 *
 * @param {string} shipId
 * @param {string} flagId
 * @param {string|null} dataUrl
 * @returns {boolean} false when the upload was rejected for being over the
 *   image-store cap; true on a successful commit (or a no-op clear).
 */
export function setShipFlagArt(shipId, flagId, dataUrl) {
  const ship = getShipOrThrow(shipId)
  const flag = findFlagOnShip(ship, flagId)
  if (!flag) return true
  const replacing = flag.artImageId
  if (!dataUrl && !replacing) return true
  if (dataUrl) {
    const replacingFreesBytes =
      replacing != null && countImageReferences(replacing) <= 1
    const overflow = projectImageStoreOverflow(
      replacingFreesBytes ? replacing : null,
      dataUrl,
    )
    if (overflow) {
      pushImageCapToast(overflow)
      return false
    }
  }
  const action = dataUrl ? (replacing ? 'Replaced' : 'Added') : 'Removed'
  commit(
    {
      kind: 'ship.flagArt',
      summary: `${action} art for flag ${flag.name} on ${ship.name}.`,
      shipId,
    },
    () => {
      flag.artImageId = commitImageReplacement(dataUrl)
      pruneUnreferencedImages()
    },
  )
  return true
}

/**
 * v0.9 — Copy a flag from one ship onto one or more target ships in a single
 * undoable step ("apply this flag to..."). Each copy gets a fresh flag id, so
 * the new instances are independent of the source — bumping reputation on the
 * source's "Black Spear" later will NOT bump it on the copies. Art is copied
 * by reference (shares the same `artImageId` from the workspace image store);
 * the next time anyone edits art on either flag, the editing path generates a
 * fresh image id so the other side stays put.
 *
 * Dedup-by-name: if any target already has a flown flag with the same name
 * (case- and whitespace-insensitive) as the source, that target is skipped
 * silently and reported back to the caller. The dialog uses this to toast
 * "Skipped N ship(s) — already flying X." rather than fail the whole batch.
 *
 * Mirrors `applyShoreLeave`: one workspace-level commit so the whole apply
 * is a single undo step, then per-ship Captain's-Log entries appended after
 * the snapshot for narrative detail. (Same redo-gap caveat as shore leave —
 * the appended log lines ride along in autosave but are not re-applied by
 * a redo of the workspace commit.)
 *
 * @param {string} sourceShipId
 * @param {string} sourceFlagId
 * @param {string[]} targetShipIds
 * @param {{ raiseOnTargets?: boolean }} [options]
 *   - raiseOnTargets: if true, set the new flag as each target's flying flag.
 *     If false, the flag is appended to `flown` but the target keeps whatever
 *     it was already flying (or the new flag becomes flying iff the target
 *     wasn't flying anything yet, mirroring `addShipFlag`).
 * @returns {{ applied: string[], skipped: string[] }}
 *   - applied: target ship ids that received a copy.
 *   - skipped: target ship ids skipped due to name collision. Useful for
 *     surfacing a "skipped N" toast in the calling UI.
 */
export function applyFlagToShips(sourceShipId, sourceFlagId, targetShipIds, options = {}) {
  const source = workspace.ships[sourceShipId]
  if (!source) return { applied: [], skipped: [] }
  const sourceFlag = findFlagOnShip(source, sourceFlagId)
  if (!sourceFlag) return { applied: [], skipped: [] }

  if (!Array.isArray(targetShipIds)) return { applied: [], skipped: [] }

  // Filter targets: typed string, exists in workspace, not the source itself,
  // de-duplicated. Anything that fails any of these silently drops out.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seen = new Set([sourceShipId])
  /** @type {string[]} */
  const validTargets = []
  for (const id of targetShipIds) {
    if (typeof id !== 'string') continue
    if (seen.has(id)) continue
    if (!workspace.ships[id]) continue
    seen.add(id)
    validTargets.push(id)
  }
  if (validTargets.length === 0) return { applied: [], skipped: [] }

  // Name dedup: case-insensitive, whitespace-trimmed comparison so "Black
  // Spear" and "  black spear " count as the same banner. The source's name
  // is the key; we don't compare against any other flags on the source.
  const sourceNameKey = sourceFlag.name.trim().toLowerCase()
  /** @type {string[]} */
  const applied = []
  /** @type {string[]} */
  const skipped = []
  for (const id of validTargets) {
    const ship = workspace.ships[id]
    const clash = (ship.flags?.flown ?? []).some(
      (f) => f.name.trim().toLowerCase() === sourceNameKey,
    )
    if (clash) skipped.push(id)
    else applied.push(id)
  }

  if (applied.length === 0) {
    return { applied, skipped }
  }

  const raiseOnTargets = options.raiseOnTargets === true

  // Pre-build the per-ship flag instances so the commit closure is a flat
  // assignment loop and the post-commit log loop can read the same ids.
  /** @type {Map<string, import('../domain/types.js').Flag>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const newFlagByShip = new Map()
  for (const id of applied) {
    newFlagByShip.set(id, {
      id: makeId(),
      name: sourceFlag.name,
      isFalse: sourceFlag.isFalse,
      isPirate: sourceFlag.isPirate,
      isFaction: sourceFlag.isFaction === true,
      artImageId: sourceFlag.artImageId,
      // Deep-copy the reputation so future bumps on the source don't bleed
      // back into the copies (see the docstring above — the new instances
      // are intentionally independent).
      reputation: { ...normalizeReputation(sourceFlag.reputation) },
    })
  }

  const flagName = sourceFlag.name
  const sourceShipName = source.name
  const targetNames = applied.map((id) => workspace.ships[id].name)
  // Three-name threshold matches the shore-leave summary so workspace log
  // lines read consistently for multi-ship actions.
  const summarizedTargets =
    targetNames.length <= 3 ? targetNames.join(', ') : `${targetNames.length} ships`
  const workspaceSummary = `Copied flag ${flagName} from ${sourceShipName} to ${summarizedTargets}.`

  commit(
    {
      kind: 'workspace.flagApply',
      summary: workspaceSummary,
    },
    () => {
      for (const [id, newFlag] of newFlagByShip) {
        const ship = workspace.ships[id]
        ship.flags.flown.push(newFlag)
        if (raiseOnTargets || ship.flags.flyingId == null) {
          ship.flags.flyingId = newFlag.id
        }
      }
    },
  )

  // Per-ship narrative entries — same precedent as applyShoreLeave: keep the
  // batch on one undo step while still surfacing per-ship detail in each
  // Captain's Log.
  for (const id of applied) {
    const newFlag = newFlagByShip.get(id)
    if (!newFlag) continue
    const ship = workspace.ships[id]
    const becameFlying = ship.flags.flyingId === newFlag.id
    const verb = becameFlying ? 'Raised' : 'Stowed'
    appendShipLog(id, {
      id: makeId(),
      timestamp: nowIso(),
      kind: 'ship.flagAdd',
      summary: `${verb} flag ${flagName} on ${ship.name} (from ${sourceShipName}).`,
      shipId: id,
      before: {},
      after: {},
    })
  }

  return { applied, skipped }
}

// ---------- Ship condition mutators (v0.6) ----------
// Conditions split by persistence:
//  - Persistent conditions (`listing`, `surrendered`) live on the player
//    Ship and ride along in `.shipsync.json`. `surrendered` lines up with
//    Strike Colors / Surrender on PDF page 190; `listing` is a ShipSync
//    house-rule chip for hulls that have been hit hard.
//  - Scene conditions (`heeling`, `in-irons`, `crossing-t`) live in
//    `workspace.scene.shipConditions[shipId]` and ride along only in the
//    autosave snapshot. They describe tactical positioning / wind state
//    defined on PDF page 187; loading a fresh workspace clears them.
//
// Player ships can carry both kinds at once (e.g. listing AND in irons).
// Scene ships can only carry scene conditions — they're ephemeral by
// definition, and persistent state on a non-player hull would never be read.

/**
 * Toggle (or explicitly set) a persistent condition on a player ship. The
 * change rides along in the ship's `.shipsync.json` on the next save, so it's
 * still in effect the next time the file loads.
 *
 * @param {string} shipId
 * @param {import('../domain/types.js').PersistentShipCondition} condition
 * @param {boolean} on
 */
export function setShipPersistentCondition(shipId, condition, on) {
  const ship = getShipOrThrow(shipId)
  if (!Array.isArray(ship.conditions)) ship.conditions = []
  const has = ship.conditions.includes(condition)
  if (on === has) return

  const label = formatConditionLabel(condition)
  commit(
    {
      kind: 'ship.condition',
      summary: on
        ? `${ship.name} marked ${label}.`
        : `${ship.name} no longer ${label}.`,
      shipId,
    },
    () => {
      if (on) {
        ship.conditions.push(condition)
      } else {
        ship.conditions = ship.conditions.filter((c) => c !== condition)
      }
    },
  )
}

/**
 * Toggle a scene-only condition on any ship currently visible in the scene
 * (player or scene). The change lives in `workspace.scene.shipConditions` and
 * does NOT propagate into the ship file — load a fresh workspace and these
 * reset.
 *
 * @param {string} anyShipId
 * @param {import('../domain/types.js').SceneShipCondition} condition
 * @param {boolean} on
 */
export function setShipSceneCondition(anyShipId, condition, on) {
  const isPlayer = workspace.ships[anyShipId] != null
  const isScene = workspace.scene.sceneShips[anyShipId] != null
  if (!isPlayer && !isScene) return

  const current = workspace.scene.shipConditions[anyShipId] ?? []
  const has = current.includes(condition)
  if (on === has) return

  const label = formatConditionLabel(condition)
  const shipName = labelForShipId(anyShipId)
  commit(
    {
      kind: 'scene.condition',
      summary: on
        ? `${shipName} marked ${label}.`
        : `${shipName} no longer ${label}.`,
      // Tag the action with the player ship id so the per-ship Captain's Log
      // picks it up too. Scene-ship-only entries stay scene-scoped.
      shipId: isPlayer ? anyShipId : null,
    },
    () => {
      const list = workspace.scene.shipConditions[anyShipId] ?? []
      if (on) {
        workspace.scene.shipConditions[anyShipId] = [...list, condition]
      } else {
        const next = list.filter((c) => c !== condition)
        if (next.length === 0) {
          delete workspace.scene.shipConditions[anyShipId]
        } else {
          workspace.scene.shipConditions[anyShipId] = next
        }
      }
    },
  )
}

/**
 * Format a condition id for log output. Falls back to the raw id (no human
 * label) for unknown values — a misroute is always preferable to a thrown
 * error in the middle of a commit.
 * @param {string} id
 */
function formatConditionLabel(id) {
  if (id === 'listing') return 'listing'
  if (id === 'surrendered') return 'surrendered'
  if (id === 'stricken-colors') return 'surrendered'
  if (id === 'heeling') return 'heeling'
  if (id === 'in-irons') return 'in irons'
  if (id === 'crossing-t') return 'crossing the T'
  return id
}

// ---------- Captain's Log narrative mutators (v0.5) ----------
// `appendShipLog` (the auto-logger) creates a fresh open SessionEntry whenever
// the most recent entry is closed (or none exists), so user-authored title and
// narrative writes layer on top of that with no extra plumbing — they just
// mutate fields on an existing entry and ride through commit() like any other
// edit. Closing a session sets `endedAt`; the very next auto-logged action
// will then start a new entry, which the user can rename in turn.

/**
 * Patch the user-visible title and/or narrative on any SessionEntry in a
 * ship's history. Used by the JournalSection editor; identifies the entry by
 * id so closed entries can still be edited later.
 *
 * Empty / whitespace-only titles snap back to "Session" (the auto-logger
 * default); narratives accept any string including empty.
 *
 * @param {string} shipId
 * @param {string} entryId
 * @param {{ title?: string, narrative?: string }} patch
 */
export function setSessionEntryFields(shipId, entryId, patch) {
  const ship = getShipOrThrow(shipId)
  const entry = (ship.sessionHistory ?? []).find((e) => e.id === entryId)
  if (!entry) return

  /** @type {Record<string, string>} */
  const next = {}
  if (patch.title != null) {
    const trimmed = String(patch.title).trim()
    const finalTitle = trimmed.length > 0 ? trimmed : 'Session'
    if (finalTitle !== entry.title) next.title = finalTitle
  }
  if (patch.narrative != null) {
    const narrative = String(patch.narrative)
    if (narrative !== entry.narrative) next.narrative = narrative
  }
  if (patch.sessionDate != null) {
    const v = String(patch.sessionDate)
    if (v !== (entry.sessionDate ?? '')) next.sessionDate = v
  }
  if (patch.location != null) {
    const v = String(patch.location)
    if (v !== (entry.location ?? '')) next.location = v
  }
  if (patch.encounterName != null) {
    const v = String(patch.encounterName)
    if (v !== (entry.encounterName ?? '')) next.encounterName = v
  }
  if (Object.keys(next).length === 0) return

  const summaryParts = []
  if ('title' in next) summaryParts.push(`title → "${next.title}"`)
  if ('narrative' in next) summaryParts.push('narrative updated')
  if ('sessionDate' in next) summaryParts.push(`played → "${next.sessionDate || '(blank)'}"`)
  if ('location' in next) summaryParts.push(`location → "${next.location || '(blank)'}"`)
  if ('encounterName' in next) summaryParts.push(`encounter → "${next.encounterName || '(blank)'}"`)

  commit(
    {
      kind: 'session.update',
      summary: `Captain's log on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
    },
    () => {
      Object.assign(entry, next)
    },
  )
}

/**
 * Close the most recent open SessionEntry on a ship — a chapter break. The
 * close is itself a logged action; since we close `endedAt` first, the
 * auto-logger sees the entry as closed and starts a fresh session containing
 * the "Closed session" log line. This is intentional: it makes the close
 * timestamp easy to spot at the top of the new session.
 *
 * Optionally accepts a final title/narrative patch applied in the same
 * commit, so the user can write the closing entry and click Close in one go.
 *
 * @param {string} shipId
 * @param {{ title?: string, narrative?: string }} [finalPatch]
 */
export function closeCurrentSession(shipId, finalPatch = {}) {
  const ship = getShipOrThrow(shipId)
  const last = ship.sessionHistory?.[ship.sessionHistory.length - 1]
  if (!last || last.endedAt != null) return

  const finalTitle =
    finalPatch.title != null
      ? String(finalPatch.title).trim() || last.title
      : last.title
  const finalNarrative =
    finalPatch.narrative != null ? String(finalPatch.narrative) : last.narrative

  commit(
    {
      kind: 'session.close',
      summary: `Closed session "${finalTitle}" on ${ship.name}.`,
      shipId,
    },
    () => {
      last.title = finalTitle
      last.narrative = finalNarrative
      last.endedAt = nowIso()
    },
  )
}

/**
 * Resolve a ship-id reference (player ship or scene ship) to a human label
 * for log summaries. Returns the id itself if nothing matches, so debug output
 * is never lossy.
 * @param {string} id
 */
function labelForShipId(id) {
  if (workspace.ships[id]) return workspace.ships[id].name
  if (workspace.scene.sceneShips[id]) return workspace.scene.sceneShips[id].name
  return id
}

/**
 * Test-only: drop everything (workspace + undo/redo) so each test starts clean.
 * Not part of the public mutator surface; intended for `vi.beforeEach` only.
 */
export function __resetForTests() {
  replaceWorkspaceWith(makeEmptyWorkspace())
  undoStack.length = 0
  redoStack.length = 0
  stackInfo.prunedCount = 0
  syncStackInfo()
}

/** Replace state from autosave / Resume — does NOT push undo, since it's recovery. */
export function hydrateFromSnapshot(snapshot) {
  replaceWorkspaceWith(snapshot)
}

// ---------- Undo / redo ----------

export function undo() {
  const entry = undoStack.pop()
  if (!entry) return
  redoStack.push(entry)
  syncStackInfo()
  replaceWorkspaceWith(cloneSnapshot(entry.before))
}

export function redo() {
  const entry = redoStack.pop()
  if (!entry) return
  undoStack.push(entry)
  syncStackInfo()
  replaceWorkspaceWith(cloneSnapshot(entry.after))
}

// ---------- Selectors ----------

export function getFocusedShip() {
  if (!workspace.focusedShipId) return null
  return workspace.ships[workspace.focusedShipId] ?? null
}

export function getOrderedShips() {
  return workspace.shipOrder
    .map((id) => workspace.ships[id])
    .filter((s) => s != null)
}
