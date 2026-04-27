<script>
  import EmptyState from '../../ui/EmptyState.svelte'
  import Button from '../../ui/Button.svelte'
  import ShipCard from './ShipCard.svelte'
  import { workspace } from '../../state/workspace.svelte.js'
  import { openDialog } from '../../state/ui.svelte.js'
  import { NauticalCopy } from '../../domain/derivations.js'

  /**
   * @type {{
   *   oncollapse?: () => void,
   * }}
   */
  let { oncollapse = undefined } = $props()

  let ships = $derived(
    workspace.shipOrder.map((id) => workspace.ships[id]).filter((s) => s != null),
  )
</script>

<aside
  class="surface-rail flex flex-col w-72 shrink-0 overflow-hidden min-h-0"
  aria-label="Loaded ships"
>
  <div class="p-3 border-b border-surface-200 flex items-center justify-between gap-2 shrink-0">
    <h2 class="display text-sm uppercase tracking-wider text-ink-500">Fleet</h2>
    <div class="flex items-center gap-2">
      <span class="text-xs text-ink-500">{ships.length}</span>
      {#if oncollapse}
        <button
          type="button"
          class="w-6 h-6 flex items-center justify-center rounded text-ink-500 hover:bg-surface-100 hover:text-ink-800"
          onclick={oncollapse}
          aria-label="Collapse fleet rail"
          aria-expanded="true"
          title="Collapse fleet (Shift+Cmd/Ctrl+[ to toggle)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M8 2L4 6l4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="flex-1 overflow-y-auto overscroll-contain p-3 flex flex-col gap-2">
    {#if ships.length === 0}
      {#snippet icon()}
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18l9 3 9-3M5 13l7-2 7 2M12 3v8m-3-3h6" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      {/snippet}
      {#snippet action()}
        <Button variant="primary" size="sm" onclick={() => openDialog('add-ship')}>
          Charter a vessel
        </Button>
      {/snippet}
      <EmptyState
        title={NauticalCopy.emptyWorkspaceTitle}
        body={NauticalCopy.emptyWorkspaceBody}
        icon={icon}
        action={action}
      />
    {:else}
      {#each ships as ship (ship.id)}
        <ShipCard {ship} />
      {/each}
    {/if}
  </div>

  {#if ships.length > 0}
    <div class="p-3 border-t border-surface-200 flex flex-col gap-2 bg-surface-100 shrink-0">
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onclick={() => openDialog('add-ship')}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Add another ship
      </Button>
    </div>
  {/if}
</aside>
