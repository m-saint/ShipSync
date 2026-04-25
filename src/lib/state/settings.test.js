/**
 * Tests for the v1.0 preferences store. Each test re-imports the module
 * after clearing localStorage so the module-init side-effects (initial
 * `loadSettings()`) reflect the current storage state under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'shipsync.settings.v1'

/**
 * Map-backed Storage shim. Node 22's built-in localStorage and jsdom's both
 * fight with `vi.stubGlobal` in subtle ways, so we follow the same pattern
 * `autosave.test.js` uses: install a tiny in-memory Storage per test, then
 * dynamically import the settings module so `loadSettings()` reads from
 * THIS shim (not whatever leaked over from a sibling test file).
 */
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
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageShim())
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Re-import the settings module after a `vi.resetModules()` call so the
 * module-level `$state(loadSettings())` re-runs against the freshly-stubbed
 * localStorage for each test.
 */
async function freshSettingsModule() {
  return import('./settings.svelte.js')
}

describe('settings.svelte.js (v1.0)', () => {
  it('boots with sane defaults when localStorage is empty', async () => {
    const mod = await freshSettingsModule()
    expect(mod.settings.colorScheme).toBe('auto')
    expect(mod.settings.density).toBe('comfortable')
    expect(mod.settings.autosaveDebounceMs).toBe(750)
    expect(mod.settings.carryOverOnCharter).toBe(false)
  })

  it('round-trips colorScheme through localStorage', async () => {
    let mod = await freshSettingsModule()
    mod.setColorScheme('dark')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).colorScheme).toBe('dark')

    mod = await freshSettingsModule()
    expect(mod.settings.colorScheme).toBe('dark')
  })

  it('ignores unknown colorScheme values silently', async () => {
    const mod = await freshSettingsModule()
    // @ts-expect-error -- testing untrusted input.
    mod.setColorScheme('neon')
    expect(mod.settings.colorScheme).toBe('auto')
  })

  it('round-trips density through localStorage', async () => {
    let mod = await freshSettingsModule()
    mod.setDensity('compact')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).density).toBe('compact')

    mod = await freshSettingsModule()
    expect(mod.settings.density).toBe('compact')
  })

  it('clamps autosave debounce into the supported range', async () => {
    const mod = await freshSettingsModule()
    mod.setAutosaveDebounceMs(0)
    expect(mod.settings.autosaveDebounceMs).toBe(mod.MIN_AUTOSAVE_DEBOUNCE_MS)
    mod.setAutosaveDebounceMs(60 * 60 * 1000)
    expect(mod.settings.autosaveDebounceMs).toBe(mod.MAX_AUTOSAVE_DEBOUNCE_MS)
  })

  it('drops non-finite autosave values', async () => {
    const mod = await freshSettingsModule()
    const before = mod.settings.autosaveDebounceMs
    mod.setAutosaveDebounceMs(NaN)
    mod.setAutosaveDebounceMs(Infinity)
    expect(mod.settings.autosaveDebounceMs).toBe(before)
  })

  it('persists autosave debounce changes', async () => {
    let mod = await freshSettingsModule()
    mod.setAutosaveDebounceMs(30_000)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).autosaveDebounceMs).toBe(30_000)

    mod = await freshSettingsModule()
    expect(mod.settings.autosaveDebounceMs).toBe(30_000)
  })

  it('restores defaults via resetSettings()', async () => {
    const mod = await freshSettingsModule()
    mod.setColorScheme('dark')
    mod.setDensity('compact')
    mod.setAutosaveDebounceMs(10_000)
    mod.setCarryOverOnCharter(true)

    mod.resetSettings()
    expect(mod.settings.colorScheme).toBe('auto')
    expect(mod.settings.density).toBe('comfortable')
    expect(mod.settings.autosaveDebounceMs).toBe(750)
    expect(mod.settings.carryOverOnCharter).toBe(false)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).colorScheme).toBe('auto')
  })

  it('round-trips carryOverOnCharter through localStorage', async () => {
    let mod = await freshSettingsModule()
    mod.setCarryOverOnCharter(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).carryOverOnCharter).toBe(true)

    mod = await freshSettingsModule()
    expect(mod.settings.carryOverOnCharter).toBe(true)
  })

  it('coerces non-boolean carryOverOnCharter input to a boolean', async () => {
    const mod = await freshSettingsModule()
    // @ts-expect-error -- testing untrusted input.
    mod.setCarryOverOnCharter('yes please')
    expect(mod.settings.carryOverOnCharter).toBe(false)
  })

  it('falls back to defaults when stored payload is corrupt JSON', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid')
    const mod = await freshSettingsModule()
    expect(mod.settings.colorScheme).toBe('auto')
    expect(mod.settings.density).toBe('comfortable')
  })

  it('repairs unknown enum values on read', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ colorScheme: 'neon', density: 'huge', autosaveDebounceMs: 'fast' }),
    )
    const mod = await freshSettingsModule()
    expect(mod.settings.colorScheme).toBe('auto')
    expect(mod.settings.density).toBe('comfortable')
    expect(mod.settings.autosaveDebounceMs).toBe(750)
  })

  it('effectiveColorScheme returns the explicit value when forced', async () => {
    const mod = await freshSettingsModule()
    mod.setColorScheme('dark')
    expect(mod.effectiveColorScheme()).toBe('dark')
    mod.setColorScheme('light')
    expect(mod.effectiveColorScheme()).toBe('light')
  })
})
