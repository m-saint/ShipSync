/**
 * Schema migrations for ShipFile.
 * Current version: 1. No migrations yet; v2_to_v3 etc. land here as the schema evolves.
 *
 * Each migration is a pure function (rawFile) -> rawFile that bumps schemaVersion by exactly 1.
 * `migrate()` chains them in sequence, collecting issues.
 */

/**
 * @typedef {Object} MigrationResult
 * @property {object} file              // possibly-migrated raw file
 * @property {string[]} appliedSteps    // names of migrations that ran
 * @property {string[]} warnings        // human-readable problems we worked around
 */

/** @type {Record<number, (file: any) => { file: any, warnings?: string[] }>} */
const migrations = {
  // 1: (file) => v1_to_v2(file),
}

export const CURRENT_SCHEMA_VERSION = 1

/**
 * @param {any} rawFile
 * @returns {MigrationResult}
 */
export function migrate(rawFile) {
  const result = { file: rawFile, appliedSteps: [], warnings: [] }
  let safety = 0
  while (
    rawFile &&
    typeof rawFile.schemaVersion === 'number' &&
    rawFile.schemaVersion < CURRENT_SCHEMA_VERSION &&
    safety++ < 16
  ) {
    const fromVersion = rawFile.schemaVersion
    const step = migrations[fromVersion]
    if (!step) {
      result.warnings.push(
        `No migration registered from schemaVersion ${fromVersion} to ${fromVersion + 1}.`,
      )
      break
    }
    const out = step(rawFile)
    rawFile = out.file
    result.appliedSteps.push(`v${fromVersion}_to_v${fromVersion + 1}`)
    if (out.warnings?.length) result.warnings.push(...out.warnings)
  }
  result.file = rawFile
  return result
}
