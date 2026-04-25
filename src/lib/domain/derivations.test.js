/**
 * Pure-function tests for derivations.js. These pin every numeric default and
 * derivation to the values documented in /ship-combat-rules so accidental
 * tweaks to lookup tables surface immediately.
 */

import { describe, expect, it } from 'vitest'
import {
  ACTION_CATEGORIES,
  actionCategory,
  baselineMettle,
  collectImageIds,
  composeDamageDeltas,
  composeDamageSummary,
  composeRepairDeltas,
  composeRepairSummary,
  composeShoreLeaveDeltas,
  composeShoreLeaveSummary,
  damageThresholdFor,
  defaultCrewMaxFor,
  defaultExplosionDCFor,
  defaultHpMaxFor,
  detectFlagConflicts,
  dirtyShips,
  estimateDataUrlBytes,
  isHeavyWeaponEligible,
  isShipDirty,
  isSkeletonStaffed,
  actionsAllowedThisTurn,
  latestActionAtForShip,
  makeEmptyOfficers,
  makeEmptyWorkspace,
  makeIdleScene,
  makeShip,
  makeShipFile,
  nextCardinal,
  officerCasualtyTally,
  rangeConeSquares,
  sumImageBytes,
} from './derivations.js'
import {
  CARDINALS,
  DAMAGE_THRESHOLD_BY_SIZE,
  DEFAULT_CREW_MAX_BY_SIZE,
  DEFAULT_EXPLOSION_DC_BY_SIZE,
  DEFAULT_HP_MAX_BY_SIZE,
  FULL_STAFFED_ACTIONS_PER_TURN,
  MIN_BASELINE_METTLE,
  RANGE_CONE_SQUARES,
  SHIP_SIZES,
  SHORT_STAFFED_ACTIONS_PER_TURN,
  STATIONS,
} from './rules.js'

describe('size-table lookups', () => {
  it.each(SHIP_SIZES)('damageThresholdFor(%s) matches the rules table', (size) => {
    expect(damageThresholdFor(size)).toBe(DAMAGE_THRESHOLD_BY_SIZE[size])
  })

  it.each(SHIP_SIZES)('defaultHpMaxFor(%s) matches the rules table', (size) => {
    expect(defaultHpMaxFor(size)).toBe(DEFAULT_HP_MAX_BY_SIZE[size])
  })

  it.each(SHIP_SIZES)('defaultExplosionDCFor(%s) matches the rules table', (size) => {
    expect(defaultExplosionDCFor(size)).toBe(DEFAULT_EXPLOSION_DC_BY_SIZE[size])
  })

  it.each(SHIP_SIZES)('defaultCrewMaxFor(%s) matches the rules table', (size) => {
    expect(defaultCrewMaxFor(size)).toBe(DEFAULT_CREW_MAX_BY_SIZE[size])
  })
})

describe('rangeConeSquares', () => {
  it('returns 0 for adjacent', () => {
    expect(rangeConeSquares('adjacent')).toBe(0)
  })

  it('returns the rules-table value for short/standard/long', () => {
    expect(rangeConeSquares('short')).toBe(RANGE_CONE_SQUARES.short)
    expect(rangeConeSquares('standard')).toBe(RANGE_CONE_SQUARES.standard)
    expect(rangeConeSquares('long')).toBe(RANGE_CONE_SQUARES.long)
  })

  it('returns +Infinity for far (offscreen)', () => {
    expect(rangeConeSquares('far')).toBe(Number.POSITIVE_INFINITY)
  })

  it('returns NaN for unknown bands so callers must handle the ambiguity', () => {
    expect(Number.isNaN(rangeConeSquares('unknown'))).toBe(true)
    expect(Number.isNaN(rangeConeSquares(/** @type {any} */ ('not-a-band')))).toBe(true)
  })
})

