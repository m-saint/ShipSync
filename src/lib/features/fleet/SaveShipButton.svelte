<script>
  import Button from '../../ui/Button.svelte'
  import { workspace, markShipSaved } from '../../state/workspace.svelte.js'
  import { downloadShipFile } from '../../persistence/shipFile.js'
  import { pushToast } from '../../state/ui.svelte.js'
  import { shortcutHint } from '../../ui/platform.js'

  let { ship, variant = 'secondary', size = 'md', label = 'Save ship' } = $props()
</script>

<Button
  {variant}
  {size}
  onclick={() => {
    try {
      const filename = downloadShipFile(ship, workspace.images)
      markShipSaved(ship.id)
      pushToast({ kind: 'success', title: 'Ship saved.', body: filename })
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Could not save ship',
        body: e instanceof Error ? e.message : String(e),
      })
    }
  }}
  title={`Save ${ship.name} as a .shipsync.json file (${shortcutHint('S')})`}
>
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2.5 1.5h7l3 3v8h-10zM5 1.5v3h4v-3M4 8.5h6v4H4z" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linejoin="round"/>
  </svg>
  {label}
</Button>
