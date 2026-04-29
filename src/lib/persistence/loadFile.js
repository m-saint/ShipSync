/**
 * Read one or more `.shipsync.json` files into the workspace.
 * Each file is parsed, migrated, validated, and converted into a ready-to-import payload.
 */

import { migrate } from './migrations/index.js'
import { validateShipFile } from '../domain/validators.js'
import {
  makeShip,
  makeEmptyOfficers,
  makeEmptyWeaponInventory,
  normalizeFlagState,
  totalSlotsOccupied,
  WEAPON_SIDES,
} from '../domain/derivations.js'
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
    weaponInventory: ship.weaponInventory ?? seed.weaponInventory,
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
    /*
     * v1.0.4: legacy `sessionHistory` is folded into `lastModifiedAt` by
     * `migrateLegacySessionHistory` below. We pass it through onto `out`
     * for the migrator to read; the migrator clears it before the function
     * returns so the live ship object never carries the dead field.
     */
    sessionHistory: ship.sessionHistory ?? null,
    lastModifiedAt: typeof ship.lastModifiedAt === 'string' ? ship.lastModifiedAt : null,
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
  migrateLegacyPlayerCharacter(out)
  migrateLegacyWeaponInventory(out, issues)
  migrateLegacySessionHistory(out)
  return out
}

/**
 * Weapon-mount inventory normalization (v1.0.4). Older saves predate the
 * `weaponInventory` field entirely, and even fresh saves can have malformed
 * entries when a hand-edited JSON file slips in. Behavior:
 *
 *  - Missing `weaponInventory` → seed an empty inventory (no inferred mounts;
 *    the legacy slot counts in `weapons` are preserved as-is on first load,
 *    and only diverge from the inventory once the captain edits either side).
 *  - Each side's array is filtered to well-formed `WeaponMount` records:
 *    `{ id: string, name: string, slotsOccupied: positive integer }`.
 *  - Slot counts in `weapons` are *raised* to match the inventory's true
 *    occupied count, so the UI never displays an inventory that overflows
 *    its declared capacity. Going the other direction (lowering counts that
 *    were already higher) is the captain's prerogative — we leave a
 *    captain-set higher cap alone since they may be reserving empty slots.
 *
 * Idempotent — calling it twice on the same ship produces the same shape,
 * so it's safe to invoke from the file load path, the bundle load path, and
 * the autosave hydrate path. The `issues` parameter is optional for the
 * non-`repairShip` callers that don't surface validation messages.
 *
 * @param {import('../domain/types.js').Ship} ship — mutated in place.
 * @param {import('../domain/validators.js').ValidationIssue[]} [issues]
 */
export function migrateLegacyWeaponInventory(ship, issues) {
  const raw = ship.weaponInventory
  /** @type {import('../domain/types.js').WeaponInventory} */
  const inventory = makeEmptyWeaponInventory()
  let droppedMounts = 0
  for (const side of WEAPON_SIDES) {
    const list = Array.isArray(raw?.[side]) ? raw[side] : []
    for (const entry of list) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        typeof entry.name === 'string' &&
        Number.isFinite(entry.slotsOccupied) &&
        Number(entry.slotsOccupied) >= 1
      ) {
        inventory[side].push({
          id: entry.id,
          name: entry.name,
          slotsOccupied: Math.max(1, Math.floor(Number(entry.slotsOccupied))),
        })
      } else {
        droppedMounts++
      }
    }
  }
  ship.weaponInventory = inventory
  if (ship.weapons) {
    for (const side of WEAPON_SIDES) {
      const occupied = totalSlotsOccupied(inventory[side])
      const declared = Number.isFinite(ship.weapons[side]) ? Number(ship.weapons[side]) : 0
      if (occupied > declared) {
        ship.weapons[side] = occupied
      }
    }
  }
  if (droppedMounts > 0 && issues) {
    issues.push({
      severity: 'warn',
      path: 'ship.weaponInventory',
      message: `Dropped ${droppedMounts} malformed weapon mount${droppedMounts === 1 ? '' : 's'}.`,
    })
  }
}