describe('baselineMettle', () => {
  it('returns the floor for a fresh ship with no flags and rank-1 captain', () => {
    const ship = makeShip()
    expect(baselineMettle(ship)).toBe(MIN_BASELINE_METTLE + 1)
  })

  it('adds captain rank to the floor', () => {
    const ship = makeShip()
    ship.officers.captain.rank = 3
    expect(baselineMettle(ship)).toBe(MIN_BASELINE_METTLE + 3)
  })

  it('uses only the currently-flying flag, summed across the four reputation axes', () => {
    const ship = makeShip()
    ship.officers.captain.rank = 2
    ship.flags.flown = [
      {
        id: 'a',
        name: 'A',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 3, evil: 0, lawful: 1, chaotic: 0 },
      },
      {
        id: 'b',
        name: 'B',
        isFalse: false,
        isPirate: true,
        isFaction: false,
        artImageId: null,
        reputation: { good: 0, evil: 99, lawful: 0, chaotic: 99 },
      },
    ]
    ship.flags.flyingId = 'a'
    // 4 (floor) + 2 (rank) + 4 (good 3 + lawful 1 from flag a only) = 10
    expect(baselineMettle(ship)).toBe(MIN_BASELINE_METTLE + 2 + 4)
  })

  it('counts no flag reputation when no flag is currently flying', () => {
    const ship = makeShip()
    ship.officers.captain.rank = 2
    ship.flags.flown = [
      {
        id: 'a',
        name: 'A',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 5, evil: 0, lawful: 0, chaotic: 0 },
      },
    ]
    ship.flags.flyingId = null
    expect(baselineMettle(ship)).toBe(MIN_BASELINE_METTLE + 2)
  })

  it('treats missing reputation axes as 0', () => {
    const ship = makeShip()
    ship.officers.captain.rank = 1
    ship.flags.flown = [
      {
        id: 'a',
        name: 'A',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: /** @type {any} */ ({}),
      },
    ]
    ship.flags.flyingId = 'a'
    expect(baselineMettle(ship)).toBe(MIN_BASELINE_METTLE + 1)
  })

  it('faction flags contribute zero reputation even when flown', () => {
    const ship = makeShip()
    ship.officers.captain.rank = 1
    ship.flags.flown = [
      {
        id: 'navy',
        name: 'King’s Navy',
        isFalse: false,
        isPirate: false,
        isFaction: true,
        artImageId: null,
        reputation: { good: 99, evil: 0, lawful: 99, chaotic: 0 },
      },
    ]
    ship.flags.flyingId = 'navy'
    expect(baselineMettle(ship)).toBe(MIN_BASELINE_METTLE + 1)
  })
})

describe('officerCasualtyTally', () => {
  it('treats a fresh ship as all vacant (default rosters: status=active, name=null)', () => {
    const ship = makeShip()
    const tally = officerCasualtyTally(ship)
    expect(tally).toEqual({
      active: 0,
      stricken: 0,
      dead: 0,
      vacant: STATIONS.length,
      total: STATIONS.length,
    })
  })

  it('counts active only when both name and status are set', () => {
    const ship = makeShip()
    ship.officers.captain.name = 'Iola Thorne'
    // Officer with name still defaults to status='active', so should count as active.
    const tally = officerCasualtyTally(ship)
    expect(tally.active).toBe(1)
    expect(tally.vacant).toBe(STATIONS.length - 1)
  })

  it('counts stricken / dead by status alone, even without a name', () => {
    const ship = makeShip()
    ship.officers.captain.status = 'stricken'
    ship.officers.boatswain.status = 'dead'
    const tally = officerCasualtyTally(ship)
    expect(tally.stricken).toBe(1)
    expect(tally.dead).toBe(1)
    expect(tally.active).toBe(0)
    expect(tally.vacant).toBe(STATIONS.length - 2)
  })

  it('returns counts that always add up to total', () => {
    const ship = makeShip()
    ship.officers.captain.name = 'Captain'
    ship.officers.boatswain.name = 'Bo'
    ship.officers.boatswain.status = 'stricken'
    ship.officers.surgeon.name = 'Doc'
    ship.officers.surgeon.status = 'dead'
    const t = officerCasualtyTally(ship)
    expect(t.active + t.stricken + t.dead + t.vacant).toBe(t.total)
    expect(t.total).toBe(STATIONS.length)
  })

  it('tolerates a missing officers field (defensive)', () => {
    /** @type {any} */
    const broken = makeShip()
    broken.officers = null
    const t = officerCasualtyTally(broken)
    expect(t).toEqual({ active: 0, stricken: 0, dead: 0, vacant: 0, total: 0 })
  })
})

