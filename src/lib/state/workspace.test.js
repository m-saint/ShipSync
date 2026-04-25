/**
 * Tests for the v0.2 ship-edit mutators on the workspace store.
 *
 * The workspace module uses Svelte 5 runes (`$state`) at module scope.
 * That works fine under Vitest as long as the Svelte plugin is registered
 * in the Vite config — runes get compiled to plain reactive accessors and
 * mutate the proxy in place. We reset the workspace between tests via the
 * exported `__resetForTests` helper to keep each case isolated.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetForTests,
  addSceneShip,
  addShip,
  addShipFlag,
  advanceRound,
  applyCombatDamage,
  applyRepair,
  applyShoreLeave,
  closeCurrentSession,
  applyFlagToShips,
  endScene,
  moveShipDown,
  moveShipUp,
  recentActions,
  redo,
  redoableCount,
  removeSceneShip,
  removeShip,
  removeShipFlag,
  setOfficer,
  setOfficerNotes,
  setOfficerPortrait,
  setPlayerCharacterEnabled,
  setPlayerCharacterFields,
  setPlayerCharacterPortrait,
  setPursuit,
  setSceneRound,
  setSceneShip,
  setScenePhase,
  setSceneWind,
  setSessionEntryFields,
  setShipBoardedBy,
  setShipCrewCurrent,
  setShipCrewMax,
  setShipCrewSkeleton,
  setShipExplosionDC,
  setShipFires,
  setShipFlag,
  setShipFlagArt,
  setShipFlagFlying,
  setShipHpCurrent,
  setShipHpMax,
  setShipMettleCurrent,
  setShipMettleNotes,
  setShipMobility,
  setShipName,
  setShipOrder,
  setShipPersistentCondition,
  setShipPortrait,
  setShipSceneCondition,
  setShipSpeed,
  setShipSupplies,
  setShipType,
  setShipWeapons,
  setWeatherGageHolder,
  togglePursuit,
  undo,
  undoableCount,
  workspace,
} from './workspace.svelte.js'

beforeEach(() => {
  __resetForTests()
})

afterEach(() => {
  __resetForTests()
})

/** Convenience: add a ship and return its full state. */
function addBasic(overrides = {}) {
  const id = addShip({ name: 'Test Vessel', size: 'medium', ...overrides })
  return { id, ship: workspace.ships[id] }
}

describe('profile mutators', () => {
  it('setShipName logs old → new and is a no-op for an unchanged value', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setShipName(id, 'Test Vessel') // unchanged
    expect(undoableCount()).toBe(baseline)
    setShipName(id, 'Wavecutter')
    expect(workspace.ships[id].name).toBe('Wavecutter')
    expect(undoableCount()).toBe(baseline + 1)
  })

  it('setShipName trims and ignores empty strings', () => {
    const { id } = addBasic()
    setShipName(id, '   ')
    expect(workspace.ships[id].name).toBe('Test Vessel')
    setShipName(id, '   The Black Spear  ')
    expect(workspace.ships[id].name).toBe('The Black Spear')
  })

  it('setShipType sets and clears type', () => {
    const { id } = addBasic({ type: 'Sloop' })
    setShipType(id, 'Frigate')
    expect(workspace.ships[id].type).toBe('Frigate')
    setShipType(id, '')
    expect(workspace.ships[id].type).toBe('')
  })

  it('setShipMobility flips between options', () => {
    const { id } = addBasic({ mobility: 'balanced' })
    setShipMobility(id, 'high')
    expect(workspace.ships[id].mobility).toBe('high')
    setShipMobility(id, 'high')
    expect(workspace.ships[id].mobility).toBe('high')
  })

  it('setShipSpeed updates either or both components in one commit', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setShipSpeed(id, { knots: 8 })
    setShipSpeed(id, { squares: 3 })
    expect(workspace.ships[id].speed).toEqual({ knots: 8, squares: 3 })
    expect(undoableCount()).toBe(baseline + 2)

    setShipSpeed(id, { knots: -10 })
    expect(workspace.ships[id].speed.knots).toBe(0) // clamped
  })

  it('setShipExplosionDC clamps to ≥ 1', () => {
    const { id } = addBasic()
    setShipExplosionDC(id, 0)
    expect(workspace.ships[id].explosionDC).toBe(1)
    setShipExplosionDC(id, 22)
    expect(workspace.ships[id].explosionDC).toBe(22)
  })

  it('setShipHpMax clamps current down when max drops below current', () => {
    const { id } = addBasic({ hp: { current: 30, max: 30 } })
    setShipHpMax(id, 20)
    expect(workspace.ships[id].hp).toEqual({ current: 20, max: 20 })
  })

  it('setShipHpCurrent stays within [0, max]', () => {
    const { id } = addBasic({ hp: { current: 20, max: 30 } })
    setShipHpCurrent(id, -5)
    expect(workspace.ships[id].hp.current).toBe(0)
    setShipHpCurrent(id, 100)
    expect(workspace.ships[id].hp.current).toBe(30)
    setShipHpCurrent(id, 12)
    expect(workspace.ships[id].hp.current).toBe(12)
  })

  it('setShipWeapons coalesces several slot changes into a single commit', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setShipWeapons(id, { bow: 2, port: 4, starboard: 4, heavyEligible: true })
    expect(undoableCount()).toBe(baseline + 1)
    expect(workspace.ships[id].weapons).toMatchObject({
      bow: 2,
      port: 4,
      starboard: 4,
      stern: 0,
      heavyEligible: true,
    })

    // No-op when nothing actually changes.
    setShipWeapons(id, { bow: 2, heavyEligible: true })
    expect(undoableCount()).toBe(baseline + 1)
  })

  it('setShipSupplies clamps to ≥ 0 and floors fractional input', () => {
    const { id } = addBasic()
    setShipSupplies(id, { grub: -5, grog: 7.8, gear: 3 })
    expect(workspace.ships[id].supplies).toMatchObject({ grub: 0, grog: 7, gear: 3 })
  })

  it('setShipSupplies coalesces multi-track patches into a single commit', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setShipSupplies(id, { grub: 8, grog: 4, gear: 2 })
    expect(undoableCount()).toBe(baseline + 1)
    expect(workspace.ships[id].supplies).toMatchObject({ grub: 8, grog: 4, gear: 2 })

    // No-op when the patch matches the canonical values.
    setShipSupplies(id, { grub: 8, gear: 2 })
    expect(undoableCount()).toBe(baseline + 1)

    // Single-track update is one commit too.
    setShipSupplies(id, { grog: 6 })
    expect(undoableCount()).toBe(baseline + 2)
    expect(workspace.ships[id].supplies.grog).toBe(6)
  })
})

describe('ship portrait', () => {
  it('records the new image, then prunes when cleared', () => {
    const { id } = addBasic()
    setShipPortrait(id, 'data:image/png;base64,AAAA')
    const ship = workspace.ships[id]
    expect(ship.portraitImageId).toBeTruthy()
    expect(workspace.images[ship.portraitImageId ?? '']).toBe('data:image/png;base64,AAAA')

    setShipPortrait(id, null)
    expect(workspace.ships[id].portraitImageId).toBeNull()
    expect(Object.keys(workspace.images)).toHaveLength(0)
  })

  it('replacing keeps the new image and drops the old one', () => {
    const { id } = addBasic()
    setShipPortrait(id, 'data:image/png;base64,AAAA')
    const firstId = workspace.ships[id].portraitImageId
    setShipPortrait(id, 'data:image/png;base64,BBBB')
    const secondId = workspace.ships[id].portraitImageId
    expect(secondId).not.toBe(firstId)
    expect(workspace.images[firstId ?? '']).toBeUndefined()
    expect(workspace.images[secondId ?? '']).toBe('data:image/png;base64,BBBB')
  })
})

describe('officer mutators', () => {
  it('setOfficer updates name/rank/status with one log entry per call', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setOfficer(id, 'captain', { name: 'Captain Iola', rank: 4, status: 'active' })
    expect(workspace.ships[id].officers.captain).toMatchObject({
      name: 'Captain Iola',
      rank: 4,
      status: 'active',
    })
    expect(undoableCount()).toBe(baseline + 1)
  })

  it('setOfficer trims blank names down to null', () => {
    const { id } = addBasic()
    setOfficer(id, 'captain', { name: '   ' })
    expect(workspace.ships[id].officers.captain.name).toBeNull()
  })

  it('setOfficer clamps rank into 1..5', () => {
    const { id } = addBasic()
    setOfficer(id, 'captain', { rank: /** @type {any} */ (99) })
    expect(workspace.ships[id].officers.captain.rank).toBe(5)
    setOfficer(id, 'captain', { rank: /** @type {any} */ (-3) })
    expect(workspace.ships[id].officers.captain.rank).toBe(1)
  })

  it('setOfficer rejects unknown stations', () => {
    const { id } = addBasic()
    expect(() => setOfficer(id, /** @type {any} */ ('bilgePump'), { rank: 1 })).toThrow(/station/i)
  })

  it('setOfficerPortrait round-trips like setShipPortrait', () => {
    const { id } = addBasic()
    setOfficerPortrait(id, 'captain', 'data:image/png;base64,AAAA')
    const captainImg = workspace.ships[id].officers.captain.portraitImageId
    expect(captainImg).toBeTruthy()
    expect(workspace.images[captainImg ?? '']).toBe('data:image/png;base64,AAAA')

    setOfficerPortrait(id, 'captain', null)
    expect(workspace.ships[id].officers.captain.portraitImageId).toBeNull()
    expect(Object.keys(workspace.images)).toHaveLength(0)
  })
})

describe('player character mutators', () => {
  it('toggling on creates a PC seeded from the captain (or ship) name', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setOfficer(id, 'captain', { name: 'Eira Thorne' })
    setPlayerCharacterEnabled(id, true)
    expect(workspace.ships[id].playerCharacter).toEqual({
      characterName: 'Eira Thorne',
      traits: '',
      portraitImageId: null,
    })
  })

  it('toggling off clears the PC and prunes its portrait', () => {
    const { id } = addBasic()
    setPlayerCharacterEnabled(id, true)
    setPlayerCharacterPortrait(id, 'data:image/png;base64,AAAA')
    expect(Object.keys(workspace.images)).toHaveLength(1)
    setPlayerCharacterEnabled(id, false)
    expect(workspace.ships[id].playerCharacter).toBeNull()
    expect(Object.keys(workspace.images)).toHaveLength(0)
  })

  it('setPlayerCharacterFields no-ops without a PC, edits when present', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setPlayerCharacterFields(id, { characterName: 'Iola' })
    expect(undoableCount()).toBe(baseline)

    setPlayerCharacterEnabled(id, true)
    setPlayerCharacterFields(id, { characterName: 'Iola of Vornholt', traits: 'Flinty.' })
    const pc = workspace.ships[id].playerCharacter
    expect(pc).toMatchObject({ characterName: 'Iola of Vornholt', traits: 'Flinty.' })
  })

  it('blank PC name falls back to the ship name', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setPlayerCharacterEnabled(id, true)
    setPlayerCharacterFields(id, { characterName: '   ' })
    expect(workspace.ships[id].playerCharacter?.characterName).toBe('Wavecutter')
  })
})

describe('undo / redo over edit mutators', () => {
  it('undo reverts the most recent edit, redo replays it', () => {
    const { id } = addBasic()
    setShipName(id, 'Wavecutter')
    setShipExplosionDC(id, 18)

    expect(workspace.ships[id].explosionDC).toBe(18)
    undo()
    expect(workspace.ships[id].explosionDC).not.toBe(18)
    expect(redoableCount()).toBe(1)
    redo()
    expect(workspace.ships[id].explosionDC).toBe(18)
  })

  it('image-bearing mutations restore both ship + image store on undo', () => {
    const { id } = addBasic()
    setShipPortrait(id, 'data:image/png;base64,AAAA')
    expect(Object.keys(workspace.images)).toHaveLength(1)
    undo()
    expect(workspace.ships[id].portraitImageId).toBeNull()
    expect(Object.keys(workspace.images)).toHaveLength(0)
  })
})

// ---------- v0.4: scene + boarding mutators ----------

