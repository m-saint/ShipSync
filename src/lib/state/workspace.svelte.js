/**
 * Workspace state for ShipSync. Single source of truth for the dashboard.
 *
 * Architecture:
 *   - `workspace` is a Svelte 5 `$state` proxy mutated directly by mutator functions below.
 *   - Every mutator goes through `commit(action, mutate)`, which:
 *       1. Snapshots the workspace before via `$state.snapshot`,
 *       2. Runs the user mutation,
 *       3. Stamps `ship.lastModifiedAt` on the affected ship (when `action.shipId`
 *          is set) so the dirty / "unsaved" indicator advances in lockstep,
 *       4. Snapshots the workspace after via `$state.snapshot`,
 *       5. Pushes the snapshot pair onto an in-memory plain undo stack.
 *   - Undo/redo replays workspace snapshots (RAM only; never persisted).
 *
 * v1.0.4 retired the per-ship narrative `sessionHistory` (the old "Captain's
 * Log" feature). The dashboard now hosts a single workspace-level feed that
 * the UI calls "Captain's Log" — implemented under `lib/features/activityLog`
 * and powered directly by the `recentActions(N)` selector below. Per-ship
 * dirty tracking moved from `latestActionAtForShip(ship)` (which scanned
 * `sessionHistory.actions[].timestamp`) to a single `lastModifiedAt` field
 * stamped here in `commit()` and migrated forward by
 * `migrateLegacySessionHistory()` on file/bundle/autosave load.
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
import {
  migrateLegacyPlayerCharacter,
  migrateLegacySessionHistory,
  migrateLegacyWeaponInventory,
} from '../persistence/loadFile.js'

/**
 * Cap on how many distinct undo entries we retain. The cap is a memory
 * safety guard — without it a long session that touches many resources
 * grows the undo arena unbounded, since each entry packs a deep clone
 * of the workspace before/after. 200 is enough headroom for a long
 * play session (a typical 4-hour session lands well under 100 commits)
 * while keeping the worst-case footprint bounded; older entries get
 * pruned silently from the bottom of the stack and the count of
 * pruned actions is surfaced to the Captain's Log as a soft boundary
 * hint so the user sees why old actions can't be undone anymore.
 */
const UNDO_LIMIT = 200

/** @type {import('../domain/types.js').Workspace} */
export const workspace = $state(makeEmptyWorkspace())

/**
 * Each entry packs the workspace snapshots before/after the commit, the
 * LogAction surfaced to the Captain's Log, and an optional `coalesceKey`
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
 * Captain's Log uses it to render a tiny "older history pruned" boundary hint.
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
 * Exposed so the Captain's Log can render a "history pruned" hint at
 * the oldest-entry boundary without leaking the raw stack to UI code.
 */
export function prunedActionCount() {
  return stackInfo.prunedCount
}

/**
 * Most recent N actions from any ship + workspace, newest-first.
 * Used by the dashboard Captain's Log (v1.0.4: previously named "Activity
 * Log"; renamed when the per-ship narrative was retired and the workspace
 * feed reclaimed the title).
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
 * mutators (mettle, crew, fires) and a growing roster of stepper-driven field
 * mutators (supplies, hp, speed, etc.). When the most recent undo entry shares
 * the same key, we treat the new commit as a continuation of the same bucket:
 * the existing entry's `after` snapshot is replaced with the latest, and the
 * log line's `summary` and `timestamp` are rewritten in place. The original
 * `before` is preserved so that a single undo unwinds the entire chain back to
 * the state before the first commit in the bucket.
 *
 * Coalescing is broken by:
 *   - any commit with no `coalesceKey` (e.g. ship.rename, ship.boarding)
 *   - any commit whose `coalesceKey` differs from the last entry's
 *   - an `undo()` (which pops the entry and clears the chain anchor)
 *
 * Important: redo is still cleared on every commit (coalesced or not) — once
 * you've made a forward edit, the parallel timeline is gone.
 *
 * v1.0.4: when `action.shipId` is set, `commit()` also stamps
 * `ship.lastModifiedAt` with the same timestamp the LogAction carries, so
 * the per-ship dirty / "unsaved" indicator advances in lockstep with the
 * action feed. The stamp lives on the ship object itself so it rides along
 * in autosave snapshots and per-ship `.shipsync.json` exports — that way an
 * autosaved-then-reloaded workspace still knows which ships have edits the
 * captain hasn't yet written to disk.
 *
 * @param {{ kind: string, summary: string, shipId?: string|null, coalesceKey?: string|null }} action
 * @param {() => void} mutate
 */