describe('skeleton-crew helpers', () => {
  it('isSkeletonStaffed: false above threshold, true at or below', () => {
    const ship = makeShip()
    ship.crew = { current: 25, max: 25, skeleton: 7 }
    expect(isSkeletonStaffed(ship)).toBe(false)
    ship.crew.current = 7
    expect(isSkeletonStaffed(ship)).toBe(true)
    ship.crew.current = 3
    expect(isSkeletonStaffed(ship)).toBe(true)
  })

  it('actionsAllowedThisTurn switches at the skeleton boundary', () => {
    const ship = makeShip()
    ship.crew = { current: 25, max: 25, skeleton: 7 }
    expect(actionsAllowedThisTurn(ship)).toBe(FULL_STAFFED_ACTIONS_PER_TURN)
    ship.crew.current = 7
    expect(actionsAllowedThisTurn(ship)).toBe(SHORT_STAFFED_ACTIONS_PER_TURN)
  })
})

describe('isHeavyWeaponEligible', () => {
  it.each([
    ['Frigate', true],
    ['frigate', true],
    ['  GALLEON  ', true],
    ["man o' war", true],
    ['Sloop', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('isHeavyWeaponEligible(%j) === %s', (type, expected) => {
    expect(isHeavyWeaponEligible(/** @type {any} */ (type))).toBe(expected)
  })
})

describe('detectFlagConflicts', () => {
  it('returns no conflicts when all ships agree on a flag rep', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    const flag = {
      id: 'pirate-1',
      name: 'Black Spear',
      isFalse: false,
      isPirate: true,
      isFaction: false,
      artImageId: null,
      reputation: { good: 0, evil: 2, lawful: 0, chaotic: 2 },
    }
    a.flags.flown = [flag]
    b.flags.known = [flag]
    expect(detectFlagConflicts([a, b])).toEqual([])
  })

  it('reports a conflict when the same flag has different rep values', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [
      {
        id: 'flag-x',
        name: 'X',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 2, evil: 0, lawful: 0, chaotic: 0 },
      },
    ]
    b.flags.known = [
      {
        id: 'flag-x',
        name: 'X',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 0, evil: 0, lawful: 0, chaotic: 0 },
      },
    ]
    const conflicts = detectFlagConflicts([a, b])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].flagId).toBe('flag-x')
    const totals = conflicts[0].entries
      .map((e) => e.reputation.good + e.reputation.evil + e.reputation.lawful + e.reputation.chaotic)
      .sort()
    expect(totals).toEqual([0, 2])
  })

  it('reports a conflict on a single-axis disagreement even when totals match', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [
      {
        id: 'flag-z',
        name: 'Z',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 3, evil: 0, lawful: 0, chaotic: 0 },
      },
    ]
    b.flags.known = [
      {
        id: 'flag-z',
        name: 'Z',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 0, evil: 0, lawful: 3, chaotic: 0 },
      },
    ]
    const conflicts = detectFlagConflicts([a, b])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].flagId).toBe('flag-z')
  })

  it('dedupes within a single ship — a flag listed in both flown and known is one entry', () => {
    const a = makeShip({ name: 'A' })
    const flag = {
      id: 'flag-y',
      name: 'Y',
      isFalse: false,
      isPirate: false,
      isFaction: false,
      artImageId: null,
      reputation: { good: 1, evil: 0, lawful: 0, chaotic: 0 },
    }
    a.flags.flown = [flag]
    a.flags.known = [{ ...flag, reputation: { good: 9, evil: 0, lawful: 0, chaotic: 0 } }] // would be a "self-conflict" if not deduped
    expect(detectFlagConflicts([a])).toEqual([])
  })

  it('skips flags missing an id', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [
      {
        id: /** @type {any} */ (''),
        name: 'no-id',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 0, evil: 0, lawful: 0, chaotic: 0 },
      },
    ]
    b.flags.known = [
      {
        id: /** @type {any} */ (''),
        name: 'no-id',
        isFalse: false,
        isPirate: false,
        isFaction: false,
        artImageId: null,
        reputation: { good: 5, evil: 0, lawful: 0, chaotic: 0 },
      },
    ]
    expect(detectFlagConflicts([a, b])).toEqual([])
  })
})