describe('setShipBoardedBy', () => {
  it('starts as null on a fresh ship', () => {
    const { id } = addBasic()
    expect(workspace.ships[id].boardedBy).toBeNull()
  })

  it('trims input and treats blank strings as null', () => {
    const { id } = addBasic()
    setShipBoardedBy(id, '   The Crimson Maw  ')
    expect(workspace.ships[id].boardedBy).toBe('The Crimson Maw')
    setShipBoardedBy(id, '   ')
    expect(workspace.ships[id].boardedBy).toBeNull()
  })

  it('is a no-op when the value would not actually change', () => {
    const { id } = addBasic()
    setShipBoardedBy(id, 'Crimson Maw')
    const baseline = undoableCount()
    setShipBoardedBy(id, '   Crimson Maw   ')
    expect(undoableCount()).toBe(baseline)
  })

  it('round-trips through undo / redo', () => {
    const { id } = addBasic()
    setShipBoardedBy(id, 'Crimson Maw')
    undo()
    expect(workspace.ships[id].boardedBy).toBeNull()
    redo()
    expect(workspace.ships[id].boardedBy).toBe('Crimson Maw')
  })
})

describe('scene ship mutators', () => {
  it('addSceneShip seeds defaults from size, returns id, and appends to order', () => {
    const id = addSceneShip({ name: 'Salt Wraith', size: 'small' })
    expect(workspace.scene.sceneShipOrder).toEqual([id])
    const ship = workspace.scene.sceneShips[id]
    expect(ship).toMatchObject({
      name: 'Salt Wraith',
      size: 'small',
      // Page 169 — Tiny/Small handle high, Medium/Large balanced,
      // Huge/Gargantuan low. A Small scene ship inherits 'high'.
      mobility: 'high',
      disposition: 'unknown',
    })
    expect(ship.hp.current).toBe(ship.hp.max) // full health by default
    expect(ship.fires).toBe(0)
  })

  it('addSceneShip is undoable and writes a single log line', () => {
    const baseline = undoableCount()
    const id = addSceneShip({ name: 'Salt Wraith' })
    expect(undoableCount()).toBe(baseline + 1)
    undo()
    expect(workspace.scene.sceneShips[id]).toBeUndefined()
    expect(workspace.scene.sceneShipOrder).toEqual([])
  })

  it('removeSceneShip clears weather-gage and pursuit references that named it', () => {
    const a = addSceneShip({ name: 'Salt Wraith' })
    const b = addSceneShip({ name: 'Tidemother' })
    setWeatherGageHolder(a)
    togglePursuit(true)
    setPursuit({ pursuerId: a, quarryId: b })
    removeSceneShip(a)
    expect(workspace.scene.sceneShips[a]).toBeUndefined()
    expect(workspace.scene.weatherGageHolderId).toBeNull()
    expect(workspace.scene.pursuit?.pursuerId).toBeNull()
    expect(workspace.scene.pursuit?.quarryId).toBe(b)
    expect(workspace.scene.sceneShipOrder).toEqual([b])
  })

  it('setSceneShip coalesces a multi-field patch into a single commit', () => {
    const id = addSceneShip({ name: 'Salt Wraith', size: 'medium' })
    const baseline = undoableCount()
    setSceneShip(id, { name: 'The Salt Wraith', fires: 2, threat: 'mortars at close range' })
    expect(undoableCount()).toBe(baseline + 1)
    expect(workspace.scene.sceneShips[id]).toMatchObject({
      name: 'The Salt Wraith',
      fires: 2,
      threat: 'mortars at close range',
    })
  })

  it('setSceneShip clamps HP current to [0, max] and floors fractional input', () => {
    const id = addSceneShip({ name: 'Salt Wraith', size: 'medium' })
    setSceneShip(id, { hp: { max: 50, current: 80 } })
    expect(workspace.scene.sceneShips[id].hp).toEqual({ max: 50, current: 50 })
    setSceneShip(id, { hp: { current: -10 } })
    expect(workspace.scene.sceneShips[id].hp.current).toBe(0)
    setSceneShip(id, { fires: 1.7 })
    expect(workspace.scene.sceneShips[id].fires).toBe(1)
  })

  it('setSceneShip is a no-op when the patch matches canonical values', () => {
    const id = addSceneShip({ name: 'Salt Wraith' })
    const baseline = undoableCount()
    setSceneShip(id, { name: 'Salt Wraith', threat: '' })
    expect(undoableCount()).toBe(baseline)
  })

  it('setSceneShip on an unknown id is a silent no-op', () => {
    const baseline = undoableCount()
    setSceneShip('does-not-exist', { name: 'ghost ship' })
    expect(undoableCount()).toBe(baseline)
  })
})

describe('weather gage', () => {
  it('accepts a player ship id, then a scene ship id, then null', () => {
    const { id: playerId } = addBasic({ name: 'Wavecutter' })
    const sceneId = addSceneShip({ name: 'Salt Wraith' })

    setWeatherGageHolder(playerId)
    expect(workspace.scene.weatherGageHolderId).toBe(playerId)

    setWeatherGageHolder(sceneId)
    expect(workspace.scene.weatherGageHolderId).toBe(sceneId)

    setWeatherGageHolder(null)
    expect(workspace.scene.weatherGageHolderId).toBeNull()
  })

  it('is a no-op when the holder would not change', () => {
    const { id } = addBasic()
    setWeatherGageHolder(id)
    const baseline = undoableCount()
    setWeatherGageHolder(id)
    expect(undoableCount()).toBe(baseline)
  })
})

describe('pursuit tracker', () => {
  it('togglePursuit on creates a fresh tracker, off clears it', () => {
    expect(workspace.scene.pursuit).toBeNull()
    togglePursuit(true)
    // Gap defaults to 6 ("the gap line usually starts with six counters",
    // PDF p. 181) and the escape timer to 6 rounds (page-181 "reasonable
    // number"). The tracker opens mid-range so it doesn't fire either the
    // caught (0) or escaped (≥10) alarms.
    expect(workspace.scene.pursuit).toMatchObject({
      active: true,
      pursuerId: null,
      quarryId: null,
      gap: 6,
      escapeTimer: 6,
      escapeCondition: '',
    })
    togglePursuit(false)
    expect(workspace.scene.pursuit).toBeNull()
  })

  it('togglePursuit is a no-op when already in the requested state', () => {
    const baseline = undoableCount()
    togglePursuit(false) // already inactive
    expect(undoableCount()).toBe(baseline)
  })

  it('setPursuit no-ops when the tracker is null', () => {
    const baseline = undoableCount()
    setPursuit({ gap: 4 })
    expect(undoableCount()).toBe(baseline)
    expect(workspace.scene.pursuit).toBeNull()
  })

  it('setPursuit coalesces patches and clamps gap to ≥ 0', () => {
    const { id: playerId } = addBasic({ name: 'Wavecutter' })
    const sceneId = addSceneShip({ name: 'Salt Wraith' })
    togglePursuit(true)
    const baseline = undoableCount()
    setPursuit({
      pursuerId: sceneId,
      quarryId: playerId,
      gap: 4.7,
      escapeCondition: 'reach Port Skerry',
    })
    expect(undoableCount()).toBe(baseline + 1)
    expect(workspace.scene.pursuit).toMatchObject({
      pursuerId: sceneId,
      quarryId: playerId,
      gap: 4,
      escapeCondition: 'reach Port Skerry',
    })

    setPursuit({ gap: -3 })
    expect(workspace.scene.pursuit?.gap).toBe(0)
  })
})

describe('round / phase / wind', () => {
  it('advanceRound steps positively, retreats with a negative step, and clamps to 0', () => {
    advanceRound(2)
    expect(workspace.scene.round).toBe(2)
    advanceRound(-1)
    expect(workspace.scene.round).toBe(1)
    advanceRound(-50) // clamped
    expect(workspace.scene.round).toBe(0)
  })

  it('advanceRound is a no-op for zero or fractional-zero deltas', () => {
    const baseline = undoableCount()
    advanceRound(0)
    expect(undoableCount()).toBe(baseline)
  })

  it('setSceneRound writes an absolute round and clamps to ≥ 0', () => {
    setSceneRound(7)
    expect(workspace.scene.round).toBe(7)
    setSceneRound(0)
    expect(workspace.scene.round).toBe(0)
    setSceneRound(-2) // clamped
    expect(workspace.scene.round).toBe(0)
  })

  it('setSceneRound is a no-op when the value would not change', () => {
    setSceneRound(3)
    const baseline = undoableCount()
    setSceneRound(3)
    expect(undoableCount()).toBe(baseline)
  })

  it('setScenePhase and setSceneWind no-op when unchanged', () => {
    setScenePhase('movement')
    const baseline = undoableCount()
    setScenePhase('movement')
    expect(undoableCount()).toBe(baseline)

    setSceneWind('NE')
    const baseline2 = undoableCount()
    setSceneWind('NE')
    expect(undoableCount()).toBe(baseline2)
  })

  it('setScenePhase / setSceneWind reject unknown values', () => {
    const baseline = undoableCount()
    setScenePhase(/** @type {any} */ ('bilge-pump'))
    setSceneWind(/** @type {any} */ ('UP'))
    expect(undoableCount()).toBe(baseline)
  })
})

describe('scene state round-trip', () => {
  it('undo reverts a scene edit and redo replays it', () => {
    const id = addSceneShip({ name: 'Salt Wraith' })
    setSceneShip(id, { fires: 3 })
    expect(workspace.scene.sceneShips[id].fires).toBe(3)
    undo()
    expect(workspace.scene.sceneShips[id].fires).toBe(0)
    redo()
    expect(workspace.scene.sceneShips[id].fires).toBe(3)
  })

  it('undoing addSceneShip pulls the ship back out of the scene cleanly', () => {
    const id = addSceneShip({ name: 'Salt Wraith' })
    expect(workspace.scene.sceneShipOrder).toEqual([id])
    undo()
    expect(workspace.scene.sceneShipOrder).toEqual([])
    expect(workspace.scene.sceneShips[id]).toBeUndefined()
  })
})

describe('combat resource mutators (v0.5)', () => {
  it('setShipMettleCurrent clamps to ≥ 0 and no-ops on unchanged values', () => {
    const { id } = addBasic()
    const start = workspace.ships[id].mettle.current
    const baseline = undoableCount()
    setShipMettleCurrent(id, start)
    expect(undoableCount()).toBe(baseline)

    setShipMettleCurrent(id, -3)
    expect(workspace.ships[id].mettle.current).toBe(0)
  })

  it('setShipMettleNotes commits text and reads "Cleared" when emptied', () => {
    const { id } = addBasic()
    setShipMettleNotes(id, "low after the storm")
    expect(workspace.ships[id].mettle.notes).toBe('low after the storm')
    expect(recentActions(1)[0].summary).toMatch(/Updated mettle notes/)

    setShipMettleNotes(id, '')
    expect(workspace.ships[id].mettle.notes).toBe('')
    expect(recentActions(1)[0].summary).toMatch(/Cleared mettle notes/)
  })

  it('setShipFires clamps to ≥ 0 and writes summaries showing the current name', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setShipFires(id, 3)
    expect(workspace.ships[id].fires).toBe(3)
    expect(recentActions(1)[0].summary).toBe('Fires 0 → 3 on Wavecutter.')

    setShipFires(id, -2)
    expect(workspace.ships[id].fires).toBe(0)
  })

  it('setShipCrewCurrent clamps to [0, crew.max]', () => {
    const { id } = addBasic()
    const max = workspace.ships[id].crew.max
    setShipCrewCurrent(id, max + 5)
    expect(workspace.ships[id].crew.current).toBe(max)
    setShipCrewCurrent(id, -10)
    expect(workspace.ships[id].crew.current).toBe(0)
  })

  it('setShipCrewMax clamps current down when max drops below current', () => {
    const { id } = addBasic({ crew: { current: 30, max: 30, skeleton: 8 } })
    setShipCrewMax(id, 20)
    expect(workspace.ships[id].crew.current).toBe(20)
    expect(workspace.ships[id].crew.max).toBe(20)
  })

  it('setShipCrewSkeleton clamps to [0, crew.max] and is not coalesced', () => {
    const { id } = addBasic({ crew: { current: 20, max: 20, skeleton: 5 } })
    const baseline = undoableCount()
    setShipCrewSkeleton(id, 200)
    expect(workspace.ships[id].crew.skeleton).toBe(20)
    setShipCrewSkeleton(id, 4)
    expect(workspace.ships[id].crew.skeleton).toBe(4)
    expect(undoableCount()).toBe(baseline + 2)
  })
})

