/**
 * Pure derivations + entity factories for ShipSync.
 * Section refs in comments tie each function back to /ship-combat-rules.
 */

import {
  CARDINALS,
  DAMAGE_THRESHOLD_BY_SIZE,
  DEFAULT_AMMO_TYPES,
  DEFAULT_CREW_MAX_BY_SIZE,
  DEFAULT_EXPLOSION_DC_BY_SIZE,
  DEFAULT_HP_MAX_BY_SIZE,
  DEFAULT_MOBILITY_BY_SIZE,
  DEFAULT_SUPPLY_CAPS_BY_SIZE,
  FULL_STAFFED_ACTIONS_PER_TURN,
  HEAVY_WEAPON_ELIGIBLE_TYPES,
  INITIAL_HP_RATIO,
  MIN_BASELINE_METTLE,
  PURSUIT_DEFAULT_ESCAPE_TIMER,
  PURSUIT_DEFAULT_GAP,
  RANGE_CONE_SQUARES,
  REPUTATION_AXES,
  SHIP_TYPE_PROFILES,
  SHORT_STAFFED_ACTIONS_PER_TURN,
  STATIONS,
} from './rules.js'

/** Generate a stable, URL-safe id. Browser crypto.randomUUID() preferred; fall back if unavailable. */
export function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Last-resort fallback for older runtimes; not as collision-safe but fine for one-user files.
  return 'id-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

export function nowIso() {
  return new Date().toISOString()
}

/**
 * @param {import('./types.js').ShipSize} size
 * @returns {number}
 */
export function damageThresholdFor(size) {
  return DAMAGE_THRESHOLD_BY_SIZE[size]
}

/**
 * @param {import('./types.js').ShipSize} size
 * @returns {number}
 */
export function defaultHpMaxFor(size) {
  return DEFAULT_HP_MAX_BY_SIZE[size]
}

/**
 * @param {import('./types.js').ShipSize} size
 * @returns {number}
 */
export function defaultExplosionDCFor(size) {
  return DEFAULT_EXPLOSION_DC_BY_SIZE[size]
}

/**
 * @param {import('./types.js').ShipSize} size
 * @returns {number}
 */
export function defaultCrewMaxFor(size) {
  return DEFAULT_CREW_MAX_BY_SIZE[size]
}

/**
 * Default mobility for a given size — Tiny/Small skew high, Medium/Large
 * balanced, Huge/Gargantuan low (PDF p. 169 Ship Hit Points and Mobility
 * table). Captains can still override on the form for ships that
 * intentionally break the pattern.
 *
 * @param {import('./types.js').ShipSize} size
 * @returns {import('./types.js').Mobility}
 */
export function defaultMobilityFor(size) {
  return DEFAULT_MOBILITY_BY_SIZE[size]
}

/**
 * Default per-track supply caps for a given size, used by the SuppliesSection
 * stepper when the ship type isn't a canonical entry from `SHIP_TYPE_PROFILES`.
 *
 * @param {import('./types.js').ShipSize} size
 */
export function defaultSupplyCapsFor(size) {
  return DEFAULT_SUPPLY_CAPS_BY_SIZE[size]
}

/**
 * Look up the canonical ship-type profile for a free-text type string.
 * Case- and whitespace-insensitive. Returns `null` for unknown types so the
 * caller can fall back to size-keyed defaults without throwing.
 *
 * @param {string|undefined|null} type
 * @returns {import('./rules.js').ShipTypeProfile|null}
 */
export function shipTypeProfileFor(type) {
  if (typeof type !== 'string') return null
  const key = type.trim().toLowerCase()
  if (!key) return null
  for (const [name, profile] of Object.entries(SHIP_TYPE_PROFILES)) {
    if (name.toLowerCase() === key) return profile
  }
  return null
}

/**
 * Resolve the supply caps to surface in the SuppliesSection. Canonical
 * types route to the `SHIP_TYPE_PROFILES` table; everything else falls back
 * to the per-size defaults so a free-text Caravel-shaped ship still gets
 * sensible cap suggestions.
 *
 * @param {Pick<import('./types.js').Ship, 'size' | 'type'>} ship
 * @returns {{ grub: number, grog: number, gear: number }}
 */
export function supplyCapsForShip(ship) {
  const profile = shipTypeProfileFor(ship.type)
  if (profile) return profile.supplyCaps
  return defaultSupplyCapsFor(ship.size)
}

/**
 * Default skeleton-crew threshold per the PDF: half the ship's full
 * crew complement (PDF p. 198 — "Short Staffed"). At or below this number
 * the crew can take only one of Movement / Attack / Status this round.
 *
 * @param {number} crewMax
 * @returns {number}
 */
