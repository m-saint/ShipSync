<script>
  /**
   * ScenePanel — the right-rail "current scene" surface.
   *
   * v0.3 was a small dev stub showing phase / round / wind. v0.4 fleshes it
   * out into a player-facing tracker:
   *
   *   - RoundControls     — round counter (manual ± stepper) + phase dropdown.
   *   - WeatherGageControl — wind direction + who currently holds the gage.
   *   - PursuitTracker    — Gap counter + escape condition (collapsed by default).
   *   - SceneShipsList    — ephemeral non-player ships sighted in this scene.
   *
   * No section auto-resets between rounds: every value is user-driven, mirroring
   * how the rest of the app already treats ship state (per the v0.4 product
   * decision "never auto-reset — user manages it manually").
   *
   * v0.7 adds an "End scene" footer affordance for the explicit reset path —
   * clears all scene state plus boardedBy on every player ship in one undoable
   * commit. Two-click confirm (button → "Confirm" inline) keeps the action
   * deliberate without a modal interruption.
   *
   * Layout: the panel claims a flex-1 chunk of the right rail and scrolls
   * internally so the Activity Log below stays anchored even when the scene
   * gets crowded with sighted vessels.
   */

  import RoundControls from './RoundControls.svelte'
  import WeatherGageControl from './WeatherGageControl.svelte'
  import SceneShipsList from './SceneShipsList.svelte'
  import PursuitTracker from './PursuitTracker.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import Button from '../../ui/Button.svelte'
  import { endScene, workspace } from '../../state/workspace.svelte.js'

  /**
   * @type {{
   *   oncollapse?: () => void,
   * }}
   */
  let { oncollapse = undefined } = $props()

  const PERSISTENCE_HINT =
    "Scene state — round, phase, wind, weather gage, pursuit, sighted ships — does not persist across save files."

  const END_SCENE_HINT =
    "Reset round, phase, wind, weather gage, pursuit, sighted ships, scene-only conditions, and any boarding pointers on your ships."

  // Surface a count of what will be cleared so the player can see what they're
  // committing to before they tap Confirm. Uses the live workspace state.
  let sceneShipCount = $derived(Object.keys(workspace.scene.sceneShips).length)
  let sceneConditionCount = $derived(
    Object.values(workspace.scene.shipConditions).reduce(
      (acc, list) => acc + (list?.length ?? 0),
      0,
    ),
  )
  let boardingCount = $derived(
    workspace.shipOrder.reduce((acc, id) => acc + (workspace.ships[id]?.boardedBy ? 1 : 0), 0),
  )
  let canEndScene = $derived(
    workspace.scene.round > 0 ||
      workspace.scene.phase !== 'idle' ||
      workspace.scene.windDirection !== 'N' ||
      workspace.scene.weatherGageHolderId != null ||
      workspace.scene.pursuit != null ||
      sceneShipCount > 0 ||
      sceneConditionCount > 0 ||
      boardingCount > 0,
  )

  let confirming = $state(false)

  function startConfirm() {
    if (!canEndScene) return
    confirming = true
  }

  function cancelConfirm() {
    confirming = false
  }

  function commitEndScene() {
    endScene()
    confirming = false
  }

  // Auto-cancel the inline confirm if the underlying state was already cleared
  // (e.g. via undo) while the confirm UI was open.
  $effect(() => {
    if (confirming && !canEndScene) confirming = false
  })
</script>

<section class="flex-1 min-h-0 flex flex-col border-b border-surface-200" aria-label="Current scene">
  <header class="px-3 py-2.5 border-b border-surface-200 bg-surface-100 shrink-0">
    <div class="flex items-center justify-between gap-2">
      <h2 class="display text-sm uppercase tracking-wider text-ink-500">Scene</h2>
      <div class="flex items-center gap-2">
        <RuleTooltip hint={PERSISTENCE_HINT} display="inline-flex">
          <span
            class="text-[10px] uppercase tracking-wide text-ink-400 cursor-help"
            aria-label="Scene state persistence note"
          >
            autosave only
          </span>
        </RuleTooltip>
        {#if oncollapse}
          <button
            type="button"
            class="w-6 h-6 flex items-center justify-center rounded text-ink-500 hover:bg-surface-100 hover:text-ink-800"
            onclick={oncollapse}
            aria-label="Collapse scene & log rail"
            aria-expanded="true"
            title="Collapse scene & log"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        {/if}
      </div>
    </div>
  </header>

  <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">
    <RoundControls />
    <WeatherGageControl />
    <PursuitTracker />
    <SceneShipsList />

    <footer class="px-3 py-3 border-t border-surface-200 bg-surface-50/40 flex flex-col gap-2 shrink-0">
      {#if !confirming}
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-[11px] text-ink-500 leading-snug">
            Done with the fight? End the scene to clear the round, sighted ships, and any boarding pointers.
          </span>
          <RuleTooltip hint={END_SCENE_HINT} display="inline-flex">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canEndScene}
              onclick={startConfirm}
            >
              End scene
            </Button>
          </RuleTooltip>
        </div>
      {:else}
        <div class="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/70 p-2.5">
          <p class="text-xs text-ink-800 leading-snug">
            Resetting:
            round
            <span class="font-mono">{workspace.scene.round}</span>
            → 0, phase to idle, wind to N{workspace.scene.weatherGageHolderId != null
              ? ', weather gage cleared'
              : ''}{workspace.scene.pursuit != null ? ', pursuit broken off' : ''}{sceneShipCount > 0
              ? `, ${sceneShipCount} sighted ship${sceneShipCount === 1 ? '' : 's'} dismissed`
              : ''}{sceneConditionCount > 0 ? `, ${sceneConditionCount} scene condition${sceneConditionCount === 1 ? '' : 's'} cleared` : ''}{boardingCount > 0
              ? `, boarding cleared on ${boardingCount} ship${boardingCount === 1 ? '' : 's'}`
              : ''}.
          </p>
          <p class="text-[11px] text-ink-600">
            Persistent ship state (HP, crew, fires, supplies, conditions, journal) stays.
            Undo restores everything in one click.
          </p>
          <div class="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onclick={cancelConfirm}>Cancel</Button>
            <Button variant="primary" size="sm" onclick={commitEndScene}>
              Confirm: end scene
            </Button>
          </div>
        </div>
      {/if}
    </footer>
  </div>
</section>
