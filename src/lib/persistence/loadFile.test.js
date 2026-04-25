/**
 * End-to-end-ish tests for the load pipeline. We don't touch the DOM file picker;
 * we synthesize `File` objects directly and assert that the parser, migrator,
 * validator, and ship repair all cooperate to land a usable Ship in the workspace.
 */

import { describe, expect, it } from 'vitest'
import { parseShipFile, parseShipFiles } from './loadFile.js'
import { makeShip, makeShipFile } from '../domain/derivations.js'
import { STATIONS } from '../domain/rules.js'
import fixtureV1 from './__fixtures__/v1.example.shipsync.json' with { type: 'json' }

function fileFromObject(obj, name = 'test.shipsync.json') {
  return new File([JSON.stringify(obj)], name, { type: 'application/json' })
}

function fileFromText(text, name = 'broken.shipsync.json') {
  return new File([text], name, { type: 'application/json' })
}

describe('parseShipFile', () => {
  it('parses the v1 example fixture into a usable ship', async () => {
    const file = fileFromObject(fixtureV1, 'black-spear.shipsync.json')
    const result = await parseShipFile(file)
    expect(result.ok).toBe(true)
    expect(result.sourceFilename).toBe('black-spear.shipsync.json')
    expect(result.ship).not.toBeNull()
    expect(result.ship?.name).toBe('The Black Spear')
    expect(result.ship?.officers.captain.name).toBe('Roya the Quick')
    expect(result.images).toEqual({})
  })

  it('reports a parse error when JSON is malformed', async () => {
    const file = fileFromText('{ this is not json', 'bad.shipsync.json')
    const result = await parseShipFile(file)
    expect(result.ok).toBe(false)
    expect(result.ship).toBeNull()
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true)
    expect(result.issues[0].message.toLowerCase()).toContain('json')
  })

  it('errors on a wrong schemaVersion', async () => {
    const ship = makeShip()
    const file = fileFromObject({ ...makeShipFile(ship, {}), schemaVersion: 999 })
    const result = await parseShipFile(file)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.path === 'schemaVersion')).toBe(true)
  })

  it('repairs a missing officer station with a vacant default', async () => {
    const ship = makeShip()
    delete ship.officers.cook
    const file = fileFromObject(makeShipFile(ship, {}))
    const result = await parseShipFile(file)
    expect(result.ok).toBe(true)
    expect(result.ship?.officers.cook).toBeDefined()
    expect(result.ship?.officers.cook.name).toBeNull()
    expect(result.ship?.officers.cook.rank).toBe(1)
  })

  it('preserves images bundled with the file', async () => {
    const ship = makeShip()
    ship.portraitImageId = 'img-1'
    const fileObj = makeShipFile(ship, { 'img-1': 'data:image/png;base64,AAA=' })
    const result = await parseShipFile(fileFromObject(fileObj))
    expect(result.ok).toBe(true)
    expect(result.images['img-1']).toBe('data:image/png;base64,AAA=')
  })

  it('always seats all 10 stations after repair', async () => {
    const ship = makeShip()
    ship.officers = {}
    const file = fileFromObject(makeShipFile(ship, {}))
    const result = await parseShipFile(file)
    expect(result.ok).toBe(true)
    for (const station of STATIONS) {
      expect(result.ship?.officers[station]).toMatchObject({
        name: null,
        rank: 1,
        status: 'active',
      })
    }
  })

  it('preserves persistent ship conditions through a save/load round-trip', async () => {
    const ship = makeShip()
    ship.conditions = ['listing', 'surrendered']
    const file = fileFromObject(makeShipFile(ship, {}))
    const result = await parseShipFile(file)
    expect(result.ok).toBe(true)
    expect(result.ship?.conditions).toEqual(['listing', 'surrendered'])
  })

  it('migrates legacy stricken-colors → surrendered on load (PDF p. 190 rename)', async () => {
    const ship = makeShip()
    /** @type {any} */
    const ghost = ship
    ghost.conditions = ['listing', 'stricken-colors']
    const result = await parseShipFile(fileFromObject(makeShipFile(ship, {})))
    expect(result.ok).toBe(true)
    expect(result.ship?.conditions).toEqual(['listing', 'surrendered'])
  })

  it('defaults missing conditions to an empty array (older files)', async () => {
    const ship = makeShip()
    /** @type {any} */
    const ghost = ship
    delete ghost.conditions
    const result = await parseShipFile(fileFromObject(makeShipFile(ship, {})))
    expect(result.ok).toBe(true)
    expect(result.ship?.conditions).toEqual([])
  })

  it('drops unknown condition ids and warns', async () => {
    const ship = makeShip()
    /** @type {any} */
    const ghost = ship
    ghost.conditions = ['listing', 'aurora-cursed', 'stricken-colors']
    const result = await parseShipFile(fileFromObject(makeShipFile(ship, {})))
    expect(result.ok).toBe(true)
    expect(result.ship?.conditions).toEqual(['listing', 'surrendered'])
    expect(result.issues.some((i) => i.path === 'ship.conditions')).toBe(true)
  })

  it('deduplicates repeated condition ids', async () => {
    const ship = makeShip()
    /** @type {any} */
    const ghost = ship
    ghost.conditions = ['listing', 'listing']
    const result = await parseShipFile(fileFromObject(makeShipFile(ship, {})))
    expect(result.ok).toBe(true)
    expect(result.ship?.conditions).toEqual(['listing'])
  })

  it('treats a non-array conditions field as missing and warns', async () => {
    const ship = makeShip()
    /** @type {any} */
    const ghost = ship
    ghost.conditions = 'listing'
    const result = await parseShipFile(fileFromObject(makeShipFile(ship, {})))
    expect(result.ok).toBe(true)
    expect(result.ship?.conditions).toEqual([])
    expect(result.issues.some((i) => i.path === 'ship.conditions')).toBe(true)
  })
})

describe('parseShipFiles', () => {
  it('parses multiple files in parallel', async () => {
    const a = fileFromObject(makeShipFile(makeShip({ name: 'A' }), {}), 'a.shipsync.json')
    const b = fileFromObject(makeShipFile(makeShip({ name: 'B' }), {}), 'b.shipsync.json')
    const results = await parseShipFiles([a, b])
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.map((r) => r.ship?.name).sort()).toEqual(['A', 'B'])
  })

  it('reports per-file failures without rejecting the batch', async () => {
    const good = fileFromObject(makeShipFile(makeShip({ name: 'Good' }), {}))
    const bad = fileFromText('not json', 'bad.shipsync.json')
    const [r1, r2] = await parseShipFiles([good, bad])
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(false)
  })
})
