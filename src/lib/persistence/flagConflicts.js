/**
 * Workspace-level flag reputation conflict helpers.
 *
 * §3 reputation is per-flag, but each ship file owns its own copy of every
 * flag. When two ship files disagree on a flag's reputation (e.g. one was
 * saved after a raid that bumped The Black Spear's rep but the other
 * wasn't), we surface a non-blocking conflict and offer the user three
 * resolutions.
 *
 * Reputation is a four-axis tally (PDF p. 200). For the "highest" /
 * "lowest" modes we pick the entry with the largest / smallest *total*
 * across all four axes and propagate that whole tally. Manual mode lets
 * the caller hand in a fully-shaped Reputation object.
 */

import { REPUTATION_AXES } from '../domain/rules.js'
import {
  detectFlagConflicts,
  flagTotalReputation,
  normalizeReputation,
} from '../domain/derivations.js'

/**
 * @typedef {'highest'|'lowest'|'manual'} ConflictResolution
 */

/**
 * Detect conflicts in the current workspace.
 * @param {import('../domain/types.js').Workspace} workspace
 */
export function findConflicts(workspace) {
  const ships = Object.values(workspace.ships)
  return detectFlagConflicts(ships)
}

/**
 * Apply a resolution to a single flag id across the entire workspace.
 *
 * - `highest`: copy the entry with the largest *total* reputation
 * - `lowest`:  copy the entry with the smallest total reputation
 * - `manual`:  caller supplies an explicit Reputation object (or a number,
 *              which is interpreted as "good" rep for back-compat)
 *
 * The caller is expected to wrap this in workspace.commit() so it's logged
 * & undoable.
 *
 * @param {import('../domain/types.js').Workspace} workspace
 * @param {string} flagId
 * @param {ConflictResolution} mode
 * @param {import('../domain/types.js').Reputation | number} [manualValue]
 * @returns {import('../domain/types.js').Reputation | null}
 */
export function applyResolution(workspace, flagId, mode, manualValue) {
  const conflict = findConflicts(workspace).find((c) => c.flagId === flagId)
  if (!conflict) return null

  /** @type {import('../domain/types.js').Reputation} */
  let target
  if (mode === 'manual') {
    target = normalizeReputation(manualValue)
  } else {
    const sorted = [...conflict.entries].sort(
      (a, b) =>
        flagTotalReputation(/** @type {any} */ ({ reputation: a.reputation })) -
        flagTotalReputation(/** @type {any} */ ({ reputation: b.reputation })),
    )
    const pick = mode === 'highest' ? sorted[sorted.length - 1] : sorted[0]
    target = normalizeReputation(pick?.reputation)
  }

  for (const ship of Object.values(workspace.ships)) {
    for (const flag of ship.flags?.flown ?? []) {
      if (flag.id === flagId) flag.reputation = { ...target }
    }
    for (const flag of ship.flags?.known ?? []) {
      if (flag.id === flagId) flag.reputation = { ...target }
    }
  }
  return target
}

// Re-export so call sites (the conflict resolver dialog) can iterate axes
// without a second import path.
export { REPUTATION_AXES }