describe('makeShip', () => {
  it('seeds defaults from the size table', () => {
    const ship = makeShip({ size: 'large' })
    expect(ship.hp).toEqual({ current: DEFAULT_HP_MAX_BY_SIZE.large, max: DEFAULT_HP_MAX_BY_SIZE.large })
    expect(ship.explosionDC).toBe(DEFAULT_EXPLOSION_DC_BY_SIZE.large)
    expect(ship.crew.max).toBe(DEFAULT_CREW_MAX_BY_SIZE.large)
    // Skeleton crew is half the max (PDF p. 198), floored, never below 1.
    expect(ship.crew.skeleton).toBe(Math.max(1, Math.floor(DEFAULT_CREW_MAX_BY_SIZE.large / 2)))
  })

  it('respects overrides for hp.max and crew.max', () => {
    const ship = makeShip({
      size: 'medium',
      hp: { current: 30, max: 100 },
      crew: { current: 12, max: 12, skeleton: 3 },
    })
    expect(ship.hp.max).toBe(100)
    expect(ship.crew.max).toBe(12)
    expect(ship.crew.skeleton).toBe(3)
  })

  it('marks the type as heavy-weapon-eligible when applicable', () => {
    const heavy = makeShip({ type: 'Frigate' })
    expect(heavy.weapons.heavyEligible).toBe(true)
    const light = makeShip({ type: 'Cutter' })
    expect(light.weapons.heavyEligible).toBe(false)
  })

  it('defaults skeleton crew to floor(max/2) but never below 1', () => {
    const small = makeShip({ size: 'tiny' })
    expect(small.crew.skeleton).toBeGreaterThanOrEqual(1)
  })

  it('lights up the canonical Sloop profile when the type matches', () => {
    const sloop = makeShip({ type: 'Sloop' })
    expect(sloop.size).toBe('small')
    expect(sloop.mobility).toBe('high')
    expect(sloop.hp.max).toBe(12)
    expect(sloop.crew.max).toBe(24)
    expect(sloop.crew.skeleton).toBe(12)
    expect(sloop.speed.knots).toBe(3)
    expect(sloop.weapons.port).toBe(4)
    expect(sloop.weapons.starboard).toBe(4)
    expect(sloop.weapons.heavyEligible).toBe(false)
  })

  it('lights up the canonical Frigate profile (heavy-weapon eligible)', () => {
    const frigate = makeShip({ type: 'Frigate' })
    expect(frigate.size).toBe('medium')
    expect(frigate.weapons.heavyEligible).toBe(true)
    expect(frigate.crew.max).toBe(52)
    expect(frigate.crew.skeleton).toBe(26)
  })

  it('always seats all 10 stations even when officers are not provided', () => {
    const ship = makeShip()
    for (const station of STATIONS) {
      expect(ship.officers[station]).toMatchObject({ name: null, rank: 1, status: 'active' })
    }
  })

  it('produces unique IDs across calls', () => {
    const a = makeShip()
    const b = makeShip()
    expect(a.id).not.toBe(b.id)
  })
})

describe('makeEmptyOfficers', () => {
  it('returns one entry per station with vacant defaults', () => {
    const officers = makeEmptyOfficers()
    expect(Object.keys(officers).sort()).toEqual([...STATIONS].sort())
    for (const station of STATIONS) {
      expect(officers[station]).toEqual({
        name: null,
        rank: 1,
        status: 'active',
        portraitImageId: null,
        notes: '',
      })
    }
  })
})

describe('makeIdleScene & makeEmptyWorkspace', () => {
  it('idle scene starts at round 0 with N wind', () => {
    const scene = makeIdleScene()
    expect(scene.mode).toBe('idle')
    expect(scene.windDirection).toBe('N')
    expect(scene.round).toBe(0)
    expect(scene.phase).toBe('idle')
    expect(scene.sceneShips).toEqual({})
    expect(scene.sceneShipOrder).toEqual([])
    expect(scene.pursuit).toBeNull()
    expect(scene.weatherGageHolderId).toBeNull()
  })

  it('empty workspace has no ships and no order', () => {
    const ws = makeEmptyWorkspace()
    expect(ws.ships).toEqual({})
    expect(ws.shipOrder).toEqual([])
    expect(ws.focusedShipId).toBeNull()
    expect(ws.lastSavedAtByShipId).toEqual({})
    expect(ws.images).toEqual({})
  })
})

describe('collectImageIds', () => {
  it('walks portrait, PC portrait, officer portraits, and flag art', () => {
    const ship = makeShip()
    ship.portraitImageId = 'img-ship'
    ship.playerCharacter = { characterName: 'PC', traits: '', portraitImageId: 'img-pc' }
    ship.officers.captain.portraitImageId = 'img-cap'
    ship.officers.firstMate.portraitImageId = 'img-mate'
    ship.flags.flown = [
      {
        id: 'f1',
        name: 'F1',
        isFalse: false,
        isPirate: false,
        artImageId: 'img-flag-1',
        reputation: 0,
      },
    ]
    ship.flags.known = [
      {
        id: 'f2',
        name: 'F2',
        isFalse: false,
        isPirate: false,
        artImageId: 'img-flag-2',
        reputation: 0,
      },
    ]
    const ids = collectImageIds(ship)
    expect(ids.has('img-ship')).toBe(true)
    expect(ids.has('img-pc')).toBe(true)
    expect(ids.has('img-cap')).toBe(true)
    expect(ids.has('img-mate')).toBe(true)
    expect(ids.has('img-flag-1')).toBe(true)
    expect(ids.has('img-flag-2')).toBe(true)
    expect(ids.size).toBe(6)
  })

  it('returns an empty set when nothing references images', () => {
    const ship = makeShip()
    expect(collectImageIds(ship).size).toBe(0)
  })
})