export function skeletonCrewFor(crewMax) {
  const max = Math.max(1, Math.floor(Number(crewMax) || 0))
  return Math.max(1, Math.floor(max / 2))
}

/**
 * Build a fresh, all-zeroes Reputation tally.
 * @returns {import('./types.js').Reputation}
 */
export function makeReputation() {
  return { good: 0, evil: 0, lawful: 0, chaotic: 0 }
}

/**
 * Coerce any persisted reputation shape into the four-axis Reputation. Older
 * `.shipsync.json` files stored reputation as a single signed integer; we
 * interpret a positive number as "good" reputation (the most common interp,
 * since pre-v1.0.2 ShipSync had no concept of axes). Negative numbers are
 * clamped to 0 because the rulebook says reputation can never go negative.
 *
 * Already-shaped objects are normalized to integer ≥ 0 on each axis. Garbage
 * input falls through to a fresh empty Reputation.
 *
 * @param {unknown} raw
 * @returns {import('./types.js').Reputation}
 */
export function normalizeReputation(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { ...makeReputation(), good: Math.max(0, Math.floor(raw)) }
  }
  if (raw && typeof raw === 'object') {
    const out = makeReputation()
    for (const axis of REPUTATION_AXES) {
      const v = /** @type {any} */ (raw)[axis]
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[axis] = Math.max(0, Math.floor(v))
      }
    }
    return out
  }
  return makeReputation()
}

/**
 * Sum across the four reputation axes (PDF p. 200 — "Total Reputation").
 * Faction flags don't accrue ship-level reputation; pass them through and
 * they'll naturally read as 0 because their axes are kept at 0.
 *
 * @param {import('./types.js').Flag} flag
 */
export function flagTotalReputation(flag) {
  if (!flag) return 0
  if (flag.isFaction) return 0
  const rep = flag.reputation
  if (!rep || typeof rep !== 'object') return 0
  let total = 0
  for (const axis of REPUTATION_AXES) {
    const v = /** @type {any} */ (rep)[axis]
    if (typeof v === 'number' && Number.isFinite(v)) total += Math.max(0, Math.floor(v))
  }
  return total
}

/**
 * True iff two Reputation objects agree axis-by-axis (after normalization).
 * @param {unknown} a
 * @param {unknown} b
 */
export function reputationsEqual(a, b) {
  const x = normalizeReputation(a)
  const y = normalizeReputation(b)
  for (const axis of REPUTATION_AXES) {
    if (x[axis] !== y[axis]) return false
  }
  return true
}

/**
 * Squares-from-ship for a given range cone band. 'adjacent' = 0; 'far' = +infinity (offscreen).
 * @param {import('./types.js').RangeBand} band
 * @returns {number}
 */
export function rangeConeSquares(band) {
  switch (band) {
    case 'adjacent':
      return 0
    case 'short':
      return RANGE_CONE_SQUARES.short
    case 'standard':
      return RANGE_CONE_SQUARES.standard
    case 'long':
      return RANGE_CONE_SQUARES.long
    case 'far':
      return Number.POSITIVE_INFINITY
    case 'unknown':
    default:
      return Number.NaN
  }
}

/**
 * Mettle baseline (PDF p. 199 — "Beginning Mettle") = 4 + captain rank
 * + the *currently flying* flag's total reputation. Only the active banner
 * contributes; flags sitting in the locker (or `known` flags) don't count.
 *
 * Display-only — ShipSync never auto-applies the value to the mettle pool;
 * the captain types it in by hand at the table when they want to reset
 * to baseline between fights.
 *
 * @param {import('./types.js').Ship} ship
 * @returns {number}
 */
export function baselineMettle(ship) {
  const captainRank = ship.officers?.captain?.rank ?? 0
  const flyingId = ship.flags?.flyingId ?? null
  const flying = flyingId ? (ship.flags?.flown ?? []).find((f) => f.id === flyingId) : null
  const repTotal = flying ? flagTotalReputation(flying) : 0
  return MIN_BASELINE_METTLE + captainRank + repTotal
}

/**
 * Per-ship rollup of officer health: how many bridge stations are filled and
 * fit, how many are wounded, how many are lost. Used by the OfficerRoster
 * header to surface casualty pressure without scanning ten cards.
 *
 * Counting rules (intentionally aligned with the existing UI semantics):
 *  - `active` requires both a name and `status === 'active'`. An unnamed
 *    station defaults to status='active' but reads as vacant, not as a
 *    fit-for-duty officer.
 *  - `stricken` and `dead` count by status alone (the user can mark a
 *    station as casualty without naming the lost officer; we honor it).
 *  - `vacant` is the residual — total minus the above three buckets.
 *
 * @param {import('./types.js').Ship} ship
 * @returns {{ active: number, stricken: number, dead: number, vacant: number, total: number }}
 */
