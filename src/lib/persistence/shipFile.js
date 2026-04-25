/**
 * Save a single ship to a `.shipsync.json` file.
 *
 * Heuristic 9 mitigation: filename is derived from ship name plus ISO timestamp,
 * so users can tell saves apart from each other and from other ships in their fleet.
 */

import { SHIP_FILE_EXTENSION, SHIP_FILE_MIME } from '../domain/rules.js'
import { makeShipFile } from '../domain/derivations.js'

/**
 * Build a safe filename for a ship file.
 * @param {import('../domain/types.js').Ship} ship
 * @param {{ withTimestamp?: boolean }} [opts]
 */
export function shipFileFilename(ship, opts = {}) {
  const stem = (ship.name || 'unnamed-vessel')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'ship'
  if (opts.withTimestamp === false) return `${stem}${SHIP_FILE_EXTENSION}`
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${stem}--${stamp}${SHIP_FILE_EXTENSION}`
}

/**
 * Serialize a ship to a JSON string ready to write.
 * @param {import('../domain/types.js').Ship} ship
 * @param {import('../domain/types.js').ImageStore} workspaceImages
 * @returns {string}
 */
export function serializeShipFile(ship, workspaceImages) {
  const file = makeShipFile(ship, workspaceImages)
  return JSON.stringify(file, null, 2)
}

/**
 * Trigger a browser download of the given ship as a `.shipsync.json` file.
 * Returns the filename used, for logging.
 * @param {import('../domain/types.js').Ship} ship
 * @param {import('../domain/types.js').ImageStore} workspaceImages
 * @param {{ withTimestamp?: boolean, filename?: string }} [opts]
 * @returns {string}
 */
export function downloadShipFile(ship, workspaceImages, opts = {}) {
  const text = serializeShipFile(ship, workspaceImages)
  const filename = opts.filename ?? shipFileFilename(ship, { withTimestamp: opts.withTimestamp })
  const blob = new Blob([text], { type: SHIP_FILE_MIME })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Defer revoke a tick so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return filename
}
