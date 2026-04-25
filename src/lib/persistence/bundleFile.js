/**
 * `.shipsync.bundle.json` — fleet-and-scene portable archive (v1.0).
 *
 * Where `.shipsync.json` (handled in `shipFile.js`) saves a single ship and
 * the images that ship references, the bundle format saves an entire
 * workspace: every ship, the ship order, the active scene, and every
 * image referenced anywhere across the fleet. It's intended for:
 *   - Handing a complete tabletop session over to another captain
 *     ("here, take my ships, the boarding states, everything").
 *   - Keeping a single archive of an entire arc instead of N ship files.
 *   - Backups before risky changes.
 *
 * This module is purposely independent from the workspace state so
 * tests can build bundles from plain JS objects, and so the load path
 * can validate a bundle file's shape before any workspace mutation
 * runs (Heuristic 5: error prevention).
 *
 * The schema is conservative on purpose: data fields are flat clones of
 * the runtime types, with no exotic encoding. Any future migration
 * needs to bump `BUNDLE_SCHEMA_VERSION` and route through the
 * normalization step in `parseBundleFile`.
 *
 * @typedef {Object} ShipsyncBundleFile
 * @property {string} schema      Always 'shipsync.bundle/v1' for this version.
 * @property {string} savedAt     ISO timestamp when the bundle was written.
 * @property {string} appVersion  Free-form app version string (e.g. '1.0').
 * @property {string[]} shipOrder Ordered list of ship ids (subset of `ships` keys).
 * @property {Record<string, import('../domain/types.js').Ship>} ships
 * @property {import('../domain/types.js').Scene} scene
 * @property {import('../domain/types.js').ImageStore} images
 */

import { makeIdleScene } from '../domain/derivations.js'

export const BUNDLE_FILE_EXTENSION = '.shipsync.bundle.json'
export const BUNDLE_FILE_MIME = 'application/json'
export const BUNDLE_SCHEMA = 'shipsync.bundle/v1'

/**
 * @typedef {Object} ParsedBundleResult
 * @property {string} sourceFilename
 * @property {boolean} ok
 * @property {ShipsyncBundleFile|null} bundle
 * @property {{ severity: 'error'|'warn', message: string }[]} issues
 */

/**
 * Build the file payload for a snapshot of the current workspace.
 *
 * Image filtering: we walk every ship's referenced image ids (portraits,
 * officer portraits, flag art) and copy only those entries from the
 * shared image store. Bundle files therefore don't accidentally carry
 * images that have already been pruned but were left in the autosave
 * snapshot — that mirrors the per-ship file behavior.
 *
 * @param {{
 *   ships: Record<string, import('../domain/types.js').Ship>,
 *   shipOrder: string[],
 *   scene: import('../domain/types.js').Scene,
 *   images: import('../domain/types.js').ImageStore
 * }} workspaceLike
 * @param {{ appVersion?: string, savedAt?: string }} [opts]
 * @returns {ShipsyncBundleFile}
 */
export function makeBundleFile(workspaceLike, opts = {}) {
  const { ships, shipOrder, scene, images } = workspaceLike
  const orderSet = new Set(shipOrder)
  const referenced = new Set()
  /** @type {Record<string, import('../domain/types.js').Ship>} */
  const cleanShips = {}
  for (const id of shipOrder) {
    const ship = ships[id]
    if (!ship) continue
    cleanShips[id] = ship
    collectShipImageIds(ship, referenced)
  }

  // Defensive: if `ships` contains entries that aren't in shipOrder
  // (shouldn't happen in practice — the workspace mutators keep them in
  // sync), drop them silently rather than emit ghost ships.
  for (const id of Object.keys(ships)) {
    if (!orderSet.has(id)) continue
    if (!cleanShips[id]) cleanShips[id] = ships[id]
  }

  /** @type {import('../domain/types.js').ImageStore} */
  const cleanImages = {}
  for (const id of referenced) {
    if (images[id]) cleanImages[id] = images[id]
  }

  return {
    schema: BUNDLE_SCHEMA,
    savedAt: opts.savedAt ?? new Date().toISOString(),
    appVersion: opts.appVersion ?? '1.0',
    shipOrder: [...shipOrder],
    ships: cleanShips,
    scene: cloneScene(scene),
    images: cleanImages,
  }
}