export function officerCasualtyTally(ship) {
  const officers = ship.officers ? Object.values(ship.officers) : []
  let active = 0
  let stricken = 0
  let dead = 0
  for (const o of officers) {
    if (!o) continue
    if (o.status === 'stricken') stricken++
    else if (o.status === 'dead') dead++
    else if (o.status === 'active' && o.name) active++
  }
  const total = officers.length
  const vacant = Math.max(0, total - active - stricken - dead)
  return { active, stricken, dead, vacant, total }
}

/**
 * §4 If the bridge is at or below skeleton crew, the ship can take 1 action this turn instead of 3.
 * @param {import('./types.js').Ship} ship
 */
export function isSkeletonStaffed(ship) {
  const c = ship.crew
  if (!c) return false
  return c.current <= c.skeleton
}

/**
 * @param {import('./types.js').Ship} ship
 * @returns {number}
 */
export function actionsAllowedThisTurn(ship) {
  return isSkeletonStaffed(ship) ? SHORT_STAFFED_ACTIONS_PER_TURN : FULL_STAFFED_ACTIONS_PER_TURN
}

/**
 * §1 Whether this ship type is eligible to mount heavy weapons.
 * Compares free-text type case-insensitively against the rules-defined list.
 * @param {string} shipType
 */
export function isHeavyWeaponEligible(shipType) {
  if (!shipType) return false
  const t = shipType.trim().toLowerCase()
  return HEAVY_WEAPON_ELIGIBLE_TYPES.some((allowed) => allowed.toLowerCase() === t)
}

/**
 * Latest action timestamp recorded against this ship across all sessions.
 * Returns `null` if the ship has no logged actions yet.
 * @param {import('./types.js').Ship} ship
 * @returns {string|null}
 */
export function latestActionAtForShip(ship) {
  let latest = /** @type {string|null} */ (null)
  for (const session of ship.sessionHistory ?? []) {
    for (const action of session.actions ?? []) {
      if (!action?.timestamp) continue
      if (latest == null || action.timestamp > latest) latest = action.timestamp
    }
  }
  return latest
}

/**
 * Has this ship been mutated since its last on-disk save?
 *
 * - `true` when the latest in-workspace action timestamp is newer than the
 *   recorded save timestamp.
 * - `true` when there's no save timestamp at all (ship has never been written).
 * - `false` when there are no actions yet (e.g. just-imported, no edits).
 *
 * @param {import('./types.js').Ship} ship
 * @param {string|null|undefined} lastSavedAt
 */
export function isShipDirty(ship, lastSavedAt) {
  const latest = latestActionAtForShip(ship)
  if (latest == null) return false
  if (lastSavedAt == null) return true
  return latest > lastSavedAt
}

/**
 * Workspace ships in their on-screen order that have edits since their last save.
 * @param {import('./types.js').WorkspaceState} workspace
 * @returns {import('./types.js').Ship[]}
 */
export function dirtyShips(workspace) {
  /** @type {import('./types.js').Ship[]} */
  const out = []
  for (const id of workspace.shipOrder ?? []) {
    const ship = workspace.ships[id]
    if (!ship) continue
    if (isShipDirty(ship, workspace.lastSavedAtByShipId[id] ?? null)) {
      out.push(ship)
    }
  }
  return out
}

/**
 * §3 Returns flags that appear on multiple ships in the workspace with
 * disagreeing reputation tallies. Compares flags across all ships' `flown`
 * AND `known` arrays, since rep is per-flag and follows the player.
 * Two reputations agree iff every axis matches (after normalization), so a
 * single-axis bump on one ship file is enough to surface a conflict.
 *
 * @param {import('./types.js').Ship[]} ships
 * @returns {import('./types.js').FlagConflict[]}
 */
export function detectFlagConflicts(ships) {
  /** @type {Map<string, { flagName: string, entries: Array<{ shipId: string, shipName: string, reputation: import('./types.js').Reputation }> }>} */
  const byFlag = new Map()

  for (const ship of ships) {
    const allFlagsOnShip = [
      ...(ship.flags?.flown ?? []),
      ...(ship.flags?.known ?? []),
    ]
    const seen = new Set()
    for (const flag of allFlagsOnShip) {
      if (!flag?.id) continue
      if (seen.has(flag.id)) continue
      seen.add(flag.id)

      let bucket = byFlag.get(flag.id)
      if (!bucket) {
        bucket = { flagName: flag.name, entries: [] }
        byFlag.set(flag.id, bucket)
      }
      bucket.entries.push({
        shipId: ship.id,
        shipName: ship.name,
        reputation: normalizeReputation(flag.reputation),
      })
    }
  }

  /** @type {import('./types.js').FlagConflict[]} */
  const conflicts = []
  for (const [flagId, bucket] of byFlag.entries()) {
    if (bucket.entries.length < 2) continue
    const first = bucket.entries[0].reputation
    const allAgree = bucket.entries.every((e) => reputationsEqual(e.reputation, first))
    if (!allAgree) {
      conflicts.push({ flagId, flagName: bucket.flagName, entries: bucket.entries })
    }
  }
  return conflicts
}

