/**
 * Tests for the on-disk ShipFile / Ship validators. Validation is deliberately
 * tolerant — the loader can repair some mistakes — so we assert both error and
 * warn paths separately.
 */

import { describe, expect, it } from 'vitest'
import { validateShipFile, validateShipShape } from './validators.js'
import { makeShip, makeShipFile } from './derivations.js'

function makeWellFormedFile() {
  const ship = makeShip({ name: 'Well-Formed' })
  return makeShipFile(ship, {})
}

describe('validateShipFile', () => {
  it('accepts a freshly-built file with no issues', () => {
    const file = makeWellFormedFile()
    const report = validateShipFile(file)
    expect(report.ok).toBe(true)
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('rejects a non-object payload', () => {
    expect(validateShipFile(/** @type {any} */ (null)).ok).toBe(false)
    expect(validateShipFile(/** @type {any} */ ('string')).ok).toBe(false)
    expect(validateShipFile(/** @type {any} */ (42)).ok).toBe(false)
  })

  it('rejects mismatched schemaVersion with a clear path', () => {
    const file = { ...makeWellFormedFile(), schemaVersion: 2 }
    const report = validateShipFile(file)
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.severity === 'error' && i.path === 'schemaVersion')).toBe(
      true,
    )
  })

  it('warns (does not error) when createdAt is missing', () => {
    const file = makeWellFormedFile()
    delete (/** @type {any} */ (file).createdAt)
    const report = validateShipFile(file)
    expect(report.ok).toBe(true) // missing createdAt is recoverable
    expect(report.issues.some((i) => i.severity === 'warn' && i.path === 'createdAt')).toBe(true)
  })

  it('errors when images is an array instead of a map', () => {
    const file = { ...makeWellFormedFile(), images: /** @type {any} */ ([]) }
    const report = validateShipFile(file)
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.path === 'images' && i.severity === 'error')).toBe(true)
  })

  it('errors when ship is missing entirely', () => {
    const file = { ...makeWellFormedFile() }
    delete (/** @type {any} */ (file).ship)
    const report = validateShipFile(file)
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.path === 'ship' && i.severity === 'error')).toBe(true)
  })
})

describe('validateShipShape', () => {
  it('returns no issues for a fresh ship from the factory', () => {
    const ship = makeShip()
    const issues = validateShipShape(ship)
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('errors on missing required strings (id, name)', () => {
    const ship = makeShip()
    ship.id = ''
    ship.name = ''
    const issues = validateShipShape(ship)
    expect(issues.some((i) => i.path === 'ship.id' && i.severity === 'error')).toBe(true)
    expect(issues.some((i) => i.path === 'ship.name' && i.severity === 'error')).toBe(true)
  })

  it('errors on out-of-enum size or mobility', () => {
    const ship = makeShip()
    ship.size = 'colossal'
    ship.mobility = 'sluggish'
    const issues = validateShipShape(ship)
    expect(issues.some((i) => i.path === 'ship.size')).toBe(true)
    expect(issues.some((i) => i.path === 'ship.mobility')).toBe(true)
  })

  it('errors when hp is missing or malformed', () => {
    const ship = makeShip()
    ship.hp = null
    const issues = validateShipShape(ship)
    expect(issues.some((i) => i.path === 'ship.hp' && i.severity === 'error')).toBe(true)
  })

  it('errors when explosionDC is not a number', () => {
    const ship = makeShip()
    ship.explosionDC = 'twelve'
    const issues = validateShipShape(ship)
    expect(issues.some((i) => i.path === 'ship.explosionDC' && i.severity === 'error')).toBe(true)
  })

  it('warns (does not error) when an officer station is missing', () => {
    const ship = makeShip()
    delete ship.officers.cook
    const issues = validateShipShape(ship)
    expect(
      issues.some((i) => i.severity === 'warn' && i.path === 'ship.officers.cook'),
    ).toBe(true)
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
  })

  it('warns when sceneFlags.facing is unknown', () => {
    const ship = makeShip()
    ship.sceneFlags.facing = 'XX'
    const issues = validateShipShape(ship)
    expect(
      issues.some((i) => i.severity === 'warn' && i.path === 'ship.sceneFlags.facing'),
    ).toBe(true)
  })

  it('treats type as required-but-allow-empty (free-text)', () => {
    const ship = makeShip()
    ship.type = ''
    const issues = validateShipShape(ship)
    expect(issues.some((i) => i.path === 'ship.type' && i.severity === 'error')).toBe(false)
  })
})
