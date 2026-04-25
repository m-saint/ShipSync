/**
 * Validators for the on-disk ShipFile shape and for in-memory Ship objects.
 * Keep these tolerant: we want to accept slightly-malformed files, surface a clear
 * problem report, and let the loader decide whether to repair or refuse.
 */

import { SHIP_SIZES, MOBILITY_OPTIONS, STATIONS, CARDINALS } from './rules.js'

/**
 * @typedef {Object} ValidationIssue
 * @property {'error'|'warn'} severity
 * @property {string} path        // dot-path into the object, e.g. "ship.officers.captain.rank"
 * @property {string} message
 */

/**
 * @typedef {Object} ValidationReport
 * @property {boolean} ok          // false iff any issue.severity === 'error'
 * @property {ValidationIssue[]} issues
 */

/**
 * @param {unknown} obj
 * @returns {ValidationReport}
 */
export function validateShipFile(obj) {
  /** @type {ValidationIssue[]} */
  const issues = []

  if (obj == null || typeof obj !== 'object') {
    issues.push({ severity: 'error', path: '', message: 'Save file is not a JSON object.' })
    return { ok: false, issues }
  }
  const file = /** @type {Record<string, unknown>} */ (obj)

  if (file.schemaVersion !== 1) {
    issues.push({
      severity: 'error',
      path: 'schemaVersion',
      message: `Unsupported schema version: ${String(file.schemaVersion)}. Expected 1.`,
    })
  }

  if (typeof file.createdAt !== 'string') {
    issues.push({
      severity: 'warn',
      path: 'createdAt',
      message: 'Missing or non-string createdAt timestamp; using load time as fallback.',
    })
  }

  if (file.images != null && (typeof file.images !== 'object' || Array.isArray(file.images))) {
    issues.push({ severity: 'error', path: 'images', message: 'images must be an object map.' })
  }

  if (file.ship == null) {
    issues.push({ severity: 'error', path: 'ship', message: 'Save file has no ship payload.' })
  } else {
    issues.push(...validateShipShape(file.ship, 'ship'))
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/**
 * @param {unknown} obj
 * @param {string} path
 * @returns {ValidationIssue[]}
 */
export function validateShipShape(obj, path = 'ship') {
  /** @type {ValidationIssue[]} */
  const issues = []
  if (obj == null || typeof obj !== 'object') {
    return [{ severity: 'error', path, message: 'Ship is not an object.' }]
  }
  const ship = /** @type {Record<string, unknown>} */ (obj)

  expectString(ship.id, `${path}.id`, issues)
  expectString(ship.name, `${path}.name`, issues)
  expectEnum(ship.size, SHIP_SIZES, `${path}.size`, issues)
  expectString(ship.type, `${path}.type`, issues, /* allowEmpty */ true)
  expectEnum(ship.mobility, MOBILITY_OPTIONS, `${path}.mobility`, issues)

  if (typeof ship.hp !== 'object' || ship.hp == null) {
    issues.push({ severity: 'error', path: `${path}.hp`, message: 'Missing hp { current, max }.' })
  } else {
    const hp = /** @type {Record<string, unknown>} */ (ship.hp)
    expectNumber(hp.current, `${path}.hp.current`, issues)
    expectNumber(hp.max, `${path}.hp.max`, issues)
  }

  expectNumber(ship.explosionDC, `${path}.explosionDC`, issues)
  expectNumber(ship.fires, `${path}.fires`, issues, /* allowZero */ true)

  if (typeof ship.officers !== 'object' || ship.officers == null) {
    issues.push({
      severity: 'error',
      path: `${path}.officers`,
      message: 'Missing officers roster.',
    })
  } else {
    const officers = /** @type {Record<string, unknown>} */ (ship.officers)
    for (const station of STATIONS) {
      if (officers[station] == null) {
        issues.push({
          severity: 'warn',
          path: `${path}.officers.${station}`,
          message: `Missing officer station "${station}"; will be defaulted to vacant.`,
        })
      }
    }
  }

  if (ship.sceneFlags != null && typeof ship.sceneFlags === 'object') {
    const sf = /** @type {Record<string, unknown>} */ (ship.sceneFlags)
    if (sf.facing != null && !CARDINALS.includes(/** @type {any} */ (sf.facing))) {
      issues.push({
        severity: 'warn',
        path: `${path}.sceneFlags.facing`,
        message: `Unknown cardinal "${String(sf.facing)}"; will be cleared.`,
      })
    }
  }

  return issues
}

function expectString(value, path, issues, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    issues.push({ severity: 'error', path, message: 'Expected non-empty string.' })
  }
}

function expectNumber(value, path, issues, allowZero = true) {
  if (typeof value !== 'number' || Number.isNaN(value) || (!allowZero && value === 0)) {
    issues.push({ severity: 'error', path, message: 'Expected a finite number.' })
  }
}

function expectEnum(value, allowed, path, issues) {
  if (!allowed.includes(/** @type {any} */ (value))) {
    issues.push({
      severity: 'error',
      path,
      message: `Expected one of ${allowed.join(', ')}; got ${String(value)}.`,
    })
  }
}