describe('applyCombatDamage (v0.8)', () => {
  it('applies all four resources in a single commit and logs one summary line', () => {
    const { id } = addBasic({
      name: 'Lassie',
      hp: { current: 20, max: 20 },
      mettle: { current: 6, notes: '' },
      crew: { current: 30, max: 30, skeleton: 8 },
    })
    const baseline = undoableCount()
    applyCombatDamage(id, { hull: 4, mettle: 2, crew: 5, fires: 1 }, 'Black Spear broadside')
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(16)
    expect(ship.mettle.current).toBe(4)
    expect(ship.crew.current).toBe(25)
    expect(ship.fires).toBe(1)
    expect(undoableCount()).toBe(baseline + 1)
    expect(recentActions(1)[0].summary).toBe(
      'Took damage on Lassie (Black Spear broadside): -4 hull, -2 mettle, -5 crew, +1 fire.',
    )
    expect(recentActions(1)[0].kind).toBe('ship.damage')
  })

  it('omits the source clause when no source is provided or it is whitespace-only', () => {
    const { id } = addBasic({ name: 'Lassie' })
    applyCombatDamage(id, { hull: 2 })
    expect(recentActions(1)[0].summary).toBe('Took damage on Lassie: -2 hull.')
    applyCombatDamage(id, { mettle: 1 }, '   ')
    expect(recentActions(1)[0].summary).toBe('Took damage on Lassie: -1 mettle.')
  })

  it('clamps each requested damage at the current resource level and reflects only what landed', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      crew: { current: 30, max: 30, skeleton: 8 },
    })
    // makeShip ignores hp.current/mettle.current overrides (current always
    // initializes from max). Set the depleted state directly so we can prove
    // that applyCombatDamage clamps each delta against the ship's *current*
    // value, not its max.
    created.hp.current = 3
    created.mettle.current = 1
    created.crew.current = 2

    applyCombatDamage(id, { hull: 10, mettle: 5, crew: 9 })
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(0)
    expect(ship.mettle.current).toBe(0)
    expect(ship.crew.current).toBe(0)
    expect(recentActions(1)[0].summary).toBe(
      'Took damage on Lassie: -3 hull, -1 mettle, -2 crew.',
    )
  })

  it('is a no-op when every requested delta is zero or already at the floor', () => {
    const { id, ship: created } = addBasic({ name: 'Lassie' })
    created.hp.current = 0
    created.mettle.current = 0
    created.crew.current = 0

    const baseline = undoableCount()
    applyCombatDamage(id, {})
    applyCombatDamage(id, { hull: 0, mettle: 0, crew: 0, fires: 0 })
    applyCombatDamage(id, { hull: 5, mettle: 5, crew: 5 }, 'storm')
    expect(undoableCount()).toBe(baseline)
  })

  it('coerces negative / fractional / non-numeric inputs to safe magnitudes', () => {
    const { id, ship: created } = addBasic({ name: 'Lassie' })
    created.hp.current = 10
    created.mettle.current = 4

    applyCombatDamage(id, {
      hull: -3,
      mettle: 2.7,
      fires: /** @type {any} */ ('1'),
    })
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(10)
    expect(ship.mettle.current).toBe(2)
    expect(ship.fires).toBe(1)
    expect(recentActions(1)[0].summary).toBe('Took damage on Lassie: -2 mettle, +1 fire.')
  })

  it('round-trips through undo/redo as a single step', () => {
    const { id } = addBasic({
      name: 'Lassie',
      hp: { current: 20, max: 20 },
      mettle: { current: 6, notes: '' },
    })
    applyCombatDamage(id, { hull: 4, mettle: 2 }, 'Black Spear broadside')
    undo()
    expect(workspace.ships[id].hp.current).toBe(20)
    expect(workspace.ships[id].mettle.current).toBe(6)
    redo()
    expect(workspace.ships[id].hp.current).toBe(16)
    expect(workspace.ships[id].mettle.current).toBe(4)
  })

  it('does not coalesce successive damage events even within the same round', () => {
    const { id } = addBasic({
      name: 'Lassie',
      hp: { current: 20, max: 20 },
    })
    const baseline = undoableCount()
    applyCombatDamage(id, { hull: 2 }, 'first volley')
    applyCombatDamage(id, { hull: 2 }, 'second volley')
    expect(undoableCount()).toBe(baseline + 2)
    expect(workspace.ships[id].hp.current).toBe(16)
  })

  it('fires accumulate without an upper bound', () => {
    const { id } = addBasic({ name: 'Lassie' })
    applyCombatDamage(id, { fires: 1 })
    applyCombatDamage(id, { fires: 2 })
    expect(workspace.ships[id].fires).toBe(3)
    expect(recentActions(1)[0].summary).toBe('Took damage on Lassie: +2 fires.')
  })
})

describe('applyRepair (v0.8)', () => {
  it('restores hull, deducts supplies, and logs one summary line', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 4, grog: 4, gear: 4 },
    })
    created.hp.current = 8

    const baseline = undoableCount()
    applyRepair(id, 5, { gear: 1, grub: 2 }, 'shore party')
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(13)
    expect(ship.supplies.grub).toBe(2)
    expect(ship.supplies.gear).toBe(3)
    expect(ship.supplies.grog).toBe(4)
    expect(undoableCount()).toBe(baseline + 1)
    expect(recentActions(1)[0].summary).toBe(
      'Repairs on Lassie (shore party): +5 hull, -2 grub, -1 gear.',
    )
    expect(recentActions(1)[0].kind).toBe('ship.repair')
  })

  it('clamps hull restoration at hp.max headroom', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 4, grog: 4, gear: 4 },
    })
    created.hp.max = 20
    created.hp.current = 18

    applyRepair(id, 10, { gear: 1 })
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(20)
    expect(ship.supplies.gear).toBe(3)
    expect(recentActions(1)[0].summary).toBe('Repairs on Lassie: +2 hull, -1 gear.')
  })

  it('clamps supply costs at the ship’s current supply level', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 1, grog: 0, gear: 2 },
    })
    created.hp.current = 10

    applyRepair(id, 3, { grub: 5, grog: 1, gear: 9 })
    const ship = workspace.ships[id]
    expect(ship.supplies.grub).toBe(0)
    expect(ship.supplies.grog).toBe(0)
    expect(ship.supplies.gear).toBe(0)
    expect(recentActions(1)[0].summary).toBe(
      'Repairs on Lassie: +3 hull, -1 grub, -2 gear.',
    )
  })

  it('is a no-op when ship is already at full HP and no supplies were spent', () => {
    const { id } = addBasic({
      name: 'Lassie',
      supplies: { grub: 4, grog: 4, gear: 4 },
    })
    const baseline = undoableCount()
    applyRepair(id, 5, {})
    expect(undoableCount()).toBe(baseline)
  })

  it('still commits a supply-only repair (e.g. botched attempt that ate grog)', () => {
    const { id } = addBasic({
      name: 'Lassie',
      supplies: { grub: 4, grog: 4, gear: 4 },
    })
    applyRepair(id, 0, { grog: 1 }, 'failed shore party')
    expect(workspace.ships[id].supplies.grog).toBe(3)
    expect(recentActions(1)[0].summary).toBe(
      'Repairs on Lassie (failed shore party): -1 grog.',
    )
  })

  it('omits the source clause when no source is provided', () => {
    const { id, ship: created } = addBasic({ name: 'Lassie' })
    created.hp.current = 10
    applyRepair(id, 2, {})
    expect(recentActions(1)[0].summary).toBe('Repairs on Lassie: +2 hull.')
  })

  it('round-trips through undo/redo as a single step', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 4, grog: 4, gear: 4 },
    })
    created.hp.current = 8

    applyRepair(id, 5, { gear: 1 })
    undo()
    expect(workspace.ships[id].hp.current).toBe(8)
    expect(workspace.ships[id].supplies.gear).toBe(4)
    redo()
    expect(workspace.ships[id].hp.current).toBe(13)
    expect(workspace.ships[id].supplies.gear).toBe(3)
  })

  it('does not coalesce successive repair events', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 4, grog: 4, gear: 4 },
    })
    created.hp.current = 5

    const baseline = undoableCount()
    applyRepair(id, 2, { gear: 1 }, 'patch one')
    applyRepair(id, 2, { gear: 1 }, 'patch two')
    expect(undoableCount()).toBe(baseline + 2)
    expect(workspace.ships[id].hp.current).toBe(9)
  })
})

/**
 * Pull the most recent action from a ship's open session entry.
 * Mirrors how JournalSection / per-ship UI surfaces the Captain's Log.
 */
function lastShipLog(shipId) {
  const ship = workspace.ships[shipId]
  if (!ship) return null
  for (let i = ship.sessionHistory.length - 1; i >= 0; i--) {
    const session = ship.sessionHistory[i]
    if (session.actions.length > 0) {
      return session.actions[session.actions.length - 1]
    }
  }
  return null
}