/**
 * Factory: a fresh, fully-populated Ship.
 *
 * Defaults are PDF-faithful per the audit (v1.0.2): if the caller supplied a
 * canonical `type` (Sloop, Frigate, Galleon, etc.), the type's profile from
 * page 169/198 wins for size, mobility, hull, speed, weapon slots, crew
 * complement, and heavy-weapon eligibility. Otherwise size-keyed defaults
 * apply (mobility, HP, explosion DC, crew max).
 *
 * Caller may pass overrides for any subset of fields; nested objects merge
 * shallowly. Reputations on supplied flags are normalized so legacy single-
 * integer reputations round-trip safely through the factory.
 *
 * @param {Partial<import('./types.js').Ship>} [overrides]
 * @returns {import('./types.js').Ship}
 */
export function makeShip(overrides = {}) {
  const type = overrides.type ?? ''
  const profile = shipTypeProfileFor(type)
  // Type-derived size wins over default 'medium' but only if no explicit size
  // was supplied — captains chartering a Sloop in a "Medium hull" body of
  // water might want to stretch the Sloop up to medium for narrative reasons.
  const size = overrides.size ?? profile?.size ?? 'medium'
  const hpMax = overrides.hp?.max ?? profile?.hpMax ?? defaultHpMaxFor(size)
  const crewMax = overrides.crew?.max ?? profile?.crewMax ?? defaultCrewMaxFor(size)
  const skeleton = overrides.crew?.skeleton ?? profile?.crewSkeleton ?? skeletonCrewFor(crewMax)

  /** @type {import('./types.js').Ship} */
  const base = {
    id: overrides.id ?? makeId(),
    name: overrides.name ?? 'Unnamed Vessel',
    size,
    type,
    mobility: overrides.mobility ?? profile?.mobility ?? defaultMobilityFor(size),
    speed: overrides.speed ?? { knots: profile?.speedKnots ?? 0, squares: 0 },
    hp: { current: Math.round(hpMax * INITIAL_HP_RATIO), max: hpMax },
    explosionDC: overrides.explosionDC ?? defaultExplosionDCFor(size),
    weapons:
      overrides.weapons ?? {
        bow: profile?.weapons.bow ?? 0,
        port: profile?.weapons.port ?? 0,
        starboard: profile?.weapons.starboard ?? 0,
        stern: profile?.weapons.stern ?? 0,
        heavyEligible: profile?.heavyEligible ?? isHeavyWeaponEligible(type),
      },
    supplies: overrides.supplies ?? { grub: 0, grog: 0, gear: 0 },
    resources:
      overrides.resources ?? {
        fuel: 0,
        ammoByType: Object.fromEntries(DEFAULT_AMMO_TYPES.map((k) => [k, 0])),
      },
    crew: overrides.crew ?? {
      current: crewMax,
      max: crewMax,
      skeleton,
    },
    officers: overrides.officers ?? makeEmptyOfficers(),
    mettle: overrides.mettle ?? { current: MIN_BASELINE_METTLE, notes: '' },
    flags: overrides.flags
      ? normalizeFlagState(overrides.flags)
      : { flown: [], known: [], flyingId: null },
    sceneFlags: overrides.sceneFlags ?? {
      inIrons: false,
      hasWeatherGage: false,
      adjacentToShipIds: [],
      facing: null,
      speedZero: true,
    },
    fires: overrides.fires ?? 0,
    boardedBy: overrides.boardedBy ?? null,
    portraitImageId: overrides.portraitImageId ?? null,
    playerCharacter: overrides.playerCharacter ?? null,
    sessionHistory: overrides.sessionHistory ?? [],
    conditions: overrides.conditions ?? [],
  }
  return base
}

/**
 * Normalize a FlagState in place: each flag in `flown` / `known` gets its
 * reputation coerced into the four-axis Reputation shape, and missing
 * `isFaction` defaults to false. Used by makeShip and by repairShip during
 * file load so legacy saves are forward-compatible.
 *
 * @param {import('./types.js').FlagState} flags
 * @returns {import('./types.js').FlagState}
 */