/**
 * Serialize a bundle file to a JSON string, ready to write to disk.
 *
 * @param {{
 *   ships: Record<string, import('../domain/types.js').Ship>,
 *   shipOrder: string[],
 *   scene: import('../domain/types.js').Scene,
 *   images: import('../domain/types.js').ImageStore
 * }} workspaceLike
 * @param {{ appVersion?: string, savedAt?: string }} [opts]
 */
export function serializeBundleFile(workspaceLike, opts = {}) {
  return JSON.stringify(makeBundleFile(workspaceLike, opts), null, 2)
}

/**
 * Build a safe filename for a bundle file. Default stem is
 * `shipsync-fleet--<iso>` so multiple bundles sit next to each other on
 * disk without colliding (same logic the per-ship file uses).
 *
 * @param {{ withTimestamp?: boolean, stem?: string }} [opts]
 */
export function bundleFilename(opts = {}) {
  const stem = sanitizeStem(opts.stem ?? 'shipsync-fleet')
  if (opts.withTimestamp === false) return `${stem}${BUNDLE_FILE_EXTENSION}`
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${stem}--${stamp}${BUNDLE_FILE_EXTENSION}`
}

/**
 * Trigger a browser download of the workspace as a bundle file.
 * Returns the chosen filename, for logging.
 *
 * @param {{
 *   ships: Record<string, import('../domain/types.js').Ship>,
 *   shipOrder: string[],
 *   scene: import('../domain/types.js').Scene,
 *   images: import('../domain/types.js').ImageStore
 * }} workspaceLike
 * @param {{ withTimestamp?: boolean, filename?: string, stem?: string, appVersion?: string }} [opts]
 * @returns {string}
 */
export function downloadBundleFile(workspaceLike, opts = {}) {
  const text = serializeBundleFile(workspaceLike, { appVersion: opts.appVersion })
  const filename =
    opts.filename ?? bundleFilename({ withTimestamp: opts.withTimestamp, stem: opts.stem })
  const blob = new Blob([text], { type: BUNDLE_FILE_MIME })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return filename
}

/**
 * Sniff an unknown JSON payload to see whether it's a bundle file.
 * Used by the load button to route a single user-selected file to the
 * right parser without a UI mode toggle. Conservative: returns true
 * only when the top-level `schema` field clearly identifies a bundle
 * (filename heuristics elsewhere already filter, so this is the second
 * line of defense).
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isBundlePayload(raw) {
  if (!raw || typeof raw !== 'object') return false
  const obj = /** @type {Record<string, unknown>} */ (raw)
  if (typeof obj.schema !== 'string') return false
  return obj.schema === BUNDLE_SCHEMA || obj.schema.startsWith('shipsync.bundle/')
}

/**
 * Parse a `File` into a bundle payload. Validates the schema marker
 * and the required top-level fields; returns either the normalized
 * bundle or an error report. Does NOT touch workspace state — that's
 * the caller's job (so the caller can confirm before clobbering).
 *
 * @param {File} file
 * @returns {Promise<ParsedBundleResult>}
 */
export async function parseBundleFile(file) {
  const text = await file.text()
  /** @type {{ severity: 'error'|'warn', message: string }[]} */
  const issues = []

  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return {
      sourceFilename: file.name,
      ok: false,
      bundle: null,
      issues: [
        {
          severity: 'error',
          message: `Could not parse JSON: ${e instanceof Error ? e.message : String(e)}.`,
        },
      ],
    }
  }

  if (!isBundlePayload(raw)) {
    return {
      sourceFilename: file.name,
      ok: false,
      bundle: null,
      issues: [
        {
          severity: 'error',
          message:
            'This file does not look like a ShipSync bundle. Expected `schema: "shipsync.bundle/v1"`.',
        },
      ],
    }
  }

  const obj = /** @type {Record<string, unknown>} */ (raw)
  const schema = String(obj.schema)
  if (schema !== BUNDLE_SCHEMA) {
    issues.push({
      severity: 'warn',
      message: `Bundle was written by a different schema (${schema}); loading anyway.`,
    })
  }

  const ships =
    obj.ships && typeof obj.ships === 'object'
      ? /** @type {Record<string, import('../domain/types.js').Ship>} */ (
          /** @type {unknown} */ (obj.ships)
        )
      : null
  if (!ships) {
    return {
      sourceFilename: file.name,
      ok: false,
      bundle: null,
      issues: [...issues, { severity: 'error', message: '`ships` map is missing or invalid.' }],
    }
  }

  const rawOrder = Array.isArray(obj.shipOrder) ? obj.shipOrder : []
  /** @type {string[]} */
  const shipOrder = []
  let droppedOrderIds = 0
  for (const id of rawOrder) {
    if (typeof id !== 'string' || !ships[id]) {
      droppedOrderIds++
      continue
    }
    if (shipOrder.includes(id)) continue
    shipOrder.push(id)
  }
  if (droppedOrderIds > 0) {
    issues.push({
      severity: 'warn',
      message: `Dropped ${droppedOrderIds} stale ship id${droppedOrderIds === 1 ? '' : 's'} from shipOrder.`,
    })
  }
  for (const id of Object.keys(ships)) {
    if (!shipOrder.includes(id)) {
      shipOrder.push(id)
      issues.push({
        severity: 'warn',
        message: `Ship "${id}" wasn't listed in shipOrder; appended at the end.`,
      })
    }
  }

  const scene =
    obj.scene && typeof obj.scene === 'object'
      ? /** @type {import('../domain/types.js').Scene} */ (/** @type {unknown} */ (obj.scene))
      : makeIdleScene()
  if (!obj.scene || typeof obj.scene !== 'object') {
    issues.push({
      severity: 'warn',
      message: 'No scene found in bundle; defaulted to an idle scene.',
    })
  }

  const images =
    obj.images && typeof obj.images === 'object'
      ? /** @type {import('../domain/types.js').ImageStore} */ (/** @type {unknown} */ (obj.images))
      : {}

  /** @type {ShipsyncBundleFile} */
  const bundle = {
    schema: BUNDLE_SCHEMA,
    savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : new Date().toISOString(),
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
    shipOrder,
    ships,
    scene,
    images,
  }

  return { sourceFilename: file.name, ok: true, bundle, issues }
}

