<script>
  /**
   * SaveAllShipsButton — bulk action that writes every ship with edits since
   * its last save to a `.shipsync.json` file. The set is derived from
   * `dirtyShips(workspace)` (action timestamp newer than save timestamp), so
   * the button only "lights up" when there's something real to do and
   * automatically resets after a save.
   *
   * Browsers handle multi-file downloads inconsistently — most will pop a
   * "this site wants to download multiple files?" prompt the first time a
   * user does this in a session. The toast wording leans on that mental model
   * ("downloaded 3 files") so the prompt isn't surprising.
   *
   * The actual save logic lives in `persistence/saveAllShips.js` so the
   * keyboard shortcut in Dashboard.svelte can reuse the exact same code path.
   */

  import Button from '../../ui/Button.svelte'
  import { workspace } from '../../state/workspace.svelte.js'
  import { dirtyShips } from '../../domain/derivations.js'
  import { saveAllDirtyShips } from '../../persistence/saveAllShips.js'
  import { shortcutHint } from '../../ui/platform.js'

  let dirty = $derived(dirtyShips(workspace))
  let count = $derived(dirty.length)
  let disabled = $derived(count === 0)

  const SAVE_ALL_SHORTCUT = shortcutHint('S', { shift: true })

  let label = $derived.by(() => {
    if (count === 0) return 'Save all'
    return `Save all (${count})`
  })

  let title = $derived.by(() => {
    if (count === 0) {
      return `Nothing changed since the last save (${SAVE_ALL_SHORTCUT}).`
    }
    if (count === 1) {
      return `Write 1 ship to a .shipsync.json file · ${SAVE_ALL_SHORTCUT}.`
    }
    return `Write ${count} ships to .shipsync.json files · ${SAVE_ALL_SHORTCUT}. Your browser may ask permission to download multiple files.`
  })
</script>

<Button variant="secondary" size="md" onclick={saveAllDirtyShips} {disabled} {title}>
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M2.5 1.5h7l3 3v8h-10zM5 1.5v3h4v-3M4 8.5h6v4H4z"
      stroke="currentColor"
      stroke-width="1.25"
      fill="none"
      stroke-linejoin="round"
    />
  </svg>
  {label}
</Button>
