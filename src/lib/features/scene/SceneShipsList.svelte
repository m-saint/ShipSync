<script>
  /**
   * SceneShipsList — the right-rail container for ephemeral non-player ships.
   * Header counts the current scene; an "Add" button drops in a new SceneShipCard.
   * Empty state explains what scene ships are *for* so the user doesn't confuse
   * them with their persistent fleet.
   *
   * Scene ships exist only for the duration of the workspace session — they
   * ride along in the autosave for crash recovery but never get written to a
   * `.shipsync.json`. That asymmetry is intentional: enemy frigates don't
   * deserve their own files.
   */

  import SceneShipCard from './SceneShipCard.svelte'
  import EmptyState from '../../ui/EmptyState.svelte'
  import Button from '../../ui/Button.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import { workspace, addSceneShip } from '../../state/workspace.svelte.js'
  import { NauticalCopy } from '../../domain/derivations.js'

  let order = $derived(workspace.scene.sceneShipOrder)
  let sceneShips = $derived(
    order.map((id) => workspace.scene.sceneShips[id]).filter((s) => s != null),
  )

  const ADD_HINT =
    "Temporarily add any vessel that's joined the scene."

  function onAdd() {
    const sequence = sceneShips.length + 1
    addSceneShip({ name: `Sighted Vessel ${sequence}` })
  }
</script>

<section class="flex flex-col" aria-label="Other ships in the scene">
  <header class="px-3 py-2 border-b border-surface-200 flex items-center justify-between bg-surface-100">
    <h3 class="display text-xs uppercase tracking-wider text-ink-500">Other ships in scene</h3>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">
      {sceneShips.length}
    </span>
  </header>

  <div class="px-3 py-3 flex flex-col gap-3">
    {#if sceneShips.length === 0}
      <EmptyState
        align="left"
        title={NauticalCopy.emptyOtherShipsTitle}
        body={NauticalCopy.emptyOtherShipsBody}
      />
    {:else}
      {#each sceneShips as sceneShip (sceneShip.id)}
        <SceneShipCard {sceneShip} />
      {/each}
    {/if}

    <RuleTooltip hint={ADD_HINT} display="block">
      <Button variant="secondary" size="sm" fullWidth onclick={onAdd}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        Add scene ship
      </Button>
    </RuleTooltip>
  </div>
</section>