export function normalizeFlagState(flags) {
  return {
    flown: (flags?.flown ?? []).map(normalizeFlag),
    known: (flags?.known ?? []).map(normalizeFlag),
    flyingId: flags?.flyingId ?? null,
  }
}

/**
 * @param {import('./types.js').Flag} flag
 * @returns {import('./types.js').Flag}
 */
export function normalizeFlag(flag) {
  return {
    id: flag.id,
    name: flag.name ?? '',
    isFalse: Boolean(flag.isFalse),
    isPirate: Boolean(flag.isPirate),
    isFaction: Boolean(flag.isFaction),
    artImageId: flag.artImageId ?? null,
    reputation: normalizeReputation(flag.reputation),
  }
}

/**
 * Factory: a fresh ephemeral SceneShip with the same defaults as a player ship of
 * the same size, but without the persistent gear (officers, supplies, flags, log).
 * @param {Partial<import('./types.js').SceneShip>} [overrides]
 * @returns {import('./types.js').SceneShip}
 */
export function makeSceneShip(overrides = {}) {
  const size = overrides.size ?? 'medium'
  const hpMax = overrides.hp?.max ?? defaultHpMaxFor(size)
  return {
    id: overrides.id ?? makeId(),
    name: overrides.name ?? 'Unnamed Vessel',
    size,
    mobility: overrides.mobility ?? defaultMobilityFor(size),
    disposition: overrides.disposition ?? 'unknown',
    hp: overrides.hp ?? { current: hpMax, max: hpMax },
    explosionDC: overrides.explosionDC ?? defaultExplosionDCFor(size),
    fires: overrides.fires ?? 0,
    threat: overrides.threat ?? '',
  }
}

/**
 * Factory: a fresh Pursuit tracker (PDF p. 181). Gap defaults to 6 (the
 * page-181 starting "six counters" baseline); the chase is on, but neither
 * the pursuer (Gap → 0) nor the quarry (Gap → 10+) is winning yet. The
 * escape timer defaults to 6 rounds — the page-181 "reasonable number" —
 * which the captain can shorten or lengthen in the dialog.
 *
 * @returns {import('./types.js').Pursuit}
 */
export function makePursuit() {
  return {
    active: true,
    pursuerId: null,
    quarryId: null,
    gap: PURSUIT_DEFAULT_GAP,
    escapeTimer: PURSUIT_DEFAULT_ESCAPE_TIMER,
    escapeCondition: '',
  }
}

/**
 * Factory: fresh empty officer roster with all 10 stations vacant.
 * @returns {import('./types.js').Officers}
 */
export function makeEmptyOfficers() {
  /** @type {Partial<import('./types.js').Officers>} */
  const out = {}
  for (const station of STATIONS) {
    out[station] = { name: null, rank: 1, status: 'active', portraitImageId: null, notes: '' }
  }
  return /** @type {import('./types.js').Officers} */ (out)
}

/**
 * Factory: a fresh Scene at idle, north wind, no scene ships, no pursuit.
 * @returns {import('./types.js').Scene}
 */
export function makeIdleScene() {
  return {
    mode: 'idle',
    windDirection: 'N',
    weatherGageHolderId: null,
    round: 0,
    phase: 'idle',
    sceneShips: {},
    sceneShipOrder: [],
    pursuit: null,
    shipConditions: {},
  }
}

/**
 * Factory: a fresh empty workspace.
 * @returns {import('./types.js').Workspace}
 */
export function makeEmptyWorkspace() {
  return {
    ships: {},
    shipOrder: [],
    scene: makeIdleScene(),
    images: {},
    focusedShipId: null,
    lastSavedAtByShipId: {},
    workspaceSessionId: null,
  }
}

/**
 * Factory: a ShipFile envelope around a Ship plus only its referenced images.
 * @param {import('./types.js').Ship} ship
 * @param {import('./types.js').ImageStore} workspaceImages
 * @param {{ lastSavedBy?: string|null }} [opts]
 * @returns {import('./types.js').ShipFile}
 */
export function makeShipFile(ship, workspaceImages, opts = {}) {
  const referenced = collectImageIds(ship)
  /** @type {import('./types.js').ImageStore} */
  const images = {}
  for (const id of referenced) {
    if (workspaceImages[id]) images[id] = workspaceImages[id]
  }
  return {
    schemaVersion: 1,
    createdAt: nowIso(),
    lastSavedBy: opts.lastSavedBy ?? null,
    ship,
    images,
  }
}

/**
 * Walks a Ship and returns every imageId it references (portrait, PC portrait, officer portraits, flag art).
 * @param {import('./types.js').Ship} ship
 * @returns {Set<string>}
 */