/**
 * Walk a single Ship and add every imageId it references to `out`.
 *
 * Re-implemented locally (instead of importing `collectImageIds` from
 * derivations) to avoid pulling the Svelte-runes-laden module into the
 * pure persistence layer's test surface.
 *
 * @param {import('../domain/types.js').Ship} ship
 * @param {Set<string>} out
 */
function collectShipImageIds(ship, out) {
  if (ship.portraitImageId) out.add(ship.portraitImageId)
  if (ship.playerCharacter?.portraitImageId) out.add(ship.playerCharacter.portraitImageId)
  const officers = ship.officers || {}
  for (const station of Object.keys(officers)) {
    const officer = officers[/** @type {keyof typeof officers} */ (station)]
    if (officer?.portraitImageId) out.add(officer.portraitImageId)
  }
  const flown = ship.flags?.flown ?? []
  for (const flag of flown) {
    if (flag?.imageId) out.add(flag.imageId)
  }
}

/**
 * Plain-JS scene clone. We don't need structuredClone here (there are
 * no Map/Set/Date instances inside Scene) and a JSON round-trip is
 * defensive against accidental Svelte proxy leakage.
 *
 * @param {import('../domain/types.js').Scene} scene
 * @returns {import('../domain/types.js').Scene}
 */
function cloneScene(scene) {
  return JSON.parse(JSON.stringify(scene))
}

/**
 * @param {string} stem
 * @returns {string}
 */
function sanitizeStem(stem) {
  const cleaned = stem
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
  return cleaned || 'shipsync-fleet'
}
