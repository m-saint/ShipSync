/**
 * Read one or more `.shipsync.json` files into the workspace.
 * Each file is parsed, migrated, validated, and converted into a ready-to-import payload.
 */

import { migrate } from './migrations/index.js'
import { validateShipFile } from '../domain/validators.js'
import { makeShip, makeEmptyOfficers, normalizeFlagState } from '../domain/derivations.js'
import { STATIONS, PERSISTENT_SHIP_CONDITIONS } from '../domain/rules.js'

/**
 * @typedef {Object} ParsedShipFileResult
 * @property {string} sourceFilename
 * @property {boolean} ok
 * @property {import('../domain/types.js').Ship|null} ship
 * @property {import('../domain/types.js').ImageStore} images
 * @property {import('../domain/validators.js').ValidationIssue[]} issues
 */

/**
 * Read a single File and return a parsed payload (or an error report).
 * @param {File} file
 * @returns {Promise<ParsedShipFileResult>}
 */
export async function parseShipFile(file) {
  const text = await file.text()

  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return {
      sourceFilename: file.name,
      ok: false,
      ship: null,
      images: {},
      issues: [
        {
          severity: 'error',
          path: '',
          message: `Could not parse JSON: ${(e instanceof Error ? e.message : String(e))}.`,
        },
      ],
    }
  }

  const migrated = migrate(raw)
  const validation = validateShipFile(migrated.file)
  /** @type {import('../domain/validators.js').ValidationIssue[]} */
  const issues = [
    ...migrated.warnings.map((w) => ({ severity: /** @type {const} */ ('warn'), path: '', message: w })),
    ...validation.issues,
  ]

  if (!validation.ok) {
    return { sourceFilename: file.name, ok: false, ship: null, images: {}, issues }
  }

  const fileObj = /** @type {import('../domain/types.js').ShipFile} */ (migrated.file)
  const repaired = repairShip(fileObj.ship, issues)

  return {
    sourceFilename: file.name,
    ok: true,
    ship: repaired,
    images: fileObj.images ?? {},
    issues,
  }
}

/**
 * Read a list of files in parallel and return parsed results.
 * @param {File[]|FileList} files
 * @returns {Promise<ParsedShipFileResult[]>}
 */
export async function parseShipFiles(files) {
  const arr = Array.from(files)
  return Promise.all(arr.map(parseShipFile))
}

/**
 * Backfill any missing nested objects on an otherwise-valid Ship so it matches the runtime shape.
 * Logs additional warnings when defaults are applied.
 * @param {import('../domain/types.js').Ship} ship
 * @param {import('../domain/validators.js').ValidationIssue[]} issues
 */
function repairShip(ship, issues) {
  const seed = makeShip({ id: ship.id, name: ship.name, size: ship.size, type: ship.type })
  /** @type {import('../domain/types.js').Ship} */
  const out = {
    ...seed,
    ...ship,
    speed: ship.speed ?? seed.speed,
    hp: ship.hp ?? seed.hp,
    weapons: ship.weapons ?? seed.weapons,
    supplies: ship.supplies ?? seed.supplies,
    resources: ship.resources ?? seed.resources,
    crew: ship.crew ?? seed.crew,
    officers: ship.officers ?? makeEmptyOfficers(),
    mettle: ship.mettle ?? seed.mettle,
    // Normalize legacy single-integer reputations into the four-axis shape
    // (v1.0.2 audit). Pre-v1.0.2 saves stored a signed integer per flag;
    // we coerce positives onto the `good` axis, clamp negatives to 0, and
    // populate the missing `isFaction` field. Newer saves pass through.
    flags: normalizeFlagState(ship.flags ?? seed.flags),
    sceneFlags: ship.sceneFlags ?? seed.sceneFlags,
    fires: ship.fires ?? 0,
    boardedBy: ship.boardedBy ?? null,
    portraitImageId: ship.portraitImageId ?? null,
    playerCharacter: ship.playerCharacter ?? null,
    sessionHistory: ship.sessionHistory ?? [],
    conditions: sanitizePersistentConditions(ship.conditions, issues),
  }
  if (out.officers) {
    for (const station of STATIONS) {
      if (!out.officers[station]) {
        out.officers[station] = { name: null, rank: 1, status: 'active', portraitImageId: null, notes: '' }
        issues.push({
          severity: 'warn',
          path: `ship.officers.${station}`,
          message: `Defaulted vacant ${station} officer station.`,
        })
      } else if (typeof out.officers[station].notes !== 'string') {
        out.officers[station].notes = ''
      }
    }
  }
  if (Array.isArray(out.sessionHistory)) {
    for (const entry of out.sessionHistory) {
      if (typeof entry.sessionDate !== 'string') entry.sessionDate = ''
      if (typeof entry.location !== 'string') entry.location = ''
      if (typeof entry.encounterName !== 'string') entry.encounterName = ''
    }
  }
  return out
}

/**
 * Coerce `conditions` into a deduplicated array of known persistent ids.
 * Older save files predate this field; tolerate that as well as junk values.
 *
 * Legacy ids land here too — pre-v1.0.2 saves used `stricken-colors` for what
 * the rulebook calls "surrendered" (PDF p. 190). We translate it on read so
 * those captains' chips don't disappear in the rename.
 *
 * @param {unknown} raw
 * @param {import('../domain/validators.js').ValidationIssue[]} issues
 * @returns {import('../domain/types.js').PersistentShipCondition[]}
 */
function sanitizePersistentConditions(raw, issues) {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    issues.push({
      severity: 'warn',
      path: 'ship.conditions',
      message: 'Persistent conditions weren’t an array; reset to none.',
    })
    return []
  }
  const knownSet = new Set(PERSISTENT_SHIP_CONDITIONS)
  /** @type {Record<string, import('../domain/types.js').PersistentShipCondition>} */
  const aliasMap = {
    'stricken-colors': 'surrendered',
  }
  const seen = new Set()
  /** @type {import('../domain/types.js').PersistentShipCondition[]} */
  const out = []
  let droppedUnknown = 0
  for (const value of raw) {
    if (typeof value !== 'string') {
      droppedUnknown++
      continue
    }
    const canonical = aliasMap[value] ?? /** @type {any} */ (value)
    if (!knownSet.has(canonical)) {
      droppedUnknown++
      continue
    }
    if (seen.has(canonical)) continue
    seen.add(canonical)
    out.push(/** @type {import('../domain/types.js').PersistentShipCondition} */ (canonical))
  }
  if (droppedUnknown > 0) {
    issues.push({
      severity: 'warn',
      path: 'ship.conditions',
      message: `Dropped ${droppedUnknown} unknown ship condition${droppedUnknown === 1 ? '' : 's'}.`,
    })
  }
  return out
}