export function collectImageIds(ship) {
  const ids = new Set()
  if (ship.portraitImageId) ids.add(ship.portraitImageId)
  if (ship.playerCharacter?.portraitImageId) ids.add(ship.playerCharacter.portraitImageId)
  for (const station of STATIONS) {
    const id = ship.officers?.[station]?.portraitImageId
    if (id) ids.add(id)
  }
  for (const flag of ship.flags?.flown ?? []) {
    if (flag.artImageId) ids.add(flag.artImageId)
  }
  for (const flag of ship.flags?.known ?? []) {
    if (flag.artImageId) ids.add(flag.artImageId)
  }
  return ids
}

/**
 * Unified list of every ship currently visible in the workspace — both persistent
 * player ships and ephemeral scene ships — in a stable display order. Used by
 * the Weather Gage and Pursuit pickers, which can both reference either kind.
 *
 * Player ships come first (they're the user's "home fleet"), then scene ships in
 * the order they were sighted. Each entry carries `kind` so the UI can label or
 * group entries differently if it wants to.
 *
 * @typedef {Object} AnyShipRef
 * @property {string} id
 * @property {string} name
 * @property {'player'|'scene'} kind
 */

/**
 * @param {import('./types.js').Workspace} workspace
 * @returns {AnyShipRef[]}
 */
export function allShipsForReference(workspace) {
  /** @type {AnyShipRef[]} */
  const out = []
  for (const id of workspace.shipOrder ?? []) {
    const ship = workspace.ships[id]
    if (ship) out.push({ id: ship.id, name: ship.name, kind: 'player' })
  }
  for (const id of workspace.scene?.sceneShipOrder ?? []) {
    const ship = workspace.scene?.sceneShips?.[id]
    if (ship) out.push({ id: ship.id, name: ship.name, kind: 'scene' })
  }
  return out
}

/**
 * §6.0 Returns the wind direction immediately clockwise of the given direction. Display helper.
 * @param {import('./types.js').Cardinal} dir
 * @returns {import('./types.js').Cardinal}
 */
export function nextCardinal(dir) {
  const i = CARDINALS.indexOf(dir)
  if (i < 0) return 'N'
  return CARDINALS[(i + 1) % CARDINALS.length]
}

/**
 * Approximate byte size of a base64 data URL. Decoded bytes ≈ (raw length × 3) / 4
 * minus the prefix. We don't need to be exact — this is for budgeting warnings.
 * @param {string} dataUrl
 */
export function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) return 0
  const commaAt = dataUrl.indexOf(',')
  const payloadLen = commaAt >= 0 ? dataUrl.length - commaAt - 1 : dataUrl.length
  return Math.floor((payloadLen * 3) / 4)
}

/**
 * Sum of approximate bytes across an entire image store.
 * @param {import('./types.js').ImageStore | null | undefined} images
 */
export function sumImageBytes(images) {
  if (!images) return 0
  let total = 0
  for (const value of Object.values(images)) {
    total += estimateDataUrlBytes(value)
  }
  return total
}

/**
 * Heuristic 4 / Q6: nautical voice helpers — used in headlines and empty states only.
 * Centralizing here keeps copy consistent across views.
 */
export const NauticalCopy = Object.freeze({
  emptyWorkspaceTitle: 'No ships at anchor.',
  emptyWorkspaceBody: 'Load a ship from a save file or charter a fresh vessel to begin.',
  emptyDetailTitle: 'Pick a ship, captain.',
  emptyDetailBody: 'Select a vessel from the rail to inspect her decks.',
  emptyLogTitle: 'No wake yet.',
  emptyLogBody: 'Each change you commit to a ship lists here in order. Undo and redo from the toolbar at any time.',
  emptyOtherShipsTitle: 'Open seas.',
  emptyOtherShipsBody: 'No vessels sighted. Add a sighting when one comes within view.',
})

/**
 * v0.7 — user-recognizable activity-log buckets. Ordered for the segmented picker.
 *
 *  - `combat` covers anything that changes during a fight — mettle/crew/fires/HP,
 *    boarding, all scene state, and condition toggles (both persistent and scene),
 *    since the *event* of toggling a condition is something the player does in the
 *    middle of an exchange even when the chip itself rides along in the ship file.
 *  - `crew` covers officer / PC edits.
 *  - `refit` is the catch-all for ship-identity / inventory / colors edits that
 *    typically happen between fights — name, profile, weapons, supplies, portrait,
 *    flag locker, max-crew / skeleton-mark, and the rest of the workspace verbs.
 *  - `journal` covers every Captain's-Log narrative mutation.
 */
export const ACTION_CATEGORIES = /** @type {const} */ (['combat', 'crew', 'refit', 'journal'])

