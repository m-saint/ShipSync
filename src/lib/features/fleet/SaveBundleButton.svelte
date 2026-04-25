<script>
  /**
   * SaveBundleButton — v1.0 fleet archive export.
   *
   * Writes the entire workspace (ships + ship order + scene + image
   * store) to a single `.shipsync.bundle.json` file. Useful for handing
   * a session over, archiving an arc, or backing up before a risky
   * change. Sits next to "Save all" in the WorkspaceTopBar so the two
   * persistence affordances are side-by-side in the captain's mental
   * model:
   *   - Save all → one file per ship, the canonical sharing format.
   *   - Save bundle → one file for the fleet, the archive format.
   *
   * Disabled when no ships are loaded (an empty bundle is technically
   * valid but offers no value — better to grey out than confuse).
   *
   * The bundle stamps every loaded ship's `lastSavedAtByShipId` to the
   * file's `savedAt` on import, so a round-tripped bundle behaves like
   * a fresh fleet of saved ships (no false-positive "dirty" markers).
   */

  import Button from '../../ui/Button.svelte'
  import { workspace } from '../../state/workspace.svelte.js'
  import { downloadBundleFile } from '../../persistence/bundleFile.js'
  import { pushToast } from '../../state/ui.svelte.js'
  import { shortcutHint } from '../../ui/platform.js'

  let shipCount = $derived(workspace.shipOrder.length)
  let disabled = $derived(shipCount === 0)

  const SAVE_BUNDLE_SHORTCUT = shortcutHint('B', { shift: true })

  let title = $derived.by(() => {
    if (disabled) {
      return `Charter or load at least one ship to save a bundle (${SAVE_BUNDLE_SHORTCUT}).`
    }
    const sizeNote =
      shipCount === 1
        ? 'Save the entire workspace (1 ship + scene + images) as a .shipsync.bundle.json archive'
        : `Save the entire workspace (${shipCount} ships + scene + images) as a .shipsync.bundle.json archive`
    return `${sizeNote} · ${SAVE_BUNDLE_SHORTCUT}.`
  })

  function handleSaveBundle() {
    if (disabled) return
    try {
      const filename = downloadBundleFile({
        ships: $state.snapshot(workspace.ships),
        shipOrder: [...workspace.shipOrder],
        scene: $state.snapshot(workspace.scene),
        images: $state.snapshot(workspace.images),
      })
      pushToast({
        kind: 'success',
        title: 'Bundle saved.',
        body: `Wrote ${filename}.`,
      })
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Bundle save failed.',
        body: e instanceof Error ? e.message : 'Could not write the bundle file.',
      })
    }
  }
</script>

<Button variant="secondary" size="md" onclick={handleSaveBundle} {disabled} {title}>
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M2 3.5h10v8a1 1 0 01-1 1H3a1 1 0 01-1-1zM4 3.5V2a1 1 0 011-1h4a1 1 0 011 1v1.5M5 7.5h4M5 9.5h4"
      stroke="currentColor"
      stroke-width="1.25"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
  Save bundle
</Button>
