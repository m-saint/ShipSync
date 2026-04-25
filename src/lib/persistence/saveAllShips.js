/**
 * Bulk save logic for the "Save all" surfaces (top-bar button + ⌘⇧S shortcut).
 *
 * Lives outside the button component so the dashboard's keyboard handler can
 * trigger the same code path without needing a `bind:this` reference. Toast
 * wording is identical regardless of which surface invokes it; that mirrors
 * Heuristic 4 (consistency) and saves us from re-deriving "saved 3 ships"
 * sentences in two places.
 */

import { workspace, markShipSaved } from '../state/workspace.svelte.js'
import { dirtyShips } from '../domain/derivations.js'
import { pushToast } from '../state/ui.svelte.js'
import { downloadShipFile } from './shipFile.js'

/**
 * Write every dirty ship in the workspace to a `.shipsync.json` file. If the
 * fleet is clean, surfaces a gentle "nothing to save" toast so the keyboard
 * shortcut never feels silent.
 */
export function saveAllDirtyShips() {
  const dirty = dirtyShips(workspace)
  if (dirty.length === 0) {
    pushToast({
      kind: 'info',
      title: 'Nothing to save.',
      body: 'No ship has changed since its last file save.',
    })
    return
  }
  /** @type {string[]} */
  const failures = []
  let succeeded = 0
  for (const ship of dirty) {
    try {
      downloadShipFile(ship, workspace.images)
      markShipSaved(ship.id)
      succeeded++
    } catch (e) {
      failures.push(`${ship.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (succeeded > 0) {
    pushToast({
      kind: failures.length ? 'info' : 'success',
      title: succeeded === 1 ? '1 ship saved.' : `${succeeded} ships saved.`,
      body:
        succeeded === 1
          ? 'Wrote one .shipsync.json file.'
          : `Wrote ${succeeded} .shipsync.json files. Your browser may have asked permission to download multiple files.`,
    })
  }
  if (failures.length) {
    pushToast({
      kind: 'error',
      title:
        failures.length === 1
          ? 'One ship failed to save.'
          : `${failures.length} ships failed to save.`,
      body: failures.join(' · '),
    })
  }
}
