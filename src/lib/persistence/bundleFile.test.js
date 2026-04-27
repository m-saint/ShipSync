/**
 * Round-trip + edge-case coverage for the v1.0 bundle format.
 *
 * These tests intentionally avoid the workspace store; they exercise
 * the persistence layer in isolation so future refactors of the runtime
 * (Svelte runes, store layout, etc.) don't move the goalposts on this
 * file format. Anything the bundle file *promises* to do for the user
 * lives here.
 */

import { describe, expect, it } from 'vitest'
import {
  BUNDLE_SCHEMA,
  makeBundleFile,
  serializeBundleFile,
  bundleFilename,
  isBundlePayload,
  parseBundleFile,
} from './bundleFile.js'

/**
 * Hand-build a tiny but realistic workspace-like object: one ship with
 * a portrait, one officer with a portrait, one flag with art. That
 * exercises every image-collection branch in `makeBundleFile` while
 * staying small enough to read in one screen.
 *
 * @returns {{
 *   ships: Record<string, import('../domain/types.js').Ship>,
 *   shipOrder: string[],
 *   scene: import('../domain/types.js').Scene,
 *   images: import('../domain/types.js').ImageStore
 * }}
 */
function makeFixtureWorkspace() {
  const ship = /** @type {import('../domain/types.js').Ship} */ ({
    id: 'ship-A',
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
    officers: {
      captain: {
        name: 'Aria',
        rank: 3,
        status: 'active',
        portraitImageId: 'img-officer',
        notes: 'Loud.',
      },
    },
    mettle: { current: 8, notes: '' },
    flags: {
      flown: [
        {
          id: 'flag-A',
          name: 'Skull & Crossbones',
          imageId: 'img-flag',
          reputation: 2,
          isPirate: true,
          isFalse: false,
        },
      ],
      known: [],
      flyingId: 'flag-A',
    },
    sceneFlags: {
      inIrons: false,
      hasWeatherGage: false,
      adjacentToShipIds: [],
      facing: null,
      speedZero: true,
    },
    fires: 0,
    boardedBy: null,
    portraitImageId: 'img-ship',
    playerCharacter: null,
    lastModifiedAt: null,
    conditions: [],
  })

  return {
    ships: { 'ship-A': ship },
    shipOrder: ['ship-A'],
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
    images: {
      'img-ship': 'data:image/png;base64,SHIP',
      'img-officer': 'data:image/png;base64,OFFICER',
      'img-flag': 'data:image/png;base64,FLAG',
      'img-orphan': 'data:image/png;base64,ORPHAN',
    },
  }
}