describe('applyShoreLeave (v0.9)', () => {
  it('applies a single-ship shore leave: workspace summary + per-ship log line', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 2, grog: 2, gear: 2 },
    })
    created.hp.current = 8

    const baseline = undoableCount()
    applyShoreLeave([id], { hull: 5, grub: 3, grog: 1 }, {}, 'Tortuga')
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(13)
    expect(ship.supplies.grub).toBe(5)
    expect(ship.supplies.grog).toBe(3)
    expect(ship.supplies.gear).toBe(2)
    expect(undoableCount()).toBe(baseline + 1)

    const workspaceLog = recentActions(1)[0]
    expect(workspaceLog.kind).toBe('workspace.shore-leave')
    expect(workspaceLog.summary).toBe('Shore leave on Lassie (Tortuga).')
    expect(workspaceLog.shipId).toBeNull()

    const shipLog = lastShipLog(id)
    expect(shipLog?.kind).toBe('ship.shore-leave')
    expect(shipLog?.summary).toBe('Shore leave on Lassie (Tortuga): +5 hull, +3 grub, +1 grog.')
  })

  it('formats the workspace summary by ship-count threshold (≤3 names, 4+ count)', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    const c = addShip({ name: 'Interceptor' })
    const d = addShip({ name: 'Dauntless' })
    // Drop each ship 2 below max so a +1 hull restore is meaningful AND a
    // second +1 still has headroom for the four-ship case.
    workspace.ships[a].hp.current = workspace.ships[a].hp.max - 2
    workspace.ships[b].hp.current = workspace.ships[b].hp.max - 2
    workspace.ships[c].hp.current = workspace.ships[c].hp.max - 2
    workspace.ships[d].hp.current = workspace.ships[d].hp.max - 2

    applyShoreLeave([a, b, c], { hull: 1 }, {}, 'Tortuga')
    expect(recentActions(1)[0].summary).toBe(
      'Shore leave on Lassie, Black Pearl, Interceptor (Tortuga).',
    )

    applyShoreLeave([a, b, c, d], { hull: 1 })
    expect(recentActions(1)[0].summary).toBe('Shore leave across 4 ships.')
  })

  it('clamps hull per ship at each hp.max independently', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    const shipA = workspace.ships[a]
    const shipB = workspace.ships[b]
    shipA.hp.max = 20
    shipA.hp.current = 18
    shipB.hp.max = 60
    shipB.hp.current = 40

    applyShoreLeave([a, b], { hull: 30 })
    expect(workspace.ships[a].hp.current).toBe(20)
    expect(workspace.ships[b].hp.current).toBe(60)
    expect(lastShipLog(a)?.summary).toBe('Shore leave on Lassie: +2 hull.')
    expect(lastShipLog(b)?.summary).toBe('Shore leave on Black Pearl: +20 hull.')
  })

  it('adds supplies without an upper bound (additive, not capped)', () => {
    const { id } = addBasic({ name: 'Lassie', supplies: { grub: 99, grog: 0, gear: 5 } })
    applyShoreLeave([id], { grub: 50, grog: 10, gear: 5 })
    expect(workspace.ships[id].supplies.grub).toBe(149)
    expect(workspace.ships[id].supplies.grog).toBe(10)
    expect(workspace.ships[id].supplies.gear).toBe(10)
  })

  it('clears scene conditions on selected ships when option is set', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    workspace.ships[a].hp.current = workspace.ships[a].hp.max - 1
    setShipSceneCondition(a, 'heeling', true)
    setShipSceneCondition(a, 'in-irons', true)
    setShipSceneCondition(b, 'crossing-t', true)

    applyShoreLeave([a, b], { hull: 1 }, { clearSceneConditions: true })
    expect(workspace.scene.shipConditions[a]).toBeUndefined()
    expect(workspace.scene.shipConditions[b]).toBeUndefined()
    expect(lastShipLog(a)?.summary).toBe(
      'Shore leave on Lassie: +1 hull; cleared scene conditions.',
    )
    // Ship b had no hull headroom, but the scene-clear alone is still meaningful.
    expect(lastShipLog(b)?.summary).toBe('Shore leave on Black Pearl: cleared scene conditions.')
  })

  it('skips ships with nothing meaningful to apply (full HP, no clear, supplies-zero) but still commits for the rest', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    // a is at full HP and has no scene conditions; with hull-only deltas it's a no-op for a.
    workspace.ships[b].hp.current = workspace.ships[b].hp.max - 5

    const baseline = undoableCount()
    // Ship a already has a `ship.add` log entry from addShip(); track its
    // count so we can assert no shore-leave entry was appended on top.
    const aLogCountBefore = workspace.ships[a].sessionHistory[0].actions.length
    const bLogCountBefore = workspace.ships[b].sessionHistory[0].actions.length
    applyShoreLeave([a, b], { hull: 5 })
    expect(undoableCount()).toBe(baseline + 1)
    // No new log entry on a; one new shore-leave entry on b.
    expect(workspace.ships[a].sessionHistory[0].actions.length).toBe(aLogCountBefore)
    expect(workspace.ships[b].sessionHistory[0].actions.length).toBe(bLogCountBefore + 1)
    expect(lastShipLog(b)?.summary).toBe('Shore leave on Black Pearl: +5 hull.')
    // Workspace summary only mentions b
    expect(recentActions(1)[0].summary).toBe('Shore leave on Black Pearl.')
  })

  it('is a complete no-op when no ship would receive a meaningful change', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    const baseline = undoableCount()
    // Ships are at full HP (default), no scene conditions, nothing requested.
    applyShoreLeave([a, b], {})
    applyShoreLeave([a, b], { hull: 0, grub: 0, grog: 0, gear: 0 })
    applyShoreLeave([a, b], { hull: 5 }) // hull restored is 0 because at full HP
    expect(undoableCount()).toBe(baseline)
  })

  it('filters unknown ship ids and dedupes repeats while preserving order', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    workspace.ships[a].hp.current = workspace.ships[a].hp.max - 2
    workspace.ships[b].hp.current = workspace.ships[b].hp.max - 2

    applyShoreLeave([a, 'ghost-id', b, a], { hull: 2 })
    // Order is preserved (a first, then b), with the second `a` dropped.
    expect(recentActions(1)[0].summary).toBe('Shore leave on Lassie, Black Pearl.')
  })

  it('round-trips through undo/redo as a single step across all affected ships', () => {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    workspace.ships[a].hp.current = workspace.ships[a].hp.max - 4
    workspace.ships[b].hp.current = workspace.ships[b].hp.max - 4
    setShipSceneCondition(a, 'heeling', true)

    applyShoreLeave([a, b], { hull: 4, grub: 2 }, { clearSceneConditions: true }, 'Port Royal')
    expect(workspace.ships[a].hp.current).toBe(workspace.ships[a].hp.max)
    expect(workspace.ships[b].hp.current).toBe(workspace.ships[b].hp.max)
    expect(workspace.scene.shipConditions[a]).toBeUndefined()

    undo()
    expect(workspace.ships[a].hp.current).toBe(workspace.ships[a].hp.max - 4)
    expect(workspace.ships[b].hp.current).toBe(workspace.ships[b].hp.max - 4)
    expect(workspace.scene.shipConditions[a]).toEqual(['heeling'])

    redo()
    expect(workspace.ships[a].hp.current).toBe(workspace.ships[a].hp.max)
    expect(workspace.ships[b].hp.current).toBe(workspace.ships[b].hp.max)
    expect(workspace.scene.shipConditions[a]).toBeUndefined()
  })

  it('omits the source clause when source is missing or whitespace-only', () => {
    const { id } = addBasic({ name: 'Lassie', supplies: { grub: 0, grog: 0, gear: 0 } })
    applyShoreLeave([id], { grub: 2 })
    expect(recentActions(1)[0].summary).toBe('Shore leave on Lassie.')
    expect(lastShipLog(id)?.summary).toBe('Shore leave on Lassie: +2 grub.')

    applyShoreLeave([id], { grog: 1 }, {}, '   ')
    expect(recentActions(1)[0].summary).toBe('Shore leave on Lassie.')
    expect(lastShipLog(id)?.summary).toBe('Shore leave on Lassie: +1 grog.')
  })

  it('coerces negative / fractional / non-numeric inputs to safe magnitudes', () => {
    const { id, ship: created } = addBasic({
      name: 'Lassie',
      supplies: { grub: 0, grog: 0, gear: 0 },
    })
    created.hp.current = 10

    applyShoreLeave([id], {
      hull: -3,
      grub: 2.7,
      gear: /** @type {any} */ ('1'),
    })
    expect(workspace.ships[id].supplies.grub).toBe(2)
    expect(workspace.ships[id].supplies.gear).toBe(1)
    expect(lastShipLog(id)?.summary).toBe('Shore leave on Lassie: +2 grub, +1 gear.')
  })

  it('handles empty / non-array / unknown-only inputs without throwing or committing', () => {
    const { id } = addBasic({ name: 'Lassie' })
    const baseline = undoableCount()
    applyShoreLeave([], { hull: 5 })
    applyShoreLeave(/** @type {any} */ (null), { hull: 5 })
    applyShoreLeave(['ghost-1', 'ghost-2'], { hull: 5 })
    expect(undoableCount()).toBe(baseline)
    expect(workspace.ships[id].hp.current).toBe(workspace.ships[id].hp.max)
  })
})

describe('per-round commit coalescing', () => {
  it('coalesces sequential same-key edits into one undo entry and one log line', () => {
    const { id } = addBasic({ mettle: { current: 8, notes: '' } })
    const baseline = undoableCount()
    setShipMettleCurrent(id, 7)
    setShipMettleCurrent(id, 6)
    setShipMettleCurrent(id, 5)
    expect(workspace.ships[id].mettle.current).toBe(5)
    expect(undoableCount()).toBe(baseline + 1)

    // The log line summarizes the entire chain: the chain-start "from" value
    // (8) is read out of the captured `before` snapshot.
    expect(recentActions(1)[0].summary).toBe('Mettle 8 → 5 on Test Vessel.')
  })

  it('a single undo unwinds the entire coalesced chain to its chain-start state', () => {
    const { id } = addBasic({ mettle: { current: 8, notes: '' } })
    setShipMettleCurrent(id, 7)
    setShipMettleCurrent(id, 6)
    setShipMettleCurrent(id, 5)
    undo()
    expect(workspace.ships[id].mettle.current).toBe(8)
  })

  it('redo replays a coalesced chain to its latest state', () => {
    const { id } = addBasic({ mettle: { current: 8, notes: '' } })
    setShipMettleCurrent(id, 7)
    setShipMettleCurrent(id, 6)
    undo()
    expect(workspace.ships[id].mettle.current).toBe(8)
    redo()
    expect(workspace.ships[id].mettle.current).toBe(6)
  })

  it('crossing a round boundary breaks coalescing', () => {
    const { id } = addBasic({ mettle: { current: 8, notes: '' } })
    setShipMettleCurrent(id, 7) // round 0
    advanceRound(1) // round 1 — pushes its own undo entry
    const beforeSecondMettle = undoableCount()
    setShipMettleCurrent(id, 6) // round 1, fresh chain
    expect(undoableCount()).toBe(beforeSecondMettle + 1)
  })

  it('different kinds of combat-resource edits do not cross-coalesce', () => {
    const { id } = addBasic({ mettle: { current: 8, notes: '' } })
    setShipMettleCurrent(id, 7)
    const beforeFires = undoableCount()
    setShipFires(id, 1)
    expect(undoableCount()).toBe(beforeFires + 1)
    // Once a different kind has been pushed, the next mettle edit should also
    // be a fresh entry — the chain anchor is the *last* undo entry.
    const beforeMettleAgain = undoableCount()
    setShipMettleCurrent(id, 6)
    expect(undoableCount()).toBe(beforeMettleAgain + 1)
  })

  it('a non-coalescing edit between two same-key edits breaks the chain', () => {
    const { id } = addBasic({ mettle: { current: 8, notes: '' } })
    setShipMettleCurrent(id, 7)
    setShipName(id, 'Wavecutter') // any non-coalescing commit
    const before = undoableCount()
    setShipMettleCurrent(id, 6)
    expect(undoableCount()).toBe(before + 1)
  })

  it('different ships in the same round do not cross-coalesce', () => {
    const { id: a } = addBasic({ name: 'Wavecutter', mettle: { current: 8, notes: '' } })
    const { id: b } = addBasic({ name: 'Salt Wraith', mettle: { current: 8, notes: '' } })
    setShipMettleCurrent(a, 7)
    const before = undoableCount()
    setShipMettleCurrent(b, 7)
    expect(undoableCount()).toBe(before + 1)
  })

  it('mettle notes (non-coalesced) do not merge even within the same round', () => {
    const { id } = addBasic()
    setShipMettleNotes(id, 'first')
    const before = undoableCount()
    setShipMettleNotes(id, 'second')
    expect(undoableCount()).toBe(before + 1)
  })
})

describe('flag mutators (v0.5)', () => {
  it('addShipFlag pushes onto flown, sets flyingId on the first one, and is idempotent on duplicate id', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    const flagId = addShipFlag(id, { name: 'The Black Spear', isPirate: true })
    expect(workspace.ships[id].flags.flown.map((f) => f.id)).toEqual([flagId])
    expect(workspace.ships[id].flags.flyingId).toBe(flagId)
    expect(workspace.ships[id].flags.flown[0].isPirate).toBe(true)

    const baseline = undoableCount()
    const same = addShipFlag(id, { id: flagId, name: 'duplicate' })
    expect(same).toBe(flagId)
    expect(workspace.ships[id].flags.flown).toHaveLength(1)
    expect(undoableCount()).toBe(baseline) // duplicate add was a no-op
  })

  it('addShipFlag inherits reputation from another workspace ship that already flies the same flag id', () => {
    const { id: a } = addBasic({ name: 'Wavecutter' })
    const flagId = addShipFlag(a, { name: 'The Black Spear' })
    setShipFlag(a, flagId, { reputation: { good: 4, evil: 0, lawful: 3, chaotic: 0 } })

    const { id: b } = addBasic({ name: 'Salt Wraith' })
    addShipFlag(b, { id: flagId, name: 'The Black Spear' })

    expect(workspace.ships[b].flags.flown[0].reputation).toEqual({
      good: 4,
      evil: 0,
      lawful: 3,
      chaotic: 0,
    })
  })

  it('setShipFlag propagates reputation to every other ship copy of the same id', () => {
    const { id: a } = addBasic({ name: 'Wavecutter' })
    const { id: b } = addBasic({ name: 'Salt Wraith' })
    const flagId = addShipFlag(a, { name: 'The Black Spear' })
    addShipFlag(b, { id: flagId, name: 'The Black Spear' })

    setShipFlag(a, flagId, { reputation: { good: 5, evil: 0, lawful: 0, chaotic: 7 } })

    const expected = { good: 5, evil: 0, lawful: 0, chaotic: 7 }
    expect(workspace.ships[a].flags.flown[0].reputation).toEqual(expected)
    expect(workspace.ships[b].flags.flown[0].reputation).toEqual(expected)
  })

  it('setShipFlag accepts a partial reputation patch, preserving untouched axes', () => {
    const { id: a } = addBasic({ name: 'Wavecutter' })
    const flagId = addShipFlag(a, { name: 'The Black Spear' })
    setShipFlag(a, flagId, { reputation: { good: 3, evil: 1, lawful: 2, chaotic: 4 } })
    setShipFlag(a, flagId, { reputation: { evil: 5 } })

    expect(workspace.ships[a].flags.flown[0].reputation).toEqual({
      good: 3,
      evil: 5,
      lawful: 2,
      chaotic: 4,
    })
  })

  it('setShipFlag accepts a number reputation as a legacy alias for the good axis', () => {
    const { id: a } = addBasic({ name: 'Wavecutter' })
    const flagId = addShipFlag(a, { name: 'The Black Spear' })
    setShipFlag(a, flagId, { reputation: 4 })

    expect(workspace.ships[a].flags.flown[0].reputation).toEqual({
      good: 4,
      evil: 0,
      lawful: 0,
      chaotic: 0,
    })
  })

  it('setShipFlag keeps name / isFalse / isPirate per-ship (no propagation)', () => {
    const { id: a } = addBasic({ name: 'Wavecutter' })
    const { id: b } = addBasic({ name: 'Salt Wraith' })
    const flagId = addShipFlag(a, { name: 'The Black Spear' })
    addShipFlag(b, { id: flagId, name: 'The Black Spear' })

    setShipFlag(a, flagId, { isFalse: true, name: 'False Spear' })

    expect(workspace.ships[a].flags.flown[0].isFalse).toBe(true)
    expect(workspace.ships[a].flags.flown[0].name).toBe('False Spear')
    expect(workspace.ships[b].flags.flown[0].isFalse).toBe(false)
    expect(workspace.ships[b].flags.flown[0].name).toBe('The Black Spear')
  })

  it('setShipFlag is a no-op for an unknown flag id and for unchanged values', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setShipFlag(id, 'no-such-flag', { reputation: 99 })
    expect(undoableCount()).toBe(baseline)

    const flagId = addShipFlag(id, { name: 'The Black Spear', reputation: 4 })
    const baseline2 = undoableCount()
    setShipFlag(id, flagId, { reputation: 4 }) // unchanged
    expect(undoableCount()).toBe(baseline2)
  })

  it('removeShipFlag drops the flag, repoints flyingId, and prunes its art image', () => {
    const { id } = addBasic()
    const flagId = addShipFlag(id, { name: 'The Black Spear' })
    setShipFlagArt(id, flagId, 'data:image/png;base64,AAA')
    const artId = workspace.ships[id].flags.flown[0].artImageId
    expect(artId).toBeTruthy()
    expect(workspace.images[/** @type {string} */ (artId)]).toBe('data:image/png;base64,AAA')

    removeShipFlag(id, flagId)
    expect(workspace.ships[id].flags.flown).toEqual([])
    expect(workspace.ships[id].flags.flyingId).toBeNull()
    expect(workspace.images[/** @type {string} */ (artId)]).toBeUndefined()
  })

  it('removeShipFlag pivots flyingId to the next remaining flag', () => {
    const { id } = addBasic()
    const a = addShipFlag(id, { name: 'A' })
    const b = addShipFlag(id, { name: 'B' })
    expect(workspace.ships[id].flags.flyingId).toBe(a)
    setShipFlagFlying(id, b)
    expect(workspace.ships[id].flags.flyingId).toBe(b)
    removeShipFlag(id, b)
    expect(workspace.ships[id].flags.flyingId).toBe(a)
  })

  it('setShipFlagFlying validates that the id is in flown', () => {
    const { id } = addBasic()
    const a = addShipFlag(id, { name: 'A' })
    const baseline = undoableCount()
    setShipFlagFlying(id, 'no-such-flag')
    expect(undoableCount()).toBe(baseline)
    expect(workspace.ships[id].flags.flyingId).toBe(a)

    setShipFlagFlying(id, null)
    expect(workspace.ships[id].flags.flyingId).toBeNull()
  })

  it('setShipFlagArt is per-ship and does not bleed to other copies of the same flag', () => {
    const { id: a } = addBasic({ name: 'Wavecutter' })
    const { id: b } = addBasic({ name: 'Salt Wraith' })
    const flagId = addShipFlag(a, { name: 'The Black Spear' })
    addShipFlag(b, { id: flagId, name: 'The Black Spear' })

    setShipFlagArt(a, flagId, 'data:image/png;base64,AAA')

    expect(workspace.ships[a].flags.flown[0].artImageId).not.toBeNull()
    expect(workspace.ships[b].flags.flown[0].artImageId).toBeNull()
  })
})

