import { describe, expect, it } from 'vitest'
import { applyResolution, findConflicts } from './flagConflicts.js'
import {
  makeEmptyWorkspace,
  makeShip,
} from '../domain/derivations.js'

function workspaceWith(ships) {
  const ws = makeEmptyWorkspace()
  for (const s of ships) {
    ws.ships[s.id] = s
    ws.shipOrder.push(s.id)
  }
  return ws
}

/**
 * @param {string} id
 * @param {Partial<import('../domain/types.js').Reputation>} reputation
 * @param {string} [name]
 */
function flag(id, reputation, name = id) {
  return {
    id,
    name,
    isFalse: false,
    isPirate: false,
    isFaction: false,
    artImageId: null,
    reputation: { good: 0, evil: 0, lawful: 0, chaotic: 0, ...reputation },
  }
}

describe('findConflicts', () => {
  it('returns nothing for a single-ship workspace', () => {
    const ship = makeShip({ name: 'Solo' })
    ship.flags.flown = [flag('the-bones', { good: 2 })]
    expect(findConflicts(workspaceWith([ship]))).toEqual([])
  })

  it('returns nothing when reps agree across ships', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [flag('f', { good: 3 })]
    b.flags.known = [flag('f', { good: 3 })]
    expect(findConflicts(workspaceWith([a, b]))).toEqual([])
  })

  it('detects mismatched reps on any axis', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [flag('f', { good: 3 })]
    b.flags.known = [flag('f', { evil: 1 })]
    const conflicts = findConflicts(workspaceWith([a, b]))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].flagId).toBe('f')
  })
})

describe('applyResolution', () => {
  it('applies the entry with the highest total reputation', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [flag('f', { good: 3 })]
    b.flags.known = [flag('f', { evil: 1 })]
    const ws = workspaceWith([a, b])
    const target = applyResolution(ws, 'f', 'highest')
    expect(target).toEqual({ good: 3, evil: 0, lawful: 0, chaotic: 0 })
    expect(a.flags.flown[0].reputation).toEqual(target)
    expect(b.flags.known[0].reputation).toEqual(target)
  })

  it('applies the entry with the lowest total reputation', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [flag('f', { good: 3 })]
    b.flags.known = [flag('f', { evil: 1 })]
    const ws = workspaceWith([a, b])
    const target = applyResolution(ws, 'f', 'lowest')
    expect(target).toEqual({ good: 0, evil: 1, lawful: 0, chaotic: 0 })
    expect(a.flags.flown[0].reputation).toEqual(target)
    expect(b.flags.known[0].reputation).toEqual(target)
  })

  it('applies an explicit manual Reputation value', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [flag('f', { good: 3 })]
    b.flags.known = [flag('f', { evil: 1 })]
    const ws = workspaceWith([a, b])
    const manual = { good: 0, evil: 0, lawful: 2, chaotic: 0 }
    const target = applyResolution(ws, 'f', 'manual', manual)
    expect(target).toEqual(manual)
    expect(a.flags.flown[0].reputation).toEqual(manual)
    expect(b.flags.known[0].reputation).toEqual(manual)
  })

  it('treats a manual number as good-axis reputation for back-compat', () => {
    const a = makeShip({ name: 'A' })
    const b = makeShip({ name: 'B' })
    a.flags.flown = [flag('f', { good: 3 })]
    b.flags.known = [flag('f', { evil: 1 })]
    const ws = workspaceWith([a, b])
    const target = applyResolution(ws, 'f', 'manual', 4)
    expect(target).toEqual({ good: 4, evil: 0, lawful: 0, chaotic: 0 })
  })

  it('returns null when no conflict exists for the flagId', () => {
    const a = makeShip({ name: 'A' })
    a.flags.flown = [flag('f', { good: 3 })]
    const ws = workspaceWith([a])
    expect(applyResolution(ws, 'f', 'highest')).toBeNull()
  })
})