describe('makeShipFile', () => {
  it('only bundles images referenced by the ship', () => {
    const ship = makeShip()
    ship.portraitImageId = 'img-1'
    const workspaceImages = {
      'img-1': 'data:image/png;base64,AAA=',
      'img-orphan': 'data:image/png;base64,BBB=',
    }
    const file = makeShipFile(ship, workspaceImages)
    expect(file.schemaVersion).toBe(1)
    expect(file.ship).toBe(ship)
    expect(file.images['img-1']).toBe('data:image/png;base64,AAA=')
    expect(file.images['img-orphan']).toBeUndefined()
  })

  it('records lastSavedBy when provided', () => {
    const ship = makeShip()
    const file = makeShipFile(ship, {}, { lastSavedBy: 'fixture-user' })
    expect(file.lastSavedBy).toBe('fixture-user')
  })
})

describe('estimateDataUrlBytes', () => {
  it('returns 0 for empty / non-string inputs', () => {
    expect(estimateDataUrlBytes('')).toBe(0)
    expect(estimateDataUrlBytes(/** @type {any} */ (null))).toBe(0)
    expect(estimateDataUrlBytes(/** @type {any} */ (undefined))).toBe(0)
  })

  it('approximates decoded byte length from the base64 payload, ignoring the prefix', () => {
    // 4 base64 chars decode to 3 bytes; the prefix is stripped before counting.
    const dataUrl = 'data:image/png;base64,AAAA' // payload length 4 → 3 bytes
    expect(estimateDataUrlBytes(dataUrl)).toBe(3)
  })

  it('still produces a sane estimate when no prefix is present', () => {
    expect(estimateDataUrlBytes('AAAA')).toBe(3)
  })
})

describe('sumImageBytes', () => {
  it('returns 0 for empty / null stores', () => {
    expect(sumImageBytes({})).toBe(0)
    expect(sumImageBytes(/** @type {any} */ (null))).toBe(0)
    expect(sumImageBytes(/** @type {any} */ (undefined))).toBe(0)
  })

  it('totals across every entry in the store', () => {
    const store = {
      a: 'data:image/png;base64,AAAA', // 3 bytes
      b: 'data:image/png;base64,AAAAAAAA', // 6 bytes
      c: 'AAAA', // 3 bytes (no prefix)
    }
    expect(sumImageBytes(store)).toBe(12)
  })
})

describe('dirty-ship derivations', () => {
  /**
   * @param {Array<string>} timestamps action timestamps in ISO order
   */
  function shipWithActions(timestamps) {
    const ship = makeShip()
    ship.sessionHistory = [
      {
        id: 's1',
        workspaceSessionId: 'ws',
        startedAt: timestamps[0] ?? '2026-01-01T00:00:00.000Z',
        endedAt: null,
        title: 'Test',
        narrative: '',
        actions: timestamps.map((ts, i) => ({
          id: `a-${i}`,
          timestamp: ts,
          kind: 'ship.profile',
          summary: 'fixture',
          shipId: ship.id,
          before: {},
          after: {},
        })),
      },
    ]
    return ship
  }

  it('latestActionAtForShip returns null with no actions and the max otherwise', () => {
    expect(latestActionAtForShip(makeShip())).toBeNull()
    const ship = shipWithActions([
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T12:00:00.000Z',
      '2026-01-01T11:00:00.000Z',
    ])
    expect(latestActionAtForShip(ship)).toBe('2026-01-01T12:00:00.000Z')
  })

  it('isShipDirty: never-saved ship with actions is dirty', () => {
    const ship = shipWithActions(['2026-01-01T10:00:00.000Z'])
    expect(isShipDirty(ship, null)).toBe(true)
  })

  it('isShipDirty: just-imported ship with no actions is not dirty', () => {
    expect(isShipDirty(makeShip(), null)).toBe(false)
  })

  it('isShipDirty: action newer than save → dirty; older → clean', () => {
    const ship = shipWithActions(['2026-01-01T11:00:00.000Z'])
    expect(isShipDirty(ship, '2026-01-01T10:00:00.000Z')).toBe(true)
    expect(isShipDirty(ship, '2026-01-01T12:00:00.000Z')).toBe(false)
  })

  it('dirtyShips returns ships in shipOrder that have edits since save', () => {
    const a = shipWithActions(['2026-01-01T10:00:00.000Z'])
    const b = shipWithActions(['2026-01-01T11:00:00.000Z'])
    const c = makeShip()
    const ws = makeEmptyWorkspace()
    ws.ships[a.id] = a
    ws.ships[b.id] = b
    ws.ships[c.id] = c
    ws.shipOrder = [a.id, b.id, c.id]
    ws.lastSavedAtByShipId = {
      [a.id]: '2026-01-01T11:00:00.000Z',
      [b.id]: '2026-01-01T10:00:00.000Z',
    }
    const dirty = dirtyShips(ws)
    expect(dirty.map((s) => s.id)).toEqual([b.id])
  })
})