function commit(action, mutate) {
  const before = cloneSnapshot($state.snapshot(workspace))
  mutate()

  // Stamp `lastModifiedAt` BEFORE snapshotting `after` so the timestamp is
  // part of the undoable diff. A single shared `stamp` value keeps the
  // ship's dirty marker, the LogAction.timestamp, and (on coalescing) the
  // chain's most-recent-edit time perfectly in sync.
  const stamp = nowIso()
  if (action.shipId && workspace.ships[action.shipId]) {
    workspace.ships[action.shipId].lastModifiedAt = stamp
  }

  const after = cloneSnapshot($state.snapshot(workspace))

  const coalesceKey = action.coalesceKey ?? null
  const lastEntry = undoStack[undoStack.length - 1] ?? null
  const canCoalesce =
    coalesceKey != null && lastEntry != null && lastEntry.coalesceKey === coalesceKey

  if (canCoalesce) {
    // Merge into the existing entry: keep the original `before`, advance
    // `after`, rewrite the log line. We REPLACE the LogAction object rather
    // than mutating it in place — Svelte 5's keyed `{#each}` over the global
    // log diffs by `action.id`, and reused DOM nodes don't re-read string
    // properties when the bound object identity stays the same. A fresh
    // reference forces text-content re-evaluation.
    const updatedAction = {
      ...lastEntry.action,
      summary: action.summary,
      timestamp: stamp,
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
    timestamp: stamp,
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
 * the Captain's Log reads as a directed change rather than "Lassie moved" with
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
 * lines here — adding "imported via bundle" lines on top of the
 * freshly-loaded ships would just clutter the feed. The workspace-level
 * summary is enough breadcrumb to find the import in the Captain's Log.
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
// surfaced in the Captain's Log. Image-touching mutators prune any image that
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
 * Update either or both speed components in a single commit. Successive
 * edits to the *same* speed component (e.g. holding the knots stepper)
 * coalesce into a single log entry "knots 4 → 9" instead of one entry per
 * step. Touching the other component, or any unrelated field, breaks the
 * chain.
 *
 * @param {string} shipId
 * @param {{ knots?: number, squares?: number }} patch
 */
export function setShipSpeed(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  const nextKnots = patch.knots != null ? Math.max(0, Number(patch.knots) || 0) : ship.speed.knots
  const nextSquares =
    patch.squares != null ? Math.max(0, Number(patch.squares) || 0) : ship.speed.squares
  if (nextKnots === ship.speed.knots && nextSquares === ship.speed.squares) return
  // Single-component patches get a focused coalesce key; combined patches
  // (e.g. someone wires both fields in one click) skip coalescing so the
  // log doesn't try to merge two unrelated bumps.
  let coalesceKey = null
  if (patch.knots != null && patch.squares == null) {
    coalesceKey = `ship.speed.knots|${shipId}`
  } else if (patch.squares != null && patch.knots == null) {
    coalesceKey = `ship.speed.squares|${shipId}`
  }
  const chainBefore = coalesceKey != null ? getCoalescedBefore(coalesceKey) : null
  const fromKnots = chainBefore?.ships?.[shipId]?.speed?.knots ?? ship.speed.knots
  const fromSquares = chainBefore?.ships?.[shipId]?.speed?.squares ?? ship.speed.squares
  /** @type {string[]} */
  const summaryParts = []
  if (nextKnots !== fromKnots) summaryParts.push(`knots ${fromKnots} → ${nextKnots}`)
  if (nextSquares !== fromSquares) summaryParts.push(`squares ${fromSquares} → ${nextSquares}`)
  commit(
    {
      kind: 'ship.profile',
      summary:
        summaryParts.length > 0
          ? `Speed on ${ship.name}: ${summaryParts.join(', ')}.`
          : `Set speed to ${nextKnots} kt / ${nextSquares} sq on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.speed = { knots: nextKnots, squares: nextSquares }
    },
  )
}

/**
 * Set HP max. If max drops below current, current is clamped. Successive
 * edits coalesce into a single "Hull max 18 → 24" line — see
 * `combatResourceCoalesceKey` for the same trick used by combat resources.
 *
 * @param {string} shipId
 * @param {number} hpMax
 */
export function setShipHpMax(shipId, hpMax) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(1, Math.floor(Number(hpMax) || 0))
  if (next === ship.hp.max) return
  const coalesceKey = `ship.hp.max|${shipId}`
  const chainBefore = getCoalescedBefore(coalesceKey)
  const previousMax = chainBefore?.ships?.[shipId]?.hp?.max ?? ship.hp.max
  const clampedCurrent = Math.min(ship.hp.current, next)
  commit(
    {
      kind: 'ship.hp',
      summary: `Hull max ${previousMax} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.hp = { current: clampedCurrent, max: next }
    },
  )
}

/**
 * Set HP current. Clamped to [0, hp.max]. Coalesces successive edits to
 * the same field so a stepper burst reads as one undoable step.
 *
 * @param {string} shipId
 * @param {number} hpCurrent
 */
export function setShipHpCurrent(shipId, hpCurrent) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.min(ship.hp.max, Math.floor(Number(hpCurrent) || 0)))
  if (next === ship.hp.current) return
  const coalesceKey = `ship.hp.current|${shipId}`
  const chainBefore = getCoalescedBefore(coalesceKey)
  const previous = chainBefore?.ships?.[shipId]?.hp?.current ?? ship.hp.current
  commit(
    {
      kind: 'ship.hp',
      summary: `Hull ${previous} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.hp.current = next
    },
  )
}

/**
 * Set the ship's Explosion DC. Coalesces successive edits to one log line.
 *
 * @param {string} shipId
 * @param {number} dc
 */
export function setShipExplosionDC(shipId, dc) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(1, Math.floor(Number(dc) || 0))
  if (next === ship.explosionDC) return
  const coalesceKey = `ship.explosionDC|${shipId}`
  const chainBefore = getCoalescedBefore(coalesceKey)
  const previous = chainBefore?.ships?.[shipId]?.explosionDC ?? ship.explosionDC
  commit(
    {
      kind: 'ship.profile',
      summary: `Explosion DC ${previous} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.explosionDC = next
    },
  )
}

/**
 * Patch any subset of weapon slots and/or `heavyEligible` in a single commit.
 * Single-side patches coalesce into one log line ("starboard 2 → 5") when
 * the captain holds a slot stepper; combined patches and the heavy toggle
 * skip coalescing because they're discrete decisions, not stepper bursts.
 *
 * @param {string} shipId
 * @param {Partial<import('../domain/types.js').WeaponSlots>} patch
 */
export function setShipWeapons(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  /** @type {Partial<import('../domain/types.js').WeaponSlots>} */
  const next = {}
  /** @type {Array<'bow'|'port'|'starboard'|'stern'>} */
  const sideKeys = ['bow', 'port', 'starboard', 'stern']
  for (const key of sideKeys) {
    if (patch[key] != null) {
      const value = Math.max(0, Math.floor(Number(patch[key]) || 0))
      if (value !== ship.weapons[key]) next[key] = value
    }
  }
  if (typeof patch.heavyEligible === 'boolean' && patch.heavyEligible !== ship.weapons.heavyEligible) {
    next.heavyEligible = patch.heavyEligible
  }
  if (Object.keys(next).length === 0) return

  // Coalesce only when exactly one slot count changed and `heavyEligible`
  // wasn't touched. The chain anchor's value becomes the "from" half of
  // the summary so a 2→5 burst reads as a single hop.
  let coalesceKey = null
  let onlyChangedSide = null
  if (next.heavyEligible == null) {
    const changedSides = sideKeys.filter((k) => next[k] != null)
    if (changedSides.length === 1) {
      onlyChangedSide = changedSides[0]
      coalesceKey = `ship.weapons.${onlyChangedSide}|${shipId}`
    }
  }
  const chainBefore = coalesceKey != null ? getCoalescedBefore(coalesceKey) : null

  const summaryParts = []
  for (const key of sideKeys) {
    if (next[key] != null) {
      const fromValue =
        key === onlyChangedSide && chainBefore?.ships?.[shipId]?.weapons?.[key] != null
          ? chainBefore.ships[shipId].weapons[key]
          : ship.weapons[key]
      summaryParts.push(`${key} ${fromValue} → ${next[key]}`)
    }
  }
  if (next.heavyEligible != null) {
    summaryParts.push(next.heavyEligible ? 'heavy weapons eligible' : 'heavy weapons not eligible')
  }
  commit(
    {
      kind: 'ship.weapons',
      summary: `Weapons on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
      coalesceKey,
    },
    () => {
      Object.assign(ship.weapons, next)
    },
  )
}

/**
 * Cap a mount's slot count to a sane positive integer. Single-slot is the
 * floor (a mount that "occupies zero slots" is incoherent); the upper bound
 * is intentionally generous (16) — bigger than any rulebook example yet
 * small enough to surface obvious typos without forcing arbitrary fleet-wide
 * caps.
 *
 * @param {unknown} value
 * @returns {number}
 */
function clampMountSlots(value) {
  const numeric = Number.isFinite(value) ? Number(value) : 1
  return Math.max(1, Math.min(16, Math.floor(numeric)))
}

/**
 * Append a new weapon mount to a side's inventory. Returns the new mount's
 * id so the caller (a row editor) can immediately focus the name input on
 * the freshly-added row.
 *
 * Note: this does NOT touch `ship.weapons[side]` — slot capacity is the
 * captain's declared cap (e.g. "this brig has 4 starboard slots") and stays
 * independent of how many mounts are currently filling those slots. The UI
 * surfaces an "X of Y slots filled" tally so it's visible whether the
 * captain has overstuffed or under-equipped a side. (See ProfileSection.)
 *
 * @param {string} shipId
 * @param {'bow'|'port'|'starboard'|'stern'} side
 * @param {{ name?: string, slotsOccupied?: number }} [seed]
 * @returns {string|null} id of the added mount, or null when no commit ran
 */
export function addShipWeaponMount(shipId, side, seed = {}) {
  const ship = getShipOrThrow(shipId)
  if (!ship.weaponInventory) ship.weaponInventory = { bow: [], port: [], starboard: [], stern: [] }
  const id = makeId()
  const name = typeof seed.name === 'string' ? seed.name : ''
  const slotsOccupied = clampMountSlots(seed.slotsOccupied ?? 1)
  const sideLabel = SIDE_LABELS[side]
  const summaryName = name.trim().length > 0 ? `"${name.trim()}"` : 'mount'
  commit(
    {
      kind: 'ship.weaponMounts',
      summary: `Added ${summaryName} to ${sideLabel} on ${ship.name}.`,
      shipId,
    },
    () => {
      ship.weaponInventory[side].push({ id, name, slotsOccupied })
    },
  )
  return id
}

/**
 * Patch a single mount in place. Coalesces successive edits to the same
 * mount/field into one log line so typing a name letter-by-letter (or
 * holding the slot stepper) doesn't flood the log — see the
 * `coalesceKey` mechanism in `commit()`. Editing a different field on the
 * same mount, or the same field on a different mount, breaks the chain.
 *
 * No-ops silently when `mountId` doesn't exist (e.g. it was just deleted
 * by another action and a stale UI sent a follow-up patch).
 *
 * @param {string} shipId
 * @param {'bow'|'port'|'starboard'|'stern'} side
 * @param {string} mountId
 * @param {{ name?: string, slotsOccupied?: number }} patch
 */
export function setShipWeaponMount(shipId, side, mountId, patch) {
  const ship = getShipOrThrow(shipId)
  const list = ship.weaponInventory?.[side]
  if (!Array.isArray(list)) return
  const idx = list.findIndex((m) => m.id === mountId)
  if (idx < 0) return
  const current = list[idx]

  /** @type {Partial<{ name: string, slotsOccupied: number }>} */
  const next = {}
  let coalesceField = null
  if (typeof patch.name === 'string' && patch.name !== current.name) {
    next.name = patch.name
    coalesceField = 'name'
  }
  if (patch.slotsOccupied != null) {
    const clamped = clampMountSlots(patch.slotsOccupied)
    if (clamped !== current.slotsOccupied) {
      next.slotsOccupied = clamped
      coalesceField = coalesceField ?? 'slotsOccupied'
    }
  }
  if (Object.keys(next).length === 0) return

  const sideLabel = SIDE_LABELS[side]
  // Use the coalesced chain anchor for the "before" half of the summary so
  // a flurry of stepper / keystroke commits collapses into a single log
  // entry that still reads "Falconet (1-slot) → Falconet (3-slot)" instead
  // of "Falconet (2-slot) → Falconet (3-slot)" (the most recent step). See
  // `getCoalescedBefore` for the same trick used by combat resources.
  const coalesceKey = `weaponMount|${shipId}|${side}|${mountId}|${coalesceField}`
  const chainBefore = getCoalescedBefore(coalesceKey)
  const chainCurrent =
    chainBefore?.ships?.[shipId]?.weaponInventory?.[side]?.find((m) => m.id === mountId) ?? current
  const previousLabel = labelMount(chainCurrent)
  const merged = { ...current, ...next }
  const nextLabel = labelMount(merged)
  const summary = `${sideLabel} mount on ${ship.name}: ${previousLabel} → ${nextLabel}.`

  commit(
    {
      kind: 'ship.weaponMounts',
      summary,
      shipId,
      coalesceKey,
    },
    () => {
      list[idx] = { ...current, ...next }
    },
  )
}

/**
 * Remove a single mount from a side's inventory and re-derive the slot
 * count. No-op when the mount doesn't exist.
 *
 * @param {string} shipId
 * @param {'bow'|'port'|'starboard'|'stern'} side
 * @param {string} mountId
 */
export function removeShipWeaponMount(shipId, side, mountId) {
  const ship = getShipOrThrow(shipId)
  const list = ship.weaponInventory?.[side]
  if (!Array.isArray(list)) return
  const idx = list.findIndex((m) => m.id === mountId)
  if (idx < 0) return
  const removed = list[idx]
  const sideLabel = SIDE_LABELS[side]
  commit(
    {
      kind: 'ship.weaponMounts',
      summary: `Removed ${labelMount(removed)} from ${sideLabel} on ${ship.name}.`,
      shipId,
    },
    () => {
      list.splice(idx, 1)
    },
  )
}

/**
 * Pretty-print a weapon mount for log summaries. Falls back to "Unnamed
 * mount (Nx)" so blank-name rows still surface a readable line in the
 * Captain's Log instead of an empty quote.
 *
 * @param {import('../domain/types.js').WeaponMount} mount
 * @returns {string}
 */
function labelMount(mount) {
  const name = (mount.name ?? '').trim()
  const slots = mount.slotsOccupied
  const slotsSuffix = slots > 1 ? ` (${slots}-slot)` : ''
  if (name.length === 0) return `unnamed mount${slotsSuffix}`
  return `"${name}"${slotsSuffix}`
}

/** @type {Record<'bow'|'port'|'starboard'|'stern', string>} */
const SIDE_LABELS = { bow: 'bow', port: 'port', starboard: 'starboard', stern: 'stern' }

/**
 * Update one or more supply tracks (Grub / Grog / Gear) on a ship. A
 * multi-track patch is committed as one entry; single-track stepper
 * bursts (e.g. holding the Gear "+" from 1 to 5) coalesce into a single
 * "gear 1 → 5" log line via `coalesceKey`. Touching a different track,
 * or any unrelated mutator, breaks the chain.
 *
 * @param {string} shipId
 * @param {Partial<import('../domain/types.js').Supplies>} patch
 */
export function setShipSupplies(shipId, patch) {
  const ship = getShipOrThrow(shipId)
  /** @type {Array<'grub'|'grog'|'gear'>} */
  const trackKeys = ['grub', 'grog', 'gear']
  /** @type {Partial<import('../domain/types.js').Supplies>} */
  const next = {}
  for (const key of trackKeys) {
    if (patch[key] != null) {
      const value = Math.max(0, Math.floor(Number(patch[key]) || 0))
      if (value !== ship.supplies[key]) next[key] = value
    }
  }
  if (Object.keys(next).length === 0) return

  const changedTracks = trackKeys.filter((k) => next[k] != null)
  const onlyChangedTrack = changedTracks.length === 1 ? changedTracks[0] : null
  const coalesceKey = onlyChangedTrack ? `ship.supplies.${onlyChangedTrack}|${shipId}` : null
  const chainBefore = coalesceKey != null ? getCoalescedBefore(coalesceKey) : null

  const summaryParts = []
  for (const key of trackKeys) {
    if (next[key] != null) {
      const fromValue =
        key === onlyChangedTrack && chainBefore?.ships?.[shipId]?.supplies?.[key] != null
          ? chainBefore.ships[shipId].supplies[key]
          : ship.supplies[key]
      summaryParts.push(`${key} ${fromValue} → ${next[key]}`)
    }
  }
  commit(
    {
      kind: 'ship.supplies',
      summary: `Supplies on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
      coalesceKey,
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

  // Coalesce only the lone-rank-bump case (the typical stepper burst). Any
  // patch that touches name or status is a discrete decision and skips
  // coalescing so the log doesn't muddle "promoted" with "renamed."
  let coalesceKey = null
  let chainRank = null
  if ('rank' in next && !('name' in next) && !('status' in next)) {
    coalesceKey = `officer.rank|${shipId}|${station}`
    const chainBefore = getCoalescedBefore(coalesceKey)
    chainRank = chainBefore?.ships?.[shipId]?.officers?.[station]?.rank ?? null
  }

  const summaryParts = []
  if ('name' in next) summaryParts.push(`name → ${next.name ?? '(blank)'}`)
  if ('rank' in next) {
    const fromRank = chainRank != null ? chainRank : officer.rank
    summaryParts.push(`rank ${fromRank} → ${next.rank}`)
  }
  if ('status' in next) summaryParts.push(`status ${officer.status} → ${next.status}`)

  commit(
    {
      kind: 'officer.update',
      summary: `${STATION_LABELS[station]} on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
      coalesceKey,
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

// v1.0.4: the legacy `setPlayerCharacterEnabled` / `setPlayerCharacterFields`
// / `setPlayerCharacterPortrait` mutators were removed when the player
// character became synonymous with the captain. The captain officer card
// (`setOfficer`, `setOfficerNotes`, `setOfficerPortrait`) is now the sole
// edit surface for character identity, traits, and likeness. Old saves with
// a populated `ship.playerCharacter` block still load — see
// `migrateLegacyPlayerCharacter` in loadFile.js — but the field is no
// longer surfaced or written by the UI.

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

  // Coalesce single-stepper patches on a scene ship — fires, explosion DC,
  // hull current, hull max — so a 0→4 burst on an NPC reads the same as
  // the player-ship combat resources do upstream.
  let coalesceKey = null
  /** @type {string | null} */
  let coalesceFrom = null
  const onlyKey = Object.keys(next).length === 1 ? Object.keys(next)[0] : null
  if (onlyKey === 'fires') {
    coalesceKey = `scene.ship.fires|${sceneShipId}`
    const chainBefore = getCoalescedBefore(coalesceKey)
    const fromValue = chainBefore?.scene?.sceneShips?.[sceneShipId]?.fires ?? sceneShip.fires
    const toValue = /** @type {number} */ (next.fires)
    coalesceFrom = `fires ${fromValue} → ${toValue}`
  } else if (onlyKey === 'explosionDC') {
    coalesceKey = `scene.ship.explosionDC|${sceneShipId}`
    const chainBefore = getCoalescedBefore(coalesceKey)
    const fromValue =
      chainBefore?.scene?.sceneShips?.[sceneShipId]?.explosionDC ?? sceneShip.explosionDC
    const toValue = /** @type {number} */ (next.explosionDC)
    coalesceFrom = `explosion DC ${fromValue} → ${toValue}`
  } else if (onlyKey === 'hp') {
    // Only coalesce a single hp axis (current XOR max) — touching both at
    // once is a "set hull to N/M" decision and stays as one entry.
    const newHp = /** @type {{current?: number, max?: number}} */ (next.hp)
    const currentChanged = newHp.current !== sceneShip.hp.current
    const maxChanged = newHp.max !== sceneShip.hp.max
    if (currentChanged && !maxChanged) {
      coalesceKey = `scene.ship.hp.current|${sceneShipId}`
      const chainBefore = getCoalescedBefore(coalesceKey)
      const fromValue =
        chainBefore?.scene?.sceneShips?.[sceneShipId]?.hp?.current ?? sceneShip.hp.current
      const toValue = newHp.current ?? sceneShip.hp.current
      coalesceFrom = `hull ${fromValue} → ${toValue}`
    } else if (maxChanged && !currentChanged) {
      coalesceKey = `scene.ship.hp.max|${sceneShipId}`
      const chainBefore = getCoalescedBefore(coalesceKey)
      const fromValue =
        chainBefore?.scene?.sceneShips?.[sceneShipId]?.hp?.max ?? sceneShip.hp.max
      const toValue = newHp.max ?? sceneShip.hp.max
      coalesceFrom = `max ${fromValue} → ${toValue}`
    }
  }
  if (coalesceFrom) {
    summaryParts.length = 0
    summaryParts.push(coalesceFrom)
  }

  commit(
    {
      kind: 'scene.shipUpdate',
      summary: `${sceneShip.name} (scene): ${summaryParts.join(', ')}.`,
      coalesceKey,
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

  // Coalesce stepper bursts on the gap or the escape timer, but only when
  // they're moving alone (a multi-field patch indicates the captain set up
  // the chase intentionally — e.g. "pursuer + quarry + gap" — and that
  // deserves one entry, not a coalesced run with the previous bump).
  let coalesceKey = null
  let chainGap = null
  let chainTimer = null
  if (
    'gap' in next &&
    Object.keys(next).length === 1
  ) {
    coalesceKey = 'scene.pursuit.gap'
    const chainBefore = getCoalescedBefore(coalesceKey)
    chainGap = chainBefore?.scene?.pursuit?.gap ?? null
  } else if (
    'escapeTimer' in next &&
    Object.keys(next).length === 1
  ) {
    coalesceKey = 'scene.pursuit.escapeTimer'
    const chainBefore = getCoalescedBefore(coalesceKey)
    chainTimer = chainBefore?.scene?.pursuit?.escapeTimer ?? null
  }

  // Rebuild the summary line for whichever single-field stepper was caught
  // so the chain reads `gap 0 → 5` even when intermediate bumps already
  // moved 0→1, 1→2, 2→3, …
  if (coalesceKey === 'scene.pursuit.gap' && chainGap != null && chainGap !== next.gap) {
    summaryParts.length = 0
    summaryParts.push(`gap ${chainGap} → ${next.gap}`)
  } else if (
    coalesceKey === 'scene.pursuit.escapeTimer' &&
    chainTimer != null &&
    chainTimer !== next.escapeTimer
  ) {
    summaryParts.length = 0
    summaryParts.push(`escape timer ${chainTimer} → ${next.escapeTimer}`)
  }

  commit(
    {
      kind: 'scene.pursuit',
      summary: `Pursuit: ${summaryParts.join(', ')}.`,
      coalesceKey,
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
  // The round stepper bursts the same way a stat stepper does — hold the
  // button to skip ahead, and the log used to fill with "Round 1 → 2",
  // "Round 2 → 3", … coalescing flattens that to one "Round 1 → 5" entry.
  const coalesceKey = 'scene.round'
  const chainBefore = getCoalescedBefore(coalesceKey)
  const fromRound = chainBefore?.scene?.round ?? previous
  commit(
    {
      kind: 'scene.round',
      summary: `Round ${fromRound} → ${next}.`,
      coalesceKey,
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
 * conditions) is left alone — the player decides what gets restored
 * between sessions, and conflating persistence boundaries here would be a
 * surprise. The single workspace-level Captain's-Log entry summarizes what
 * was reset.
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
// inside a single scene round are coalesced into one Captain's Log line and
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
  const coalesceKey = `ship.crew.max|${shipId}`
  const chainBefore = getCoalescedBefore(coalesceKey)
  const previousMax = chainBefore?.ships?.[shipId]?.crew?.max ?? ship.crew.max
  const clampedCurrent = Math.min(ship.crew.current, next)
  commit(
    {
      kind: 'ship.crewMax',
      summary: `Crew max ${previousMax} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
    },
    () => {
      ship.crew.max = next
      ship.crew.current = clampedCurrent
    },
  )
}

/**
 * Set crew.skeleton — the threshold below which the ship is short-handed.
 * Clamped to [0, crew.max]. Coalesces successive stepper bumps so a 0→4
 * burst reads as one log line.
 *
 * @param {string} shipId
 * @param {number} value
 */
export function setShipCrewSkeleton(shipId, value) {
  const ship = getShipOrThrow(shipId)
  const next = Math.max(0, Math.min(ship.crew.max, Math.floor(Number(value) || 0)))
  if (next === ship.crew.skeleton) return
  const coalesceKey = `ship.crew.skeleton|${shipId}`
  const chainBefore = getCoalescedBefore(coalesceKey)
  const previous = chainBefore?.ships?.[shipId]?.crew?.skeleton ?? ship.crew.skeleton
  commit(
    {
      kind: 'ship.crewSkeleton',
      summary: `Skeleton crew mark ${previous} → ${next} on ${ship.name}.`,
      shipId,
      coalesceKey,
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
// the Captain's Log and bloats the undo stack. The composers below take a
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
 * unwinds the entire shore leave. The Captain's Log gets one workspace-level
 * summary line; the dirty / "unsaved" indicator advances on each affected
 * ship by stamping `lastModifiedAt` inside the same commit closure, so
 * Save All picks them all up after one shore leave.
 *
 * v1.0.4 — the per-ship narrative log was retired alongside the
 * `sessionHistory` feature. The dialog still renders a per-ship preview via
 * `composeShoreLeaveSummary`, but the mutator no longer emits a separate
 * log line per ship; the workspace summary plus per-ship `lastModifiedAt`
 * stamping is enough to show what landed.
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
   * apply them directly without re-clamping.
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
  // Black Pearl, Interceptor" stays scannable; four+ collapses to a count.
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
      // Multi-ship commits don't go through commit()'s single-shipId
      // auto-stamp, so we stamp each affected ship explicitly inside the
      // closure. One shared timestamp keeps the dirty pills lighting up
      // together, and including the stamp in the snapshotted `after`
      // means undo correctly winds them back in lockstep.
      const stamp = nowIso()
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
        ship.lastModifiedAt = stamp
      }
    },
  )
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

  // Coalesce only the common stepper case: a single rep-axis bump on a
  // single flag of a single ship. Touching the name, the boolean toggles,
  // or multiple axes at once is a discrete decision and skips coalescing.
  let coalesceKey = null
  if (
    next.reputation != null &&
    next.name == null &&
    next.isFalse == null &&
    next.isPirate == null &&
    next.isFaction == null
  ) {
    const current = normalizeReputation(flag.reputation)
    const desired = /** @type {import('../domain/types.js').Reputation} */ (next.reputation)
    const changedAxes = REPUTATION_AXES.filter((axis) => current[axis] !== desired[axis])
    if (changedAxes.length === 1) {
      const axis = changedAxes[0]
      coalesceKey = `flag.rep.${axis}|${shipId}|${flagId}`
      const chainBefore = getCoalescedBefore(coalesceKey)
      const chainFlag =
        chainBefore?.ships?.[shipId]?.flags?.flown?.find((f) => f.id === flagId) ??
        chainBefore?.ships?.[shipId]?.flags?.known?.find((f) => f.id === flagId) ??
        null
      const chainCurrent = chainFlag ? normalizeReputation(chainFlag.reputation) : current
      // Rewrite the rep-axis summary line so the chain reads "good 0 → 5"
      // even when intermediate stepper bumps already moved 0 → 1, 1 → 2, …
      summaryParts.length = 0
      summaryParts.push(
        `${REPUTATION_AXIS_LABELS[axis]} reputation ${chainCurrent[axis]} → ${desired[axis]}`,
      )
    }
  }

  commit(
    {
      kind: 'ship.flagUpdate',
      summary: `Flag ${flag.name} on ${ship.name}: ${summaryParts.join(', ')}.`,
      shipId,
      coalesceKey,
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
      // v1.0.4: same multi-ship dirty-stamping precedent as applyShoreLeave.
      // The workspace log only carries one summary line, but each target
      // ship's `lastModifiedAt` advances so Save All catches them all.
      const stamp = nowIso()
      for (const [id, newFlag] of newFlagByShip) {
        const ship = workspace.ships[id]
        ship.flags.flown.push(newFlag)
        if (raiseOnTargets || ship.flags.flyingId == null) {
          ship.flags.flyingId = newFlag.id
        }
        ship.lastModifiedAt = stamp
      }
    },
  )

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
      // Tag the action with the player ship id so the dirty stamp lands on
      // the right hull. Scene-ship-only conditions stay scene-scoped (no
      // shipId means no `lastModifiedAt` advance, since scene ships are
      // ephemeral and don't have an "unsaved" pill to light up).
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

// ---------- Per-ship narrative journal — RETIRED v1.0.4 ----------
// v0.5 introduced a per-ship `sessionHistory` with a "Captain's Log"
// editor (title/narrative + Played/Location/Encounter metadata) and two
// mutators here: `setSessionEntryFields` for editing in place and
// `closeCurrentSession` for chapter breaks. v1.0.4 retired the feature
// because it was out of scope for ship-combat tracking — narrative
// authoring is fine in a notebook (or a real word processor) and a
// dashboard widget added clutter without a clear win. The dashboard's
// workspace-level log was renamed back to "Captain's Log" to take the
// reclaimed name. Old saves are migrated forward by
// `migrateLegacySessionHistory()` in `loadFile.js` — the most-recent
// `actions[].timestamp` lands in `Ship.lastModifiedAt` so the dirty
// indicator behaves identically, and the rest of the entry is dropped.

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
  // Run the same idempotent v1.0.4 migrations the file/bundle paths run so
  // an older autosave (with a populated `playerCharacter` block, no
  // `weaponInventory` field, or a stale `sessionHistory` array) still lands
  // in a clean shape. All three helpers bail safely on already-clean ships.
  // See loadFile.js for the rationale on each.
  if (snapshot?.ships) {
    for (const id of Object.keys(snapshot.ships)) {
      migrateLegacyPlayerCharacter(snapshot.ships[id])
      migrateLegacyWeaponInventory(snapshot.ships[id])
      migrateLegacySessionHistory(snapshot.ships[id])
    }
  }
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
