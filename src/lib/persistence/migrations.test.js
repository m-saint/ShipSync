import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations/index.js'

describe('migrate', () => {
  it('passes through a current-version file unchanged', () => {
    const file = { schemaVersion: CURRENT_SCHEMA_VERSION, ship: { name: 'X' } }
    const result = migrate(file)
    expect(result.file).toBe(file)
    expect(result.appliedSteps).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns when no migration is registered for an older schema', () => {
    const file = { schemaVersion: 0, ship: { name: 'X' } }
    const result = migrate(file)
    expect(result.appliedSteps).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/migration/i)
  })

  it('does not loop forever on bogus input', () => {
    const result = migrate({ schemaVersion: -50 })
    expect(Array.isArray(result.warnings)).toBe(true)
  })
})