describe("captain's log narrative mutators (v0.5)", () => {
  /**
   * Adding a ship triggers `appendShipLog` once for the addShip action, which
   * seeds the first SessionEntry. Use that as the starting point for journal
   * tests instead of constructing one by hand.
   */
  function shipWithFreshSession(overrides = {}) {
    const { id } = addBasic(overrides)
    const ship = workspace.ships[id]
    const entry = ship.sessionHistory[ship.sessionHistory.length - 1]
    return { id, entryId: entry.id }
  }

  it('setSessionEntryFields commits title and narrative changes through the log', () => {
    const { id, entryId } = shipWithFreshSession({ name: 'Wavecutter' })
    setSessionEntryFields(id, entryId, {
      title: 'The Storm Run',
      narrative: 'Took her south of the cape.',
    })

    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.title).toBe('The Storm Run')
    expect(entry.narrative).toBe('Took her south of the cape.')
    const summary = recentActions(1)[0].summary
    expect(summary).toMatch(/Wavecutter/)
    expect(summary).toMatch(/title/)
    expect(summary).toMatch(/narrative/)
  })

  it('setSessionEntryFields trims titles and snaps blank ones back to "Session"', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, { title: '   Patrol  ' })
    expect(workspace.ships[id].sessionHistory.find((e) => e.id === entryId).title).toBe('Patrol')

    setSessionEntryFields(id, entryId, { title: '   ' })
    expect(workspace.ships[id].sessionHistory.find((e) => e.id === entryId).title).toBe('Session')
  })

  it('setSessionEntryFields no-ops on unchanged values', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, { title: 'Patrol', narrative: 'Calm waters.' })
    const baseline = undoableCount()
    setSessionEntryFields(id, entryId, { title: 'Patrol', narrative: 'Calm waters.' })
    expect(undoableCount()).toBe(baseline)
  })

  it('setSessionEntryFields no-ops when the entry id is unknown', () => {
    const { id } = shipWithFreshSession()
    const baseline = undoableCount()
    setSessionEntryFields(id, 'nonexistent-id', { title: 'X' })
    expect(undoableCount()).toBe(baseline)
  })

  it('setSessionEntryFields can edit a closed past session, not just the current one', () => {
    const { id, entryId } = shipWithFreshSession()
    closeCurrentSession(id, { title: 'Chapter One' })
    setSessionEntryFields(id, entryId, { narrative: 'Postscript: written later.' })

    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.endedAt).not.toBeNull()
    expect(entry.narrative).toBe('Postscript: written later.')
  })

  it('closeCurrentSession marks endedAt and starts a new session on the next auto-log', () => {
    const { id } = shipWithFreshSession({ name: 'Wavecutter' })
    closeCurrentSession(id, { title: 'Chapter One', narrative: 'We made it home.' })

    const history = workspace.ships[id].sessionHistory
    // The close itself logs an action, which the auto-logger places in a fresh
    // SessionEntry because the previous one is now closed.
    expect(history.length).toBeGreaterThanOrEqual(2)
    const closed = history.find((e) => e.title === 'Chapter One')
    expect(closed.endedAt).not.toBeNull()
    expect(closed.narrative).toBe('We made it home.')

    const open = history[history.length - 1]
    expect(open.endedAt).toBeNull()
    expect(open.actions[0].kind).toBe('session.close')
  })

  it('closeCurrentSession is defensively a no-op when there is no session history', () => {
    const { id } = shipWithFreshSession()
    // Force the empty-history edge case directly. In normal flow this can't
    // happen because the auto-logger seeds a fresh open session after every
    // close, but the guard exists so an externally-cleared history doesn't
    // crash the close button.
    workspace.ships[id].sessionHistory.length = 0
    const baseline = undoableCount()
    closeCurrentSession(id)
    expect(undoableCount()).toBe(baseline)
  })

  it('closeCurrentSession naturally chains: each close lands in the auto-seeded next open session', () => {
    const { id } = shipWithFreshSession()
    closeCurrentSession(id, { title: 'Chapter One' })
    closeCurrentSession(id, { title: 'Chapter Two' })

    const titles = workspace.ships[id].sessionHistory.map((e) => e.title)
    expect(titles).toEqual(expect.arrayContaining(['Chapter One', 'Chapter Two']))
    // Most recent is the open session created by the second close's log line.
    const open = workspace.ships[id].sessionHistory[workspace.ships[id].sessionHistory.length - 1]
    expect(open.endedAt).toBeNull()
  })

  it('closeCurrentSession with no patch keeps the existing title and narrative', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, { title: 'Patrol', narrative: 'Calm.' })
    closeCurrentSession(id)

    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.title).toBe('Patrol')
    expect(entry.narrative).toBe('Calm.')
    expect(entry.endedAt).not.toBeNull()
  })

  it('undo of closeCurrentSession reopens the session and reverts patch fields', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, { title: 'Patrol', narrative: 'Calm.' })
    closeCurrentSession(id, { narrative: 'Calm — finalized.' })
    undo()

    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.endedAt).toBeNull()
    expect(entry.narrative).toBe('Calm.')
  })
})

describe('ship condition mutators (v0.6)', () => {
  it('setShipPersistentCondition adds and removes ids from ship.conditions', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    expect(workspace.ships[id].conditions).toEqual([])

    setShipPersistentCondition(id, 'listing', true)
    expect(workspace.ships[id].conditions).toEqual(['listing'])

    setShipPersistentCondition(id, 'surrendered', true)
    expect(workspace.ships[id].conditions).toEqual(['listing', 'surrendered'])

    setShipPersistentCondition(id, 'listing', false)
    expect(workspace.ships[id].conditions).toEqual(['surrendered'])
  })

  it('setShipPersistentCondition is a no-op when the state already matches', () => {
    const { id } = addBasic()
    const baseline = undoableCount()
    setShipPersistentCondition(id, 'listing', false) // already off
    expect(undoableCount()).toBe(baseline)

    setShipPersistentCondition(id, 'listing', true)
    const afterToggle = undoableCount()
    setShipPersistentCondition(id, 'listing', true) // already on
    expect(undoableCount()).toBe(afterToggle)
  })

  it('setShipPersistentCondition writes a Captain’s log line on the ship', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setShipPersistentCondition(id, 'listing', true)
    const action = recentActions(1)[0]
    expect(action.summary).toBe('Wavecutter marked listing.')
    expect(action.shipId).toBe(id)
    setShipPersistentCondition(id, 'listing', false)
    expect(recentActions(1)[0].summary).toBe('Wavecutter no longer listing.')
  })

  it('setShipSceneCondition stores values keyed by either kind of ship id', () => {
    const { id: playerId } = addBasic({ name: 'Wavecutter' })
    const sceneId = addSceneShip({ name: 'Salt Wraith' })

    setShipSceneCondition(playerId, 'heeling', true)
    setShipSceneCondition(sceneId, 'in-irons', true)
    setShipSceneCondition(sceneId, 'crossing-t', true)

    expect(workspace.scene.shipConditions[playerId]).toEqual(['heeling'])
    expect(workspace.scene.shipConditions[sceneId]).toEqual(['in-irons', 'crossing-t'])

    setShipSceneCondition(sceneId, 'in-irons', false)
    expect(workspace.scene.shipConditions[sceneId]).toEqual(['crossing-t'])

    setShipSceneCondition(sceneId, 'crossing-t', false)
    expect(workspace.scene.shipConditions[sceneId]).toBeUndefined()
  })

  it('setShipSceneCondition tags the action with shipId only for player ships', () => {
    const { id: playerId } = addBasic({ name: 'Wavecutter' })
    const sceneId = addSceneShip({ name: 'Salt Wraith' })

    setShipSceneCondition(playerId, 'heeling', true)
    expect(recentActions(1)[0].shipId).toBe(playerId)

    setShipSceneCondition(sceneId, 'heeling', true)
    expect(recentActions(1)[0].shipId).toBeNull()
  })

  it('setShipSceneCondition is a silent no-op for unknown ship ids', () => {
    const baseline = undoableCount()
    setShipSceneCondition('does-not-exist', 'heeling', true)
    expect(undoableCount()).toBe(baseline)
    expect(workspace.scene.shipConditions['does-not-exist']).toBeUndefined()
  })

  it('removing a scene ship clears its scene conditions', () => {
    const sceneId = addSceneShip({ name: 'Salt Wraith' })
    setShipSceneCondition(sceneId, 'heeling', true)
    expect(workspace.scene.shipConditions[sceneId]).toEqual(['heeling'])
    removeSceneShip(sceneId)
    expect(workspace.scene.shipConditions[sceneId]).toBeUndefined()
  })

  it('removing a player ship clears its scene conditions and any references', () => {
    const { id: playerId } = addBasic({ name: 'Wavecutter' })
    setShipSceneCondition(playerId, 'heeling', true)
    expect(workspace.scene.shipConditions[playerId]).toEqual(['heeling'])
    removeShip(playerId)
    expect(workspace.scene.shipConditions[playerId]).toBeUndefined()
  })

  it('persistent conditions survive undo and redo', () => {
    const { id } = addBasic()
    setShipPersistentCondition(id, 'listing', true)
    expect(workspace.ships[id].conditions).toEqual(['listing'])
    undo()
    expect(workspace.ships[id].conditions).toEqual([])
    redo()
    expect(workspace.ships[id].conditions).toEqual(['listing'])
  })

  it('scene conditions survive undo and redo', () => {
    const sceneId = addSceneShip({ name: 'Salt Wraith' })
    setShipSceneCondition(sceneId, 'heeling', true)
    expect(workspace.scene.shipConditions[sceneId]).toEqual(['heeling'])
    undo()
    expect(workspace.scene.shipConditions[sceneId]).toBeUndefined()
    redo()
    expect(workspace.scene.shipConditions[sceneId]).toEqual(['heeling'])
  })
})