describe('nextCardinal', () => {
  it('cycles through CARDINALS clockwise', () => {
    let dir = /** @type {import('./types.js').Cardinal} */ ('N')
    const seen = []
    for (let i = 0; i < CARDINALS.length; i++) {
      seen.push(dir)
      dir = nextCardinal(dir)
    }
    expect(seen).toEqual([...CARDINALS])
    expect(dir).toBe('N')
  })

  it('falls back to N for unknown directions', () => {
    expect(nextCardinal(/** @type {any} */ ('zzz'))).toBe('N')
  })
})

describe('actionCategory (v0.7)', () => {
  it('exposes all four buckets in display order', () => {
    expect([...ACTION_CATEGORIES]).toEqual(['combat', 'crew', 'refit', 'journal'])
  })

  it('routes scene.* and rapidly-evolving combat state into combat', () => {
    expect(actionCategory('scene.round')).toBe('combat')
    expect(actionCategory('scene.phase')).toBe('combat')
    expect(actionCategory('scene.shipAdd')).toBe('combat')
    expect(actionCategory('scene.condition')).toBe('combat')
    expect(actionCategory('scene.end')).toBe('combat')
    expect(actionCategory('ship.boarding')).toBe('combat')
    expect(actionCategory('ship.mettle')).toBe('combat')
    expect(actionCategory('ship.mettleNotes')).toBe('combat')
    expect(actionCategory('ship.fires')).toBe('combat')
    expect(actionCategory('ship.crewCurrent')).toBe('combat')
    expect(actionCategory('ship.hp')).toBe('combat')
    expect(actionCategory('ship.condition')).toBe('combat')
  })

  it('routes officer.* and pc.* into crew', () => {
    expect(actionCategory('officer.update')).toBe('crew')
    expect(actionCategory('officer.notes')).toBe('crew')
    expect(actionCategory('officer.portrait')).toBe('crew')
    expect(actionCategory('pc.toggle')).toBe('crew')
    expect(actionCategory('pc.update')).toBe('crew')
    expect(actionCategory('pc.portrait')).toBe('crew')
  })

  it('routes session.* into journal', () => {
    expect(actionCategory('session.update')).toBe('journal')
    expect(actionCategory('session.close')).toBe('journal')
  })

  it('routes ship-identity / inventory / colors into refit (the catch-all)', () => {
    expect(actionCategory('ship.add')).toBe('refit')
    expect(actionCategory('ship.rename')).toBe('refit')
    expect(actionCategory('ship.profile')).toBe('refit')
    expect(actionCategory('ship.weapons')).toBe('refit')
    expect(actionCategory('ship.supplies')).toBe('refit')
    expect(actionCategory('ship.portrait')).toBe('refit')
    expect(actionCategory('ship.crewMax')).toBe('refit')
    expect(actionCategory('ship.crewSkeleton')).toBe('refit')
    expect(actionCategory('ship.flagAdd')).toBe('refit')
    expect(actionCategory('ship.flagFlying')).toBe('refit')
    expect(actionCategory('workspace.clear')).toBe('refit')
  })

  it('falls back to refit for unknown / non-string kinds', () => {
    expect(actionCategory(/** @type {any} */ (null))).toBe('refit')
    expect(actionCategory(/** @type {any} */ (123))).toBe('refit')
    expect(actionCategory('something.brand-new')).toBe('refit')
  })

  it('routes ship.damage and ship.repair into combat (v0.8 composers)', () => {
    expect(actionCategory('ship.damage')).toBe('combat')
    expect(actionCategory('ship.repair')).toBe('combat')
  })
})