describe('bundleFile.js (v1.0)', () => {
  it('makeBundleFile stamps the schema and copies only referenced images', () => {
    const ws = makeFixtureWorkspace()
    const bundle = makeBundleFile(ws, { savedAt: '2026-04-25T18:00:00.000Z' })
    expect(bundle.schema).toBe(BUNDLE_SCHEMA)
    expect(bundle.savedAt).toBe('2026-04-25T18:00:00.000Z')
    expect(bundle.shipOrder).toEqual(['ship-A'])
    expect(Object.keys(bundle.ships)).toEqual(['ship-A'])
    expect(Object.keys(bundle.images).sort()).toEqual(['img-flag', 'img-officer', 'img-ship'])
    expect(bundle.images['img-orphan']).toBeUndefined()
  })

  it('serializeBundleFile produces parseable JSON', () => {
    const ws = makeFixtureWorkspace()
    const text = serializeBundleFile(ws)
    const parsed = JSON.parse(text)
    expect(parsed.schema).toBe(BUNDLE_SCHEMA)
    expect(parsed.ships['ship-A'].name).toBe('Marigold')
  })

  it('round-trips through parseBundleFile preserving ship + scene + images', async () => {
    const ws = makeFixtureWorkspace()
    const text = serializeBundleFile(ws, { savedAt: '2026-01-01T00:00:00.000Z' })
    // jsdom's File takes a BlobPart array + filename.
    const file = new File([text], 'fleet.shipsync.bundle.json', {
      type: 'application/json',
    })
    const result = await parseBundleFile(file)
    expect(result.ok).toBe(true)
    expect(result.bundle).not.toBeNull()
    expect(result.bundle?.shipOrder).toEqual(['ship-A'])
    expect(result.bundle?.ships['ship-A'].name).toBe('Marigold')
    expect(Object.keys(result.bundle?.images ?? {}).sort()).toEqual([
      'img-flag',
      'img-officer',
      'img-ship',
    ])
    expect(result.bundle?.savedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.issues).toHaveLength(0)
  })

  it('parseBundleFile rejects non-JSON payloads', async () => {
    const file = new File(['not json'], 'broken.shipsync.bundle.json')
    const result = await parseBundleFile(file)
    expect(result.ok).toBe(false)
    expect(result.bundle).toBeNull()
    expect(result.issues[0].severity).toBe('error')
  })

  it('parseBundleFile rejects payloads with no schema marker', async () => {
    const file = new File([JSON.stringify({ ships: {}, scene: {}, images: {} })], 'plain.json')
    const result = await parseBundleFile(file)
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toMatch(/shipsync\.bundle/i)
  })

  it('parseBundleFile loads with a warning when the schema is a future variant', async () => {
    const ws = makeFixtureWorkspace()
    const bundle = makeBundleFile(ws)
    bundle.schema = 'shipsync.bundle/v2'
    const file = new File([JSON.stringify(bundle)], 'future.shipsync.bundle.json')
    const result = await parseBundleFile(file)
    expect(result.ok).toBe(true)
    expect(result.issues.some((issue) => /different schema/.test(issue.message))).toBe(true)
  })

  it('parseBundleFile drops unknown ship ids from shipOrder and notes the fix', async () => {
    const ws = makeFixtureWorkspace()
    const bundle = makeBundleFile(ws)
    bundle.shipOrder = ['ship-A', 'ship-MISSING']
    const file = new File([JSON.stringify(bundle)], 'fleet.shipsync.bundle.json')
    const result = await parseBundleFile(file)
    expect(result.ok).toBe(true)
    expect(result.bundle?.shipOrder).toEqual(['ship-A'])
    expect(result.issues.some((issue) => /stale ship id/.test(issue.message))).toBe(true)
  })

  it('parseBundleFile defaults a missing scene to idle', async () => {
    const ws = makeFixtureWorkspace()
    const bundle = makeBundleFile(ws)
    delete /** @type {{ scene?: unknown }} */ (bundle).scene
    const file = new File([JSON.stringify(bundle)], 'noscene.shipsync.bundle.json')
    const result = await parseBundleFile(file)
    expect(result.ok).toBe(true)
    expect(result.bundle?.scene.mode).toBe('idle')
    expect(result.issues.some((issue) => /idle scene/.test(issue.message))).toBe(true)
  })

  it('isBundlePayload sniffs schema marker', () => {
    expect(isBundlePayload({ schema: BUNDLE_SCHEMA })).toBe(true)
    expect(isBundlePayload({ schema: 'shipsync.bundle/v99' })).toBe(true)
    expect(isBundlePayload({ schema: 'shipsync.ship/v1' })).toBe(false)
    expect(isBundlePayload(null)).toBe(false)
    expect(isBundlePayload({})).toBe(false)
    expect(isBundlePayload('a string')).toBe(false)
  })

  it('bundleFilename uses the bundle extension and a safe stem', () => {
    const name = bundleFilename({ stem: 'My Crew!! 2026', withTimestamp: false })
    expect(name).toMatch(/\.shipsync\.bundle\.json$/)
    expect(name).toMatch(/my-crew-2026/)
  })

  it('bundleFilename includes a timestamp by default', () => {
    const name = bundleFilename()
    expect(name).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.shipsync\.bundle\.json$/)
  })
})