describe('officer notes (v0.7)', () => {
  it('setOfficerNotes commits and logs an "Added" entry on first write', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    const baseline = undoableCount()
    setOfficerNotes(id, 'captain', 'Speaks Coastalese, dislikes seabirds.')

    expect(workspace.ships[id].officers.captain.notes).toBe('Speaks Coastalese, dislikes seabirds.')
    expect(undoableCount()).toBe(baseline + 1)
    const summary = recentActions(1)[0].summary
    expect(summary).toMatch(/Added/)
    expect(summary).toMatch(/Captain/)
    expect(summary).toMatch(/Wavecutter/)
  })

  it('setOfficerNotes uses "Updated" verb when overwriting non-empty notes', () => {
    const { id } = addBasic()
    setOfficerNotes(id, 'captain', 'first pass')
    setOfficerNotes(id, 'captain', 'second pass')
    expect(recentActions(1)[0].summary).toMatch(/Updated/)
  })

  it('setOfficerNotes uses "Cleared" verb when emptying notes', () => {
    const { id } = addBasic()
    setOfficerNotes(id, 'captain', 'something')
    setOfficerNotes(id, 'captain', '')
    expect(workspace.ships[id].officers.captain.notes).toBe('')
    expect(recentActions(1)[0].summary).toMatch(/Cleared/)
  })

  it('setOfficerNotes is a no-op for unchanged values', () => {
    const { id } = addBasic()
    setOfficerNotes(id, 'captain', 'same')
    const baseline = undoableCount()
    setOfficerNotes(id, 'captain', 'same')
    expect(undoableCount()).toBe(baseline)
  })

  it('setOfficerNotes rejects unknown stations', () => {
    const { id } = addBasic()
    expect(() => setOfficerNotes(id, /** @type {any} */ ('bilgePump'), 'x')).toThrow(/station/i)
  })

  it('setOfficerNotes survives undo / redo round-trip', () => {
    const { id } = addBasic()
    setOfficerNotes(id, 'captain', 'first')
    setOfficerNotes(id, 'captain', 'second')
    undo()
    expect(workspace.ships[id].officers.captain.notes).toBe('first')
    undo()
    expect(workspace.ships[id].officers.captain.notes).toBe('')
    redo()
    redo()
    expect(workspace.ships[id].officers.captain.notes).toBe('second')
  })
})

describe('session metadata (v0.7)', () => {
  function shipWithFreshSession(overrides = {}) {
    const { id } = addBasic(overrides)
    const ship = workspace.ships[id]
    const entry = ship.sessionHistory[ship.sessionHistory.length - 1]
    return { id, entryId: entry.id }
  }

  it('setSessionEntryFields stores sessionDate / location / encounterName when patched', () => {
    const { id, entryId } = shipWithFreshSession({ name: 'Wavecutter' })
    setSessionEntryFields(id, entryId, {
      sessionDate: 'Saturday, March 14',
      location: 'Cracked Tooth Bay',
      encounterName: 'Raid on the Black Spear',
    })

    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.sessionDate).toBe('Saturday, March 14')
    expect(entry.location).toBe('Cracked Tooth Bay')
    expect(entry.encounterName).toBe('Raid on the Black Spear')
    const summary = recentActions(1)[0].summary
    expect(summary).toMatch(/played/)
    expect(summary).toMatch(/location/)
    expect(summary).toMatch(/encounter/)
  })

  it('setSessionEntryFields no-ops when none of the meta values changed', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, { location: 'Cracked Tooth Bay' })
    const baseline = undoableCount()
    setSessionEntryFields(id, entryId, { location: 'Cracked Tooth Bay' })
    expect(undoableCount()).toBe(baseline)
  })

  it('setSessionEntryFields can mix narrative + meta in one commit', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, {
      narrative: 'Set sail at dawn.',
      location: 'Port Skerry',
    })
    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.narrative).toBe('Set sail at dawn.')
    expect(entry.location).toBe('Port Skerry')
    const summary = recentActions(1)[0].summary
    expect(summary).toMatch(/narrative/)
    expect(summary).toMatch(/location/)
  })

  it('setSessionEntryFields meta survives undo / redo', () => {
    const { id, entryId } = shipWithFreshSession()
    setSessionEntryFields(id, entryId, { location: 'Port Skerry' })
    setSessionEntryFields(id, entryId, { location: 'Cracked Tooth Bay' })
    undo()
    expect(workspace.ships[id].sessionHistory.find((e) => e.id === entryId).location).toBe(
      'Port Skerry',
    )
    redo()
    expect(workspace.ships[id].sessionHistory.find((e) => e.id === entryId).location).toBe(
      'Cracked Tooth Bay',
    )
  })

  it('setSessionEntryFields meta works on closed past sessions too', () => {
    const { id, entryId } = shipWithFreshSession()
    closeCurrentSession(id, { title: 'Chapter One' })
    setSessionEntryFields(id, entryId, { encounterName: 'The Storm Run (postscript)' })

    const entry = workspace.ships[id].sessionHistory.find((e) => e.id === entryId)
    expect(entry.endedAt).not.toBeNull()
    expect(entry.encounterName).toBe('The Storm Run (postscript)')
  })
})

describe('endScene (v0.7)', () => {
  it('is a no-op on a fresh idle workspace', () => {
    const baseline = undoableCount()
    endScene()
    expect(undoableCount()).toBe(baseline)
  })

  it('resets round / phase / wind / weather gage / pursuit / scene ships in one commit', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setSceneRound(5)
    setScenePhase('attack')
    setSceneWind('SE')
    setWeatherGageHolder(id)
    togglePursuit(true)
    setPursuit({ gap: 3 })
    const intruderId = addSceneShip({ name: 'Salt Wraith' })
    setShipSceneCondition(intruderId, 'heeling', true)
    setShipSceneCondition(id, 'in-irons', true)

    const baseline = undoableCount()
    endScene()
    expect(undoableCount()).toBe(baseline + 1)

    expect(workspace.scene.round).toBe(0)
    expect(workspace.scene.phase).toBe('idle')
    expect(workspace.scene.windDirection).toBe('N')
    expect(workspace.scene.weatherGageHolderId).toBeNull()
    expect(workspace.scene.pursuit).toBeNull()
    expect(Object.keys(workspace.scene.sceneShips)).toHaveLength(0)
    expect(workspace.scene.sceneShipOrder).toHaveLength(0)
    expect(Object.keys(workspace.scene.shipConditions)).toHaveLength(0)
  })

  it('clears boardedBy on every player ship that had a boarder', () => {
    const { id: idA } = addBasic({ name: 'Wavecutter' })
    const { id: idB } = addBasic({ name: 'Petrel' })
    const { id: idC } = addBasic({ name: 'Hunter' })
    setShipBoardedBy(idA, 'The Black Spear')
    setShipBoardedBy(idC, 'pirates from the cove')

    endScene()
    expect(workspace.ships[idA].boardedBy).toBeNull()
    expect(workspace.ships[idB].boardedBy).toBeNull()
    expect(workspace.ships[idC].boardedBy).toBeNull()
    const summary = recentActions(1)[0].summary
    expect(summary).toMatch(/Wavecutter/)
    expect(summary).toMatch(/Hunter/)
  })

  it('preserves persistent ship state — HP, crew, fires, conditions, supplies, journal', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setShipHpCurrent(id, 12)
    setShipFires(id, 2)
    setShipMettleCurrent(id, 1)
    setShipCrewCurrent(id, 3)
    setShipSupplies(id, { grub: 4, grog: 1, gear: 2 })
    setShipPersistentCondition(id, 'listing', true)
    setSceneRound(4)

    endScene()
    const ship = workspace.ships[id]
    expect(ship.hp.current).toBe(12)
    expect(ship.fires).toBe(2)
    expect(ship.mettle.current).toBe(1)
    expect(ship.crew.current).toBe(3)
    expect(ship.supplies).toMatchObject({ grub: 4, grog: 1, gear: 2 })
    expect(ship.conditions).toContain('listing')
    expect(ship.sessionHistory.length).toBeGreaterThan(0)
  })

  it('does not clear persistent ship conditions on the player ship', () => {
    const { id } = addBasic()
    setShipPersistentCondition(id, 'surrendered', true)
    setShipSceneCondition(id, 'heeling', true)

    endScene()
    expect(workspace.ships[id].conditions).toContain('surrendered')
    expect(workspace.scene.shipConditions[id]).toBeUndefined()
  })

  it('summary names a non-zero starting round', () => {
    addBasic()
    setSceneRound(7)
    endScene()
    expect(recentActions(1)[0].summary).toMatch(/round 7/)
  })

  it('summary mentions sighted ships and pursuit when present', () => {
    addBasic()
    addSceneShip({ name: 'Salt Wraith' })
    addSceneShip({ name: 'Whetstone' })
    togglePursuit(true)

    endScene()
    const summary = recentActions(1)[0].summary
    expect(summary).toMatch(/2 sighted/)
    expect(summary).toMatch(/pursuit/)
  })

  it('survives a single undo round-trip', () => {
    const { id } = addBasic({ name: 'Wavecutter' })
    setSceneRound(3)
    setShipBoardedBy(id, 'The Black Spear')
    addSceneShip({ name: 'Salt Wraith' })

    endScene()
    expect(workspace.scene.round).toBe(0)
    expect(workspace.ships[id].boardedBy).toBeNull()
    expect(Object.keys(workspace.scene.sceneShips)).toHaveLength(0)

    undo()
    expect(workspace.scene.round).toBe(3)
    expect(workspace.ships[id].boardedBy).toBe('The Black Spear')
    expect(Object.keys(workspace.scene.sceneShips)).toHaveLength(1)
  })

  it('triggers when only boarding pointers are set (no scene state)', () => {
    const { id } = addBasic()
    setShipBoardedBy(id, 'The Black Spear')

    const baseline = undoableCount()
    endScene()
    expect(undoableCount()).toBe(baseline + 1)
    expect(workspace.ships[id].boardedBy).toBeNull()
  })
})