describe('composeDamageDeltas (v0.8)', () => {
  it('returns null when every magnitude is zero', () => {
    expect(composeDamageDeltas({})).toBeNull()
    expect(composeDamageDeltas({ hull: 0, mettle: 0, crew: 0, fires: 0 })).toBeNull()
  })

  it('emits explicit signs and singular/plural fires', () => {
    expect(composeDamageDeltas({ hull: 4 })).toBe('-4 hull')
    expect(composeDamageDeltas({ fires: 1 })).toBe('+1 fire')
    expect(composeDamageDeltas({ fires: 3 })).toBe('+3 fires')
    expect(composeDamageDeltas({ hull: 2, mettle: 1, crew: 3, fires: 2 })).toBe(
      '-2 hull, -1 mettle, -3 crew, +2 fires',
    )
  })

  it('uses a stable order regardless of input key order', () => {
    expect(composeDamageDeltas({ fires: 1, hull: 2 })).toBe('-2 hull, +1 fire')
    expect(composeDamageDeltas({ crew: 3, mettle: 1 })).toBe('-1 mettle, -3 crew')
  })

  it('coerces non-numeric / negative inputs to 0', () => {
    expect(composeDamageDeltas({ hull: /** @type {any} */ ('5') })).toBe('-5 hull')
    expect(composeDamageDeltas({ hull: -3 })).toBeNull()
    expect(composeDamageDeltas({ mettle: /** @type {any} */ (Number.NaN) })).toBeNull()
  })

  it('floors fractional inputs', () => {
    expect(composeDamageDeltas({ hull: 2.7, mettle: 1.2 })).toBe('-2 hull, -1 mettle')
  })
})

describe('composeDamageSummary (v0.8)', () => {
  it('returns null when there are no deltas to summarize', () => {
    expect(composeDamageSummary({}, 'Lassie')).toBeNull()
  })

  it('formats the no-source variant', () => {
    expect(composeDamageSummary({ hull: 4, mettle: 2 }, 'Lassie')).toBe(
      'Took damage on Lassie: -4 hull, -2 mettle.',
    )
  })

  it('formats the with-source variant in parentheses', () => {
    expect(
      composeDamageSummary({ hull: 4, fires: 1 }, 'Lassie', 'Black Spear broadside'),
    ).toBe('Took damage on Lassie (Black Spear broadside): -4 hull, +1 fire.')
  })

  it('treats whitespace-only sources as no source', () => {
    expect(composeDamageSummary({ hull: 1 }, 'Lassie', '   ')).toBe(
      'Took damage on Lassie: -1 hull.',
    )
  })

  it('trims surrounding whitespace from source', () => {
    expect(composeDamageSummary({ hull: 1 }, 'Lassie', '  storm   ')).toBe(
      'Took damage on Lassie (storm): -1 hull.',
    )
  })
})

describe('composeRepairDeltas (v0.8)', () => {
  it('returns null when nothing was restored or spent', () => {
    expect(composeRepairDeltas(0, {})).toBeNull()
    expect(composeRepairDeltas(0, { grub: 0, grog: 0, gear: 0 })).toBeNull()
  })

  it('emits hull first, then supply costs in grub → grog → gear order', () => {
    expect(composeRepairDeltas(5, { gear: 1, grub: 2 })).toBe('+5 hull, -2 grub, -1 gear')
    expect(composeRepairDeltas(3, { grog: 1 })).toBe('+3 hull, -1 grog')
  })

  it('handles supplies-only repairs (e.g. botched attempt that still cost grog)', () => {
    expect(composeRepairDeltas(0, { grog: 1 })).toBe('-1 grog')
  })

  it('floors and clamps inputs to non-negative integers', () => {
    expect(composeRepairDeltas(2.9, { grub: -1, gear: /** @type {any} */ ('2') })).toBe(
      '+2 hull, -2 gear',
    )
  })
})

