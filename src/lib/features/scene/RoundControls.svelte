<script>
  /**
   * RoundControls — the round number plus a phase dropdown. The user drives both
   * manually (no auto-advance per v0.4 product decision); this is purely a tracker.
   * Round can never go below 0.
   *
   * v0.4.1 audit fix F4.1: shares the same `NumberStepper` used by every other
   * numeric field in the app so the visual rhythm is consistent (24×24 hand-rolled
   * buttons dropped in favor of the 32×32 stepper used elsewhere).
   */

  import { workspace, setSceneRound, setScenePhase } from '../../state/workspace.svelte.js'
  import { PHASES, PHASE_LABELS } from '../../domain/rules.js'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'

  const ROUND_HINT =
    "Combat rounds are walked through manually — the tracker never auto-advances. Step it forward when the table calls a new round."
  const PHASE_HINT =
    "Movement, Attack, then Status. The dropdown is just a marker for everyone at the table; nothing here checks order or gates."
</script>

<div class="px-3 py-3 flex items-center justify-between gap-3 border-b border-surface-200 flex-wrap">
  <RuleTooltip hint={ROUND_HINT} display="inline-flex">
    <div class="flex items-center gap-2">
      <span class="text-[10px] uppercase tracking-wide text-ink-500">Round</span>
      <NumberStepper
        ariaLabel="Round"
        value={workspace.scene.round}
        min={0}
        max={999}
        step={1}
        onchange={(v) => setSceneRound(v)}
      />
    </div>
  </RuleTooltip>

  <RuleTooltip hint={PHASE_HINT} display="inline-flex">
    <label class="inline-flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-500">
      Phase
      <select
        class="h-9 px-2 rounded border border-surface-300 bg-surface-50 text-sm text-ink-900 normal-case tracking-normal"
        value={workspace.scene.phase}
        onchange={(e) =>
          setScenePhase(
            /** @type {import('../../domain/types.js').Phase} */ (e.currentTarget.value),
          )}
      >
        {#each PHASES as phase (phase)}
          <option value={phase}>{PHASE_LABELS[phase]}</option>
        {/each}
      </select>
    </label>
  </RuleTooltip>
</div>