describe('sail-order mutators (v0.9)', () => {
  /** Convenience: charter three named ships and return their ids in load order. */
  function chartetThree() {
    const a = addShip({ name: 'Lassie' })
    const b = addShip({ name: 'Black Pearl' })
    const c = addShip({ name: 'Interceptor' })
    return { a, b, c }
  }

  describe('setShipOrder', () => {
    it('reorders the workspace and pushes a single log entry', () => {
      const { a, b, c } = chartetThree()
      const baseline = undoableCount()

      setShipOrder([c, a, b])

      expect(workspace.shipOrder).toEqual([c, a, b])
      expect(undoableCount()).toBe(baseline + 1)
      expect(recentActions(1)[0].summary).toBe('Reordered the fleet (3 ships).')
      expect(recentActions(1)[0].kind).toBe('workspace.ship-order')
    })

    it('is a no-op when the order is unchanged', () => {
      const { a, b, c } = chartetThree()
      const baseline = undoableCount()

      setShipOrder([a, b, c])

      expect(workspace.shipOrder).toEqual([a, b, c])
      expect(undoableCount()).toBe(baseline)
    })

    it('rejects orders with a missing ship', () => {
      const { a, b } = chartetThree()
      const baseline = undoableCount()

      setShipOrder([a, b])

      expect(workspace.shipOrder).toHaveLength(3)
      expect(undoableCount()).toBe(baseline)
    })

    it('rejects orders with a foreign ship id', () => {
      const { a, b } = chartetThree()
      const baseline = undoableCount()
      const before = [...workspace.shipOrder]

      setShipOrder([a, b, 'ghost-ship-id'])

      expect(workspace.shipOrder).toEqual(before)
      expect(undoableCount()).toBe(baseline)
    })

    it('rejects orders with duplicates', () => {
      const { a } = chartetThree()
      const baseline = undoableCount()
      const before = [...workspace.shipOrder]

      setShipOrder([a, a, a])

      expect(workspace.shipOrder).toEqual(before)
      expect(undoableCount()).toBe(baseline)
    })

    it('rejects non-array input without throwing', () => {
      chartetThree()
      const baseline = undoableCount()
      // @ts-expect-error — defensive non-array guard
      setShipOrder('not-an-array')
      // @ts-expect-error — defensive null guard
      setShipOrder(null)
      // @ts-expect-error — defensive undefined guard
      setShipOrder(undefined)
      expect(undoableCount()).toBe(baseline)
    })

    it('survives undo / redo round trip', () => {
      const { a, b, c } = chartetThree()
      const original = [...workspace.shipOrder]

      setShipOrder([c, b, a])
      expect(workspace.shipOrder).toEqual([c, b, a])

      undo()
      expect(workspace.shipOrder).toEqual(original)

      redo()
      expect(workspace.shipOrder).toEqual([c, b, a])
    })
  })

  describe('moveShipUp', () => {
    it('swaps the ship with its predecessor', () => {
      const { a, b, c } = chartetThree()
      moveShipUp(b)
      expect(workspace.shipOrder).toEqual([b, a, c])
    })

    it('logs a directed summary naming both ships', () => {
      const { b } = chartetThree()
      moveShipUp(b)
      expect(recentActions(1)[0].summary).toBe('Sailed Black Pearl ahead of Lassie.')
      expect(recentActions(1)[0].kind).toBe('workspace.ship-order')
      expect(recentActions(1)[0].shipId).toBe(b)
    })

    it('is a no-op for the head of the order', () => {
      const { a } = chartetThree()
      const baseline = undoableCount()
      const before = [...workspace.shipOrder]

      moveShipUp(a)

      expect(workspace.shipOrder).toEqual(before)
      expect(undoableCount()).toBe(baseline)
    })

    it('is a no-op for an unknown ship id', () => {
      chartetThree()
      const baseline = undoableCount()
      moveShipUp('nope')
      expect(undoableCount()).toBe(baseline)
    })

    it('appends to the moved ship session log', () => {
      const { b } = chartetThree()
      const sessions = workspace.ships[b].sessionHistory
      const currentSession = sessions[sessions.length - 1]
      const before = currentSession.actions.length

      moveShipUp(b)

      const after = currentSession.actions.length
      expect(after).toBe(before + 1)
      expect(currentSession.actions[after - 1].summary).toBe(
        'Sailed Black Pearl ahead of Lassie.',
      )
    })

    it('survives undo / redo round trip', () => {
      const { a, b, c } = chartetThree()
      moveShipUp(c)
      expect(workspace.shipOrder).toEqual([a, c, b])
      undo()
      expect(workspace.shipOrder).toEqual([a, b, c])
      redo()
      expect(workspace.shipOrder).toEqual([a, c, b])
    })
  })

  describe('moveShipDown', () => {
    it('swaps the ship with its successor', () => {
      const { a, b, c } = chartetThree()
      moveShipDown(b)
      expect(workspace.shipOrder).toEqual([a, c, b])
    })

    it('logs a directed summary naming both ships', () => {
      const { a } = chartetThree()
      moveShipDown(a)
      expect(recentActions(1)[0].summary).toBe('Sailed Lassie astern of Black Pearl.')
      expect(recentActions(1)[0].kind).toBe('workspace.ship-order')
      expect(recentActions(1)[0].shipId).toBe(a)
    })

    it('is a no-op for the tail of the order', () => {
      const { c } = chartetThree()
      const baseline = undoableCount()
      const before = [...workspace.shipOrder]

      moveShipDown(c)

      expect(workspace.shipOrder).toEqual(before)
      expect(undoableCount()).toBe(baseline)
    })

    it('is a no-op for an unknown ship id', () => {
      chartetThree()
      const baseline = undoableCount()
      moveShipDown('nope')
      expect(undoableCount()).toBe(baseline)
    })

    it('repeated calls walk the ship to the tail', () => {
      const { a, b, c } = chartetThree()
      moveShipDown(a)
      expect(workspace.shipOrder).toEqual([b, a, c])
      moveShipDown(a)
      expect(workspace.shipOrder).toEqual([b, c, a])
      // already last; further calls are no-ops
      const baseline = undoableCount()
      moveShipDown(a)
      expect(undoableCount()).toBe(baseline)
      expect(workspace.shipOrder).toEqual([b, c, a])
    })

    it('survives undo / redo round trip', () => {
      const { a, b, c } = chartetThree()
      moveShipDown(a)
      expect(workspace.shipOrder).toEqual([b, a, c])
      undo()
      expect(workspace.shipOrder).toEqual([a, b, c])
      redo()
      expect(workspace.shipOrder).toEqual([b, a, c])
    })
  })
})

describe('applyFlagToShips (v0.9)', () => {
  /**
   * Convenience: charter a source ship with a named flag plus N target ships.
   * Returns ids and the source flag id.
   */
  function setupFleet({ targetCount = 2, flagOverrides = {} } = {}) {
    const sourceId = addShip({ name: 'Lassie' })
    const flagId = addShipFlag(sourceId, {
      name: 'The Black Spear',
      isPirate: true,
      ...flagOverrides,
    })
    setShipFlag(sourceId, flagId, {
      reputation: { good: 0, evil: 2, lawful: 0, chaotic: 3 },
    })
    const targets = []
    const names = ['Black Pearl', 'Interceptor', 'Wavecutter', 'Lighthouse']
    for (let i = 0; i < targetCount; i++) {
      targets.push(addShip({ name: names[i] ?? `Ghost ${i}` }))
    }
    return { sourceId, flagId, targets }
  }

  it('copies the flag to each target with a fresh id and reputation snapshot', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 2 })
    const [b, c] = targets

    const result = applyFlagToShips(sourceId, flagId, [b, c])

    expect(result.applied).toEqual([b, c])
    expect(result.skipped).toEqual([])

    const bFlag = workspace.ships[b].flags.flown.find((f) => f.name === 'The Black Spear')
    const cFlag = workspace.ships[c].flags.flown.find((f) => f.name === 'The Black Spear')
    expect(bFlag).toBeDefined()
    expect(cFlag).toBeDefined()
    // Independent ids — copies do NOT share identity with the source
    expect(bFlag.id).not.toBe(flagId)
    expect(cFlag.id).not.toBe(flagId)
    expect(bFlag.id).not.toBe(cFlag.id)
    // Properties are mirrored, including the four-axis reputation tally.
    const expectedRep = { good: 0, evil: 2, lawful: 0, chaotic: 3 }
    expect(bFlag.reputation).toEqual(expectedRep)
    expect(bFlag.isPirate).toBe(true)
    expect(bFlag.isFalse).toBe(false)
    expect(cFlag.reputation).toEqual(expectedRep)
  })

  it('produces a single workspace-level commit and per-ship log entries', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 2 })
    const [b, c] = targets
    const baseline = undoableCount()

    const bSession = workspace.ships[b].sessionHistory
    const cSession = workspace.ships[c].sessionHistory
    const bBefore = bSession[bSession.length - 1].actions.length
    const cBefore = cSession[cSession.length - 1].actions.length

    applyFlagToShips(sourceId, flagId, [b, c])

    expect(undoableCount()).toBe(baseline + 1)
    expect(recentActions(1)[0].kind).toBe('workspace.flagApply')
    expect(recentActions(1)[0].summary).toBe(
      'Copied flag The Black Spear from Lassie to Black Pearl, Interceptor.',
    )

    const bAfter = bSession[bSession.length - 1].actions.length
    const cAfter = cSession[cSession.length - 1].actions.length
    expect(bAfter).toBe(bBefore + 1)
    expect(cAfter).toBe(cBefore + 1)
    const bSummary = bSession[bSession.length - 1].actions[bAfter - 1].summary
    expect(bSummary).toMatch(/flag The Black Spear on Black Pearl \(from Lassie\)/)
  })

  it('uses the count form when applying to four or more ships', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 4 })
    applyFlagToShips(sourceId, flagId, targets)
    expect(recentActions(1)[0].summary).toBe(
      'Copied flag The Black Spear from Lassie to 4 ships.',
    )
  })

  it('skips targets that already fly a flag with the same name (case + whitespace insensitive)', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 2 })
    const [b, c] = targets
    addShipFlag(b, { name: '  the black SPEAR  ' })

    const result = applyFlagToShips(sourceId, flagId, [b, c])

    expect(result.applied).toEqual([c])
    expect(result.skipped).toEqual([b])
    const bFlags = workspace.ships[b].flags.flown.filter(
      (f) => f.name.trim().toLowerCase() === 'the black spear',
    )
    expect(bFlags).toHaveLength(1)
  })

  it('returns no-op result and skips commit when every target collides', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 2 })
    const [b, c] = targets
    addShipFlag(b, { name: 'The Black Spear' })
    addShipFlag(c, { name: 'The Black Spear' })
    const baseline = undoableCount()

    const result = applyFlagToShips(sourceId, flagId, [b, c])

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([b, c])
    expect(undoableCount()).toBe(baseline)
  })

  it('excludes the source ship from targets even if passed', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 1 })
    const [b] = targets

    const result = applyFlagToShips(sourceId, flagId, [sourceId, b])

    expect(result.applied).toEqual([b])
    expect(result.skipped).toEqual([])
  })

  it('deduplicates target ids', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 1 })
    const [b] = targets

    applyFlagToShips(sourceId, flagId, [b, b, b])

    const bSpears = workspace.ships[b].flags.flown.filter((f) => f.name === 'The Black Spear')
    expect(bSpears).toHaveLength(1)
  })

  it('drops unknown ship ids silently', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 1 })
    const [b] = targets

    const result = applyFlagToShips(sourceId, flagId, [b, 'ghost-id'])

    expect(result.applied).toEqual([b])
    expect(result.skipped).toEqual([])
  })

  it('is a no-op for an unknown source ship', () => {
    const { flagId, targets } = setupFleet({ targetCount: 1 })
    const baseline = undoableCount()

    const result = applyFlagToShips('not-a-ship', flagId, targets)

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([])
    expect(undoableCount()).toBe(baseline)
  })

  it('is a no-op for an unknown source flag id', () => {
    const { sourceId, targets } = setupFleet({ targetCount: 1 })
    const baseline = undoableCount()

    const result = applyFlagToShips(sourceId, 'not-a-flag', targets)

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([])
    expect(undoableCount()).toBe(baseline)
  })

  it('is a no-op for empty / non-array target lists', () => {
    const { sourceId, flagId } = setupFleet({ targetCount: 0 })
    const baseline = undoableCount()

    expect(applyFlagToShips(sourceId, flagId, []).applied).toEqual([])
    // @ts-expect-error — defensive guard
    expect(applyFlagToShips(sourceId, flagId, null).applied).toEqual([])
    // @ts-expect-error — defensive guard
    expect(applyFlagToShips(sourceId, flagId, undefined).applied).toEqual([])
    expect(undoableCount()).toBe(baseline)
  })

  it('does NOT raise the new flag on the target by default', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 1 })
    const [b] = targets
    const existingFlagId = addShipFlag(b, { name: 'Crown Standard' })
    setShipFlagFlying(b, existingFlagId)

    applyFlagToShips(sourceId, flagId, [b])

    expect(workspace.ships[b].flags.flyingId).toBe(existingFlagId)
  })

  it('raises the new flag on the target when raiseOnTargets is set', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 1 })
    const [b] = targets
    const existingFlagId = addShipFlag(b, { name: 'Crown Standard' })
    setShipFlagFlying(b, existingFlagId)

    applyFlagToShips(sourceId, flagId, [b], { raiseOnTargets: true })

    const newSpear = workspace.ships[b].flags.flown.find(
      (f) => f.name === 'The Black Spear',
    )
    expect(workspace.ships[b].flags.flyingId).toBe(newSpear.id)
  })

  it('flies the copy automatically when the target had no flying flag', () => {
    const sourceId = addShip({ name: 'Lassie' })
    const flagId = addShipFlag(sourceId, { name: 'The Black Spear' })
    const b = addShip({ name: 'Empty Ship' })
    workspace.ships[b].flags.flyingId = null

    applyFlagToShips(sourceId, flagId, [b])

    const newSpear = workspace.ships[b].flags.flown.find(
      (f) => f.name === 'The Black Spear',
    )
    expect(workspace.ships[b].flags.flyingId).toBe(newSpear.id)
  })

  it('survives undo / redo round trip', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 2 })
    const [b, c] = targets

    applyFlagToShips(sourceId, flagId, [b, c])
    expect(workspace.ships[b].flags.flown.some((f) => f.name === 'The Black Spear')).toBe(
      true,
    )
    expect(workspace.ships[c].flags.flown.some((f) => f.name === 'The Black Spear')).toBe(
      true,
    )

    undo()
    expect(workspace.ships[b].flags.flown.some((f) => f.name === 'The Black Spear')).toBe(
      false,
    )
    expect(workspace.ships[c].flags.flown.some((f) => f.name === 'The Black Spear')).toBe(
      false,
    )

    redo()
    expect(workspace.ships[b].flags.flown.some((f) => f.name === 'The Black Spear')).toBe(
      true,
    )
    expect(workspace.ships[c].flags.flown.some((f) => f.name === 'The Black Spear')).toBe(
      true,
    )
  })

  it('keeps reputation independent on the copy after future edits to the source', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 1 })
    const [b] = targets
    applyFlagToShips(sourceId, flagId, [b])
    const copy = workspace.ships[b].flags.flown.find((f) => f.name === 'The Black Spear')
    const seededRep = { good: 0, evil: 2, lawful: 0, chaotic: 3 }
    expect(copy.reputation).toEqual(seededRep)

    setShipFlag(sourceId, flagId, { reputation: { good: 0, evil: 9, lawful: 0, chaotic: 0 } })
    expect(
      workspace.ships[sourceId].flags.flown.find((f) => f.id === flagId).reputation,
    ).toEqual({ good: 0, evil: 9, lawful: 0, chaotic: 0 })
    // The copy stays at the seeded values because the new flag id is unique to the copy.
    expect(
      workspace.ships[b].flags.flown.find((f) => f.name === 'The Black Spear').reputation,
    ).toEqual(seededRep)
  })

  it('mixes applied + skipped in one call and reports both back', () => {
    const { sourceId, flagId, targets } = setupFleet({ targetCount: 3 })
    const [b, c, d] = targets
    addShipFlag(c, { name: 'The Black Spear' })

    const result = applyFlagToShips(sourceId, flagId, [b, c, d])
    expect(result.applied).toEqual([b, d])
    expect(result.skipped).toEqual([c])
    expect(recentActions(1)[0].summary).toBe(
      'Copied flag The Black Spear from Lassie to Black Pearl, Wavecutter.',
    )
  })
})