describe('composeRepairSummary (v0.8)', () => {
  it('returns null on an empty repair', () => {
    expect(composeRepairSummary(0, {}, 'Lassie')).toBeNull()
  })

  it('formats the no-source variant', () => {
    expect(composeRepairSummary(5, { gear: 1 }, 'Lassie')).toBe(
      'Repairs on Lassie: +5 hull, -1 gear.',
    )
  })

  it('formats the with-source variant', () => {
    expect(composeRepairSummary(3, { grub: 2 }, 'Lassie', 'shore party')).toBe(
      'Repairs on Lassie (shore party): +3 hull, -2 grub.',
    )
  })

  it('trims source whitespace and treats blank sources as no source', () => {
    expect(composeRepairSummary(2, {}, 'Lassie', '   carpenter  ')).toBe(
      'Repairs on Lassie (carpenter): +2 hull.',
    )
    expect(composeRepairSummary(2, {}, 'Lassie', '   ')).toBe('Repairs on Lassie: +2 hull.')
  })
})

describe('composeShoreLeaveDeltas (v0.9)', () => {
  it('returns null when nothing was added and scene conditions stay', () => {
    expect(composeShoreLeaveDeltas({}, {})).toBeNull()
    expect(composeShoreLeaveDeltas({ hull: 0, grub: 0, grog: 0, gear: 0 }, {})).toBeNull()
    expect(
      composeShoreLeaveDeltas(
        { hull: 0, grub: 0, grog: 0, gear: 0 },
        { clearSceneConditions: false },
      ),
    ).toBeNull()
  })

  it('emits hull first, then grub → grog → gear with positive signs', () => {
    expect(composeShoreLeaveDeltas({ hull: 6, grub: 2, grog: 3, gear: 1 }, {})).toBe(
      '+6 hull, +2 grub, +3 grog, +1 gear',
    )
    expect(composeShoreLeaveDeltas({ hull: 4, gear: 2 }, {})).toBe('+4 hull, +2 gear')
  })

  it('handles supplies-only refits (no hull restored)', () => {
    expect(composeShoreLeaveDeltas({ grog: 5 }, {})).toBe('+5 grog')
  })

  it('appends "cleared scene conditions" when the option is set alongside deltas', () => {
    expect(
      composeShoreLeaveDeltas({ hull: 5, grub: 2 }, { clearSceneConditions: true }),
    ).toBe('+5 hull, +2 grub; cleared scene conditions')
  })

  it('returns the bare clause when only scene conditions were cleared', () => {
    expect(composeShoreLeaveDeltas({}, { clearSceneConditions: true })).toBe(
      'cleared scene conditions',
    )
  })

  it('floors and clamps inputs to non-negative integers', () => {
    expect(
      composeShoreLeaveDeltas(
        { hull: 2.9, grub: -3, gear: /** @type {any} */ ('1') },
        {},
      ),
    ).toBe('+2 hull, +1 gear')
  })
})

describe('composeShoreLeaveSummary (v0.9)', () => {
  it('returns null on a no-op refit', () => {
    expect(composeShoreLeaveSummary({}, {}, 'Lassie')).toBeNull()
  })

  it('formats the no-source variant', () => {
    expect(
      composeShoreLeaveSummary({ hull: 8, grub: 3 }, {}, 'Lassie'),
    ).toBe('Shore leave on Lassie: +8 hull, +3 grub.')
  })

  it('formats the with-source variant', () => {
    expect(
      composeShoreLeaveSummary({ hull: 4, grog: 2 }, {}, 'Lassie', 'Tortuga'),
    ).toBe('Shore leave on Lassie (Tortuga): +4 hull, +2 grog.')
  })

  it('appends scene-clear clause when option is set', () => {
    expect(
      composeShoreLeaveSummary(
        { hull: 5 },
        { clearSceneConditions: true },
        'Lassie',
        'Port Royal',
      ),
    ).toBe('Shore leave on Lassie (Port Royal): +5 hull; cleared scene conditions.')
  })

  it('handles scene-clear-only refits', () => {
    expect(
      composeShoreLeaveSummary({}, { clearSceneConditions: true }, 'Lassie'),
    ).toBe('Shore leave on Lassie: cleared scene conditions.')
  })

  it('trims source whitespace and treats blank sources as no source', () => {
    expect(
      composeShoreLeaveSummary({ hull: 2 }, {}, 'Lassie', '   harbormaster  '),
    ).toBe('Shore leave on Lassie (harbormaster): +2 hull.')
    expect(composeShoreLeaveSummary({ hull: 2 }, {}, 'Lassie', '   ')).toBe(
      'Shore leave on Lassie: +2 hull.',
    )
  })
})
