/**
 * Tests for the localStorage-backed autosave layer.
 *
 * Why we hand-roll a localStorage shim: Node 22+ ships its own localStorage
 * implementation that requires `--localstorage-file`. Inside vitest's jsdom
 * environment this can fight with jsdom's own Storage. To keep the test isolated
 * and predictable we replace `localStorage` with a Map-backed shim per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAutosave,
  makeAutosaver,
  readAutosave,
  readAutosaveMeta,
  writeAutosave,
} from './autosave.js'

const KEY = 'shipsync.workspace.autosave.v1'
const META_KEY = 'shipsync.workspace.autosave.meta.v1'

/** A tiny Storage implementation that supports the few methods autosave.js calls. */
function makeStorageShim() {
  /** @type {Map<string,string>} */
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
    get length() {
      return store.size
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null
    },
    /** Internal: peek at the underlying store for assertions. */
    __raw: store,
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageShim())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('write / read round-trip', () => {
  it('readAutosave is null when nothing has been written yet', () => {
    expect(readAutosave()).toBeNull()
    expect(readAutosaveMeta()).toBeNull()
  })

  it('writeAutosave persists snapshot + meta and round-trips through readAutosave', () => {
    const snapshot = { ships: { abc: { id: 'abc', name: 'X' } }, shipOrder: ['abc'] }
    const meta = writeAutosave(snapshot)
    expect(meta.imagesStripped).toBe(false)
    expect(typeof meta.savedAt).toBe('string')

    expect(readAutosave()).toEqual(snapshot)
    expect(readAutosaveMeta()).toEqual(meta)
  })

  it('clearAutosave removes both keys', () => {
    writeAutosave({ ships: {}, shipOrder: [] })
    expect(localStorage.getItem(KEY)).not.toBeNull()
    expect(localStorage.getItem(META_KEY)).not.toBeNull()
    clearAutosave()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(META_KEY)).toBeNull()
  })

  it('readAutosave returns null on corrupted JSON', () => {
    localStorage.setItem(KEY, '{ bad json')
    expect(readAutosave()).toBeNull()
  })
})

describe('quota fallback', () => {
  it('strips images and retries when the first write fails with QuotaExceededError', () => {
    let setCalls = 0
    const realSet = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      setCalls++
      if (setCalls === 1 && key === KEY) {
        const err = new Error('quota')
        /** @type {any} */
        const e = err
        e.name = 'QuotaExceededError'
        throw err
      }
      realSet(key, value)
    })

    const meta = writeAutosave({ ships: {}, shipOrder: [], images: { 'img-1': 'data:...' } })
    expect(meta).not.toBeNull()
    expect(meta?.imagesStripped).toBe(true)
    const persisted = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(persisted.images).toEqual({})
  })

  it('returns null when both the full and stripped writes fail', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const err = new Error('quota')
      /** @type {any} */
      const e = err
      e.name = 'QuotaExceededError'
      throw err
    })
    const meta = writeAutosave({ ships: {}, shipOrder: [], images: { 'img-1': 'data:...' } })
    expect(meta).toBeNull()
  })

  it('returns null on a non-quota write error too', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('something else')
    })
    const meta = writeAutosave({ ships: {}, shipOrder: [] })
    expect(meta).toBeNull()
  })
})

describe('makeAutosaver', () => {
  it('debounces back-to-back schedule() calls', () => {
    vi.useFakeTimers()
    const writes = []
    const autosaver = makeAutosaver(() => ({ ships: {}, shipOrder: [] }), {
      debounceMs: 100,
      onWrite: (m) => writes.push(m),
    })
    autosaver.schedule()
    autosaver.schedule()
    autosaver.schedule()
    expect(writes).toEqual([])
    vi.advanceTimersByTime(100)
    expect(writes).toHaveLength(1)
  })

  it('flushNow writes immediately and updates lastMeta', () => {
    const autosaver = makeAutosaver(() => ({ ships: {}, shipOrder: [], stamp: 'now' }))
    autosaver.flushNow()
    expect(autosaver.lastMeta()).not.toBeNull()
    expect(readAutosave()).toEqual({ ships: {}, shipOrder: [], stamp: 'now' })
  })

  it('invokes onError (and not onWrite) when the write fails entirely', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('disk on fire')
    })
    const writes = []
    let errors = 0
    const autosaver = makeAutosaver(() => ({ ships: {}, shipOrder: [] }), {
      onWrite: (m) => writes.push(m),
      onError: () => errors++,
    })
    autosaver.flushNow()
    expect(writes).toEqual([])
    expect(errors).toBe(1)
    expect(autosaver.lastMeta()).toBeNull()
  })

  it('a successful retry after a failure flips state back via onWrite', () => {
    let throwNext = true
    const realSet = localStorage.setItem.bind(localStorage)
    vi.spyOn(localStorage, 'setItem').mockImplementation((k, v) => {
      if (throwNext) {
        throwNext = false
        throw new Error('transient')
      }
      realSet(k, v)
    })
    const writes = []
    let errors = 0
    const autosaver = makeAutosaver(() => ({ ships: {}, shipOrder: [], stamp: 'retry' }), {
      onWrite: (m) => writes.push(m),
      onError: () => errors++,
    })
    autosaver.flushNow()
    expect(errors).toBe(1)
    expect(writes).toHaveLength(0)

    autosaver.flushNow()
    expect(errors).toBe(1)
    expect(writes).toHaveLength(1)
    expect(readAutosave()).toEqual({ ships: {}, shipOrder: [], stamp: 'retry' })
  })
})