export const ACTION_CATEGORY_LABELS = {
  combat: 'Combat',
  crew: 'Crew',
  refit: 'Refit',
  journal: 'Journal',
}

/**
 * Bucket a LogAction kind into one of the categories above. Defaults to `refit`
 * for unrecognized kinds — the safest fallback because everything in `refit` is
 * persistent ship-level state.
 *
 * @param {string} kind
 * @returns {'combat'|'crew'|'refit'|'journal'}
 */
export function actionCategory(kind) {
  if (typeof kind !== 'string') return 'refit'
  if (kind.startsWith('scene.')) return 'combat'
  if (
    kind === 'ship.boarding' ||
    kind === 'ship.mettle' ||
    kind === 'ship.mettleNotes' ||
    kind === 'ship.fires' ||
    kind === 'ship.crewCurrent' ||
    kind === 'ship.hp' ||
    kind === 'ship.condition' ||
    kind === 'ship.damage' ||
    kind === 'ship.repair'
  ) {
    return 'combat'
  }
  if (kind.startsWith('officer.') || kind.startsWith('pc.')) return 'crew'
  if (kind.startsWith('session.')) return 'journal'
  return 'refit'
}

/**
 * v0.8 — Format the deltas portion of a damage-composer commit. Given the
 * post-clamp magnitudes that were actually applied (always non-negative), it
 * returns a comma-joined string with explicit signs so the log reads "what
 * just happened to the ship" rather than "what numbers landed where":
 *
 *   "-4 hull, -2 mettle, +1 fire"
 *   "-3 crew, +2 fires"
 *
 * Returns `null` when nothing was applied (every magnitude is 0). Callers
 * use the null return to short-circuit the commit so we don't push empty log
 * lines into the Activity Log.
 *
 * Order is stable (hull → mettle → crew → fires) regardless of input
 * iteration; consumers reading the log shouldn't have to compare two lines
 * with the same fields written in a different order.
 *
 * @param {{ hull?: number, mettle?: number, crew?: number, fires?: number }} damages
 * @returns {string|null}
 */
export function composeDamageDeltas(damages = {}) {
  const hull = Math.max(0, Math.floor(Number(damages.hull) || 0))
  const mettle = Math.max(0, Math.floor(Number(damages.mettle) || 0))
  const crew = Math.max(0, Math.floor(Number(damages.crew) || 0))
  const fires = Math.max(0, Math.floor(Number(damages.fires) || 0))
  const parts = []
  if (hull > 0) parts.push(`-${hull} hull`)
  if (mettle > 0) parts.push(`-${mettle} mettle`)
  if (crew > 0) parts.push(`-${crew} crew`)
  if (fires > 0) parts.push(`+${fires} fire${fires === 1 ? '' : 's'}`)
  return parts.length === 0 ? null : parts.join(', ')
}

/**
 * v0.8 — Build the human-readable summary line for an `applyCombatDamage`
 * commit. Format prefers a free-text source when one is supplied:
 *
 *   without source: "Took damage on Lassie: -4 hull, -2 mettle."
 *   with source:    "Took damage on Lassie (Black Spear broadside): -4 hull, -2 mettle."
 *
 * Returns `null` when the deltas don't add up to anything (composeDamageDeltas
 * returns null), so callers can skip the commit cleanly.
 *
 * @param {{ hull?: number, mettle?: number, crew?: number, fires?: number }} damages
 * @param {string} shipName
 * @param {string} [source]
 * @returns {string|null}
 */
export function composeDamageSummary(damages, shipName, source = '') {
  const deltas = composeDamageDeltas(damages)
  if (deltas == null) return null
  const trimmedSource = String(source ?? '').trim()
  const subject = trimmedSource
    ? `Took damage on ${shipName} (${trimmedSource})`
    : `Took damage on ${shipName}`
  return `${subject}: ${deltas}.`
}

/**
 * v0.8 — Format the deltas portion of a repair-composer commit. Hull is the
 * positive restoration; supply costs are positive consumption that read with
 * a leading minus to match the "what was spent" framing.
 *
 *   "+5 hull"
 *   "+5 hull, -1 gear, -2 grub"
 *   "-1 grog" (rare: the player spent supplies without restoring hull, e.g.
 *              tracking a grog ration from a repair attempt that didn't take)
 *
 * Returns `null` when neither hull was restored nor any supplies were spent.
 *
 * @param {number} hullRestored
 * @param {{ grub?: number, grog?: number, gear?: number }} costs
 * @returns {string|null}
 */
