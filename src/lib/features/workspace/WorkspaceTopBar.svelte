<script>
  import Button from '../../ui/Button.svelte'
  import LoadShipsButton from './LoadShipsButton.svelte'
  import SaveAllShipsButton from '../fleet/SaveAllShipsButton.svelte'
  import SaveBundleButton from '../fleet/SaveBundleButton.svelte'
  import PrintFleetButton from '../fleet/PrintFleetButton.svelte'
  import AutosaveIndicator from './AutosaveIndicator.svelte'
  import UndoRedoControls from '../activityLog/UndoRedoControls.svelte'
  import { workspace } from '../../state/workspace.svelte.js'
  import { openDialog } from '../../state/ui.svelte.js'
  import { shortcutHint } from '../../ui/platform.js'

  let {
    autosaveState = 'idle',
    autosaveMeta = null,
    onAutosaveRetry = /** @type {(() => void) | null} */ (null),
  } = $props()

  let shipCount = $derived(workspace.shipOrder.length)

  const SHORE_LEAVE_SHORTCUT = shortcutHint('L', { shift: true })
  const PREFERENCES_SHORTCUT = shortcutHint(',')
  const PREFERENCES_TITLE = `Preferences (color scheme, density, autosave cadence) · ${PREFERENCES_SHORTCUT}.`

  let shoreLeaveTitle = $derived.by(() => {
    if (shipCount === 0) {
      return `Load at least one ship to set a shore leave (${SHORE_LEAVE_SHORTCUT}).`
    }
    return `Refit hull, supplies, and scene chips across selected ships in one undoable step · ${SHORE_LEAVE_SHORTCUT}.`
  })
</script>

<header class="border-b border-surface-200 bg-surface-100/70 backdrop-blur-sm">
  <div class="px-4 py-3 flex items-center gap-4">
    <div class="flex items-center gap-2">
      <h1 class="display text-lg leading-none">ShipSync</h1>
    </div>

    <div class="text-xs text-ink-500 hidden sm:block">
      {#if shipCount === 0}
        No ships loaded
      {:else}
        {shipCount} {shipCount === 1 ? 'ship' : 'ships'} aboard
      {/if}
    </div>

    <div class="flex-1"></div>

    <UndoRedoControls />
    <AutosaveIndicator
      state={autosaveState}
      lastSavedAt={autosaveMeta?.savedAt ?? null}
      imagesStripped={autosaveMeta?.imagesStripped ?? false}
      onretry={onAutosaveRetry}
    />

    <Button
      variant="ghost"
      onclick={() => openDialog('shore-leave')}
      disabled={shipCount === 0}
      title={shoreLeaveTitle}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 11h10M3 11l2-6h4l2 6M5 5h4M7 2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
      Shore leave
    </Button>

    <SaveAllShipsButton />
    <SaveBundleButton />
    <PrintFleetButton />
    <LoadShipsButton />
    <Button
      variant="primary"
      onclick={() => openDialog('add-ship')}
      title="Add a fresh vessel"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
      </svg>
      Add ship
    </Button>
    <Button
      variant="ghost"
      onclick={() => openDialog('settings')}
      title={PREFERENCES_TITLE}
      aria-label="Preferences"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" stroke="currentColor" stroke-width="1.25" fill="none"/>
        <path d="M8 1.5v1.5M8 13v1.5M3.5 3.5l1 1M11.5 11.5l1 1M1.5 8h1.5M13 8h1.5M3.5 12.5l1-1M11.5 4.5l1-1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
      </svg>
    </Button>
  </div>
</header>