describe('undo stack cap (v1.0)', () => {
  // Bumping/changing UNDO_LIMIT in workspace.svelte.js will rightfully break
  // these tests; tweak the literal here to match.
  const UNDO_LIMIT = 200

  /**
   * Push N un-coalesced commits by toggling a ship's name back and forth.
   * Name is the smallest mutator that always pushes a fresh undo entry
   * (no coalesceKey, no clamping that could no-op the patch). Each call
   * picks a unique value so the diff always commits.
   */
  function pushNDistinctCommits(shipId, count) {
    for (let i = 0; i < count; i++) {
      setShipName(shipId, `Unique-${i}`)
    }
  }

  it('caps the undo stack at UNDO_LIMIT and reports prunedActionCount', async () => {
    const { prunedActionCount } = await import('./workspace.svelte.js')
    const { id } = addBasic()
    const baseline = undoableCount()
    expect(prunedActionCount()).toBe(0)

    pushNDistinctCommits(id, UNDO_LIMIT - baseline)
    expect(undoableCount()).toBe(UNDO_LIMIT)
    expect(prunedActionCount()).toBe(0)

    pushNDistinctCommits(id, 5)
    expect(undoableCount()).toBe(UNDO_LIMIT)
    expect(prunedActionCount()).toBe(5)

    pushNDistinctCommits(id, 50)
    expect(undoableCount()).toBe(UNDO_LIMIT)
    expect(prunedActionCount()).toBe(55)
  })

  it('keeps the most recent commits (the oldest entries are the ones pruned)', async () => {
    const { id } = addBasic()
    const baseline = undoableCount()

    pushNDistinctCommits(id, UNDO_LIMIT - baseline + 3)

    const newest = recentActions(1)[0]
    expect(newest.summary).toContain(`Unique-${UNDO_LIMIT - baseline + 2}`)
  })

  it('resets prunedActionCount on __resetForTests', async () => {
    const { prunedActionCount } = await import('./workspace.svelte.js')
    const { id } = addBasic()
    pushNDistinctCommits(id, UNDO_LIMIT + 10)
    expect(prunedActionCount()).toBeGreaterThan(0)

    __resetForTests()
    expect(prunedActionCount()).toBe(0)
  })
})

describe('image-store cap (v1.0)', () => {
  /**
   * Build a synthetic data URL of a target size in bytes. We don't need
   * a real image — the cap measures the data-URL string length, so any
   * string that long will exercise the same code paths the cap guards.
   */
  function makeDataUrlOfSize(byteCount) {
    const header = 'data:image/png;base64,'
    const filler = 'A'.repeat(Math.max(0, byteCount - header.length))
    return header + filler
  }

  it('rejects an upload that would push past IMAGE_STORE_MAX_BYTES and surfaces a toast', async () => {
    const { IMAGE_STORE_MAX_BYTES, imageStoreSizeBytes } = await import('./workspace.svelte.js')
    const { ui } = await import('./ui.svelte.js')

    const { id } = addBasic()
    const huge = makeDataUrlOfSize(IMAGE_STORE_MAX_BYTES + 1024)
    const toastsBefore = ui.toasts.length

    const ok = setShipPortrait(id, huge)
    expect(ok).toBe(false)
    expect(workspace.ships[id].portraitImageId).toBeNull()
    expect(imageStoreSizeBytes()).toBe(0)
    expect(ui.toasts.length).toBe(toastsBefore + 1)
    expect(ui.toasts[ui.toasts.length - 1].title).toMatch(/image store/i)
  })

  it('accepts an upload that fits and updates the image store', async () => {
    const { imageStoreSizeBytes } = await import('./workspace.svelte.js')
    const { id } = addBasic()
    const portrait = makeDataUrlOfSize(50 * 1024) // 50 KB

    expect(setShipPortrait(id, portrait)).toBe(true)
    expect(workspace.ships[id].portraitImageId).not.toBeNull()
    expect(imageStoreSizeBytes()).toBeGreaterThan(0)
  })

  it('counts the replaced portrait as freed bytes when projecting overflow', async () => {
    const { IMAGE_STORE_MAX_BYTES } = await import('./workspace.svelte.js')
    const { id } = addBasic()

    // First fill the store close to the cap with one big portrait.
    const big = makeDataUrlOfSize(IMAGE_STORE_MAX_BYTES - 100 * 1024)
    expect(setShipPortrait(id, big)).toBe(true)

    // A second portrait of the same size would double up briefly before the
    // first is pruned; the cap pre-check should subtract the bytes we're
    // replacing and let it through.
    const replacement = makeDataUrlOfSize(IMAGE_STORE_MAX_BYTES - 100 * 1024)
    expect(setShipPortrait(id, replacement)).toBe(true)
  })

  it('refuses additional uploads once the cap is full', async () => {
    const { IMAGE_STORE_MAX_BYTES } = await import('./workspace.svelte.js')
    const { id: shipA } = addBasic({ name: 'Alpha' })
    const { id: shipB } = addBasic({ name: 'Bravo' })

    // Fill ship A to ~95% of the cap.
    const portraitA = makeDataUrlOfSize(IMAGE_STORE_MAX_BYTES - 200 * 1024)
    expect(setShipPortrait(shipA, portraitA)).toBe(true)

    // A 1 MB portrait on ship B does not fit alongside the first.
    const portraitB = makeDataUrlOfSize(1024 * 1024)
    expect(setShipPortrait(shipB, portraitB)).toBe(false)
    expect(workspace.ships[shipB].portraitImageId).toBeNull()

    // Clearing ship A makes room.
    expect(setShipPortrait(shipA, null)).toBe(true)
    expect(setShipPortrait(shipB, portraitB)).toBe(true)
  })

  it('clears (null) are always allowed even when the store is past the cap', async () => {
    // Defensive: if the cap value is ever lowered between sessions, users
    // should still be able to delete portraits to recover.
    const { id } = addBasic()
    const portrait = makeDataUrlOfSize(64 * 1024)
    expect(setShipPortrait(id, portrait)).toBe(true)
    expect(setShipPortrait(id, null)).toBe(true)
    expect(workspace.ships[id].portraitImageId).toBeNull()
  })
})

describe('loadBundleIntoWorkspace (v1.0)', () => {
  it('replaces ships, ship order, scene, and images in a single undoable commit', async () => {
    const { loadBundleIntoWorkspace } = await import('./workspace.svelte.js')

    // Pre-populate the workspace so we can verify the bundle truly replaces
    // (not merges) the existing state.
    const { id: existingId } = addBasic({ name: 'Pre-existing' })
    const undoBeforeBundle = undoableCount()

    const bundle = {
      shipOrder: ['ship-1', 'ship-2'],
      ships: {
        'ship-1': /** @type {import('../domain/types.js').Ship} */ ({
          id: 'ship-1',
          name: 'Marigold',
          size: 'medium',
          type: 'Sloop',
          mobility: 'balanced',
          speed: { knots: 0, squares: 0 },
          hp: { current: 30, max: 30 },
          explosionDC: 12,
          weapons: { bow: 0, port: 0, starboard: 0, stern: 0, heavyEligible: false },
          supplies: { grub: 5, grog: 5, gear: 5 },
          resources: { fuel: 0, ammoByType: {} },
          crew: { current: 12, max: 12, skeleton: 3 },
          officers: {},
          mettle: { current: 8, notes: '' },
          flags: { flown: [], known: [], flyingId: null },
          sceneFlags: {
            inIrons: false,
            hasWeatherGage: false,
            adjacentToShipIds: [],
            facing: null,
            speedZero: true,
          },
          fires: 0,
          boardedBy: null,
          portraitImageId: null,
          playerCharacter: null,
          sessionHistory: [],
          conditions: [],
        }),
        'ship-2': /** @type {import('../domain/types.js').Ship} */ ({
          id: 'ship-2',
          name: 'Stormcrow',
          size: 'small',
          type: 'Cutter',
          mobility: 'high',
          speed: { knots: 0, squares: 0 },
          hp: { current: 18, max: 18 },
          explosionDC: 10,
          weapons: { bow: 0, port: 0, starboard: 0, stern: 0, heavyEligible: false },
          supplies: { grub: 0, grog: 0, gear: 0 },
          resources: { fuel: 0, ammoByType: {} },
          crew: { current: 6, max: 6, skeleton: 2 },
          officers: {},
          mettle: { current: 6, notes: '' },
          flags: { flown: [], known: [], flyingId: null },
          sceneFlags: {
            inIrons: false,
            hasWeatherGage: false,
            adjacentToShipIds: [],
            facing: null,
            speedZero: true,
          },
          fires: 0,
          boardedBy: null,
          portraitImageId: null,
          playerCharacter: null,
          sessionHistory: [],
          conditions: [],
        }),
      },
      scene: /** @type {import('../domain/types.js').Scene} */ ({
        mode: 'combat',
        windDirection: 'E',
        weatherGageHolderId: 'ship-1',
        round: 3,
        phase: 'attack',
        sceneShips: {},
        sceneShipOrder: [],
        pursuit: null,
        shipConditions: {},
      }),
      images: {},
      savedAt: '2026-04-25T18:00:00.000Z',
    }

    loadBundleIntoWorkspace(bundle)

    expect(workspace.shipOrder).toEqual(['ship-1', 'ship-2'])
    expect(workspace.ships[existingId]).toBeUndefined()
    expect(workspace.ships['ship-1'].name).toBe('Marigold')
    expect(workspace.ships['ship-2'].name).toBe('Stormcrow')
    expect(workspace.scene.round).toBe(3)
    expect(workspace.scene.phase).toBe('attack')
    expect(workspace.scene.weatherGageHolderId).toBe('ship-1')
    expect(workspace.focusedShipId).toBe('ship-1')
    expect(workspace.lastSavedAtByShipId['ship-1']).toBe('2026-04-25T18:00:00.000Z')
    expect(workspace.lastSavedAtByShipId['ship-2']).toBe('2026-04-25T18:00:00.000Z')

    // The bundle load is a single commit and is reversible.
    expect(undoableCount()).toBe(undoBeforeBundle + 1)
    expect(recentActions(1)[0].summary).toBe('Loaded a fleet bundle (2 ships).')

    undo()
    expect(workspace.ships[existingId]).toBeDefined()
    expect(workspace.ships['ship-1']).toBeUndefined()
  })

  it('handles an empty bundle without crashing', async () => {
    const { loadBundleIntoWorkspace } = await import('./workspace.svelte.js')
    addBasic({ name: 'Will be replaced' })

    loadBundleIntoWorkspace({
      shipOrder: [],
      ships: {},
      scene: /** @type {import('../domain/types.js').Scene} */ ({
        mode: 'idle',
        windDirection: 'N',
        weatherGageHolderId: null,
        round: 0,
        phase: 'idle',
        sceneShips: {},
        sceneShipOrder: [],
        pursuit: null,
        shipConditions: {},
      }),
      images: {},
      savedAt: '2026-04-25T18:00:00.000Z',
    })

    expect(workspace.shipOrder).toEqual([])
    expect(Object.keys(workspace.ships)).toEqual([])
    expect(workspace.focusedShipId).toBeNull()
    expect(recentActions(1)[0].summary).toBe('Loaded an empty fleet bundle.')
  })
})