export function composeRepairDeltas(hullRestored, costs = {}) {
  const hull = Math.max(0, Math.floor(Number(hullRestored) || 0))
  const grub = Math.max(0, Math.floor(Number(costs.grub) || 0))
  const grog = Math.max(0, Math.floor(Number(costs.grog) || 0))
  const gear = Math.max(0, Math.floor(Number(costs.gear) || 0))
  const parts = []
  if (hull > 0) parts.push(`+${hull} hull`)
  if (grub > 0) parts.push(`-${grub} grub`)
  if (grog > 0) parts.push(`-${grog} grog`)
  if (gear > 0) parts.push(`-${gear} gear`)
  return parts.length === 0 ? null : parts.join(', ')
}

/**
 * v0.8 — Build the human-readable summary line for an `applyRepair` commit.
 *
 *   without source: "Repairs on Lassie: +5 hull, -1 gear."
 *   with source:    "Repairs on Lassie (shore party): +5 hull, -1 gear."
 *
 * Returns `null` when there's nothing to record.
 *
 * @param {number} hullRestored
 * @param {{ grub?: number, grog?: number, gear?: number }} costs
 * @param {string} shipName
 * @param {string} [source]
 * @returns {string|null}
 */
export function composeRepairSummary(hullRestored, costs, shipName, source = '') {
  const deltas = composeRepairDeltas(hullRestored, costs)
  if (deltas == null) return null
  const trimmedSource = String(source ?? '').trim()
  const subject = trimmedSource
    ? `Repairs on ${shipName} (${trimmedSource})`
    : `Repairs on ${shipName}`
  return `${subject}: ${deltas}.`
}

/**
 * v0.9 — Format the deltas portion of a Shore Leave commit. Unlike repair,
 * supplies are *added* on shore leave (the ship took on stores at port), so
 * every numeric piece reads with a leading `+`. The optional scene-condition
 * clear shows up as a trailing clause separated by `;` because it's a state
 * change rather than a numeric delta:
 *
 *   "+20 hull, +5 grub, +5 grog, +1 gear"
 *   "+20 hull, +5 grub; cleared scene conditions"
 *   "cleared scene conditions" (a refit that only knocked off scene chips)
 *
 * Returns `null` when the call would record nothing — every numeric is 0
 * AND the scene-condition clear flag is false. Callers use the null return
 * to short-circuit the commit.
 *
 * Order is stable (hull → grub → grog → gear), matching the order of the
 * dialog inputs and the existing supply triple in `composeRepairDeltas`.
 *
 * @param {{ hull?: number, grub?: number, grog?: number, gear?: number }} deltas
 * @param {{ clearSceneConditions?: boolean }} [options]
 * @returns {string|null}
 */
export function composeShoreLeaveDeltas(deltas = {}, options = {}) {
  const hull = Math.max(0, Math.floor(Number(deltas.hull) || 0))
  const grub = Math.max(0, Math.floor(Number(deltas.grub) || 0))
  const grog = Math.max(0, Math.floor(Number(deltas.grog) || 0))
  const gear = Math.max(0, Math.floor(Number(deltas.gear) || 0))
  const clearScene = options.clearSceneConditions === true

  const parts = []
  if (hull > 0) parts.push(`+${hull} hull`)
  if (grub > 0) parts.push(`+${grub} grub`)
  if (grog > 0) parts.push(`+${grog} grog`)
  if (gear > 0) parts.push(`+${gear} gear`)

  if (parts.length === 0 && !clearScene) return null

  if (parts.length === 0) return 'cleared scene conditions'
  if (clearScene) return `${parts.join(', ')}; cleared scene conditions`
  return parts.join(', ')
}

/**
 * v0.9 — Build the human-readable summary line for a Shore Leave commit.
 * Mirrors the source-vs-no-source split used by composeDamageSummary /
 * composeRepairSummary, but for the additive refit case:
 *
 *   without source: "Shore leave on Lassie: +20 hull, +5 grub."
 *   with source:    "Shore leave on Lassie (Tortuga): +20 hull, +5 grub; cleared scene conditions."
 *   no deltas:      "Shore leave on Lassie: cleared scene conditions."
 *
 * Returns `null` when neither numerics nor scene-condition clearing was
 * requested, so callers can skip the commit cleanly.
 *
 * @param {{ hull?: number, grub?: number, grog?: number, gear?: number }} deltas
 * @param {{ clearSceneConditions?: boolean }} options
 * @param {string} shipName
 * @param {string} [source]
 * @returns {string|null}
 */
export function composeShoreLeaveSummary(deltas, options, shipName, source = '') {
  const deltasStr = composeShoreLeaveDeltas(deltas, options)
  if (deltasStr == null) return null
  const trimmedSource = String(source ?? '').trim()
  const subject = trimmedSource
    ? `Shore leave on ${shipName} (${trimmedSource})`
    : `Shore leave on ${shipName}`
  return `${subject}: ${deltasStr}.`
}