/**
 * PC ≡ Captain consolidation (v1.0.4). The legacy `playerCharacter` was a
 * separate ship extension with its own card. As of v1.0.4 the player
 * character is considered synonymous with the captain (the player is
 * assumed to be the captain, or acting on their behalf). On load we fold
 * any populated PC fields onto the captain station — but only into the
 * empty captain slots, so a captain that was already named or annotated
 * won't get overwritten by a stale duplicate from the legacy block.
 *
 * The legacy `playerCharacter` field is then cleared in memory so future
 * saves of this ship don't carry the duplicate. The Ship typedef keeps
 * the field nullable for back-compat reads of older saves still on disk.
 *
 * Idempotent: running it on a ship whose `playerCharacter` is already null
 * is a no-op, so it's safe to call from multiple ingestion points
 * (per-ship file load, bundle load, autosave hydrate).
 *
 * @param {import('../domain/types.js').Ship} ship — mutated in place.
 */
export function migrateLegacyPlayerCharacter(ship) {
  if (!ship?.playerCharacter || !ship.officers?.captain) return
  const pc = ship.playerCharacter
  const captain = ship.officers.captain
  if (
    typeof pc.characterName === 'string' &&
    pc.characterName.trim().length > 0 &&
    (captain.name == null || captain.name.trim().length === 0)
  ) {
    captain.name = pc.characterName.trim()
  }
  if (
    typeof pc.traits === 'string' &&
    pc.traits.trim().length > 0 &&
    (typeof captain.notes !== 'string' || captain.notes.trim().length === 0)
  ) {
    captain.notes = pc.traits
  }
  if (pc.portraitImageId && !captain.portraitImageId) {
    captain.portraitImageId = pc.portraitImageId
  }
  ship.playerCharacter = null
}

/**
 * Legacy session-history fold (v1.0.4). v0.5–v1.0.3 stored a per-ship
 * narrative journal (`sessionHistory`) that the dashboard surfaced as the
 * Captain's Log. v1.0.4 retired that feature — the dirty-state indicator
 * now reads `lastModifiedAt` directly. To stay backward-compatible with
 * older save files we:
 *
 *   1. Find the latest `actions[].timestamp` across every entry's actions
 *      (the same value the old `latestActionAtForShip` used to compute).
 *   2. If the new ship object hasn't already supplied a `lastModifiedAt`,
 *      stamp it with that derived timestamp so the "unsaved" pill
 *      continues to behave the same on reload.
 *   3. Clear `sessionHistory` from the live ship object — the field is no
 *      longer read by anything in the runtime, and dropping it here keeps
 *      future autosaves and exports from re-emitting the dead payload.
 *
 * Idempotent: a ship that's already been through the migrator (no
 * `sessionHistory`, `lastModifiedAt` already set) round-trips unchanged.
 *
 * @param {import('../domain/types.js').Ship & { sessionHistory?: unknown }} ship — mutated in place.
 */
export function migrateLegacySessionHistory(ship) {
  if (!ship) return
  const history = ship.sessionHistory
  if (Array.isArray(history) && history.length > 0) {
    /** @type {string|null} */
    let latest = null
    for (const entry of history) {
      const actions = Array.isArray(entry?.actions) ? entry.actions : []
      for (const action of actions) {
        const ts = action?.timestamp
        if (typeof ts === 'string' && (latest == null || ts > latest)) {
          latest = ts
        }
      }
    }
    if (latest != null && (typeof ship.lastModifiedAt !== 'string' || !ship.lastModifiedAt)) {
      ship.lastModifiedAt = latest
    }
  }
  // Drop the dead field whether it was an array, null, or some legacy junk
  // shape — leaving it on the live ship would let it leak back into autosave.
  if ('sessionHistory' in ship) {
    delete ship.sessionHistory
  }
}

/**
 * Coerce `conditions` into a deduplicated array of known persistent ids.
 * Older save files predate this field; tolerate that as well as junk values.
 *
 * Legacy ids are translated on read:
 *  - `stricken-colors` → `surrendered` (pre-v1.0.2 rename)
 *
 * Retired ids — values ShipSync used to support but no longer does — are
 * silently dropped without surfacing a warning, since the deprecation is
 * intentional, not user error. Unknown values that aren't on the retired
 * list still land in the `Dropped …` warning toast.
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
  // Retired in v1.0.5: dropped Listing as a persistent chip; it wasn't a real
  // rule and the room never used it. Silent so old saves don't bark on load.
  const retiredSet = new Set(['listing'])
  const seen = new Set()
  /** @type {import('../domain/types.js').PersistentShipCondition[]} */
  const out = []
  let droppedUnknown = 0
  for (const value of raw) {
    if (typeof value !== 'string') {
      droppedUnknown++
      continue
    }
    if (retiredSet.has(value)) continue
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
