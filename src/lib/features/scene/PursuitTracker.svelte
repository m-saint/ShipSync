<script>
  /**
   * PursuitTracker — the lite version of §7. When idle, shows a single "Begin
   * pursuit" button that opens the tracker; once active, surfaces pursuer /
   * quarry pickers, a Gap stepper, and a free-text escape condition. No die-typed
   * timer (per v0.4 product decision), so the player can write whatever shape of
   * escape window the table is using ("reach Port Skerry", "the storm hits", etc.).
   *
   * Gap colors:
   *   - 0  → caught, crimson tint
   *   - 1–3 → close, amber
   *   - 4–9 → middle, neutral
   *   - 10+ → escaped, sea/blue
   */

  import {
    workspace,
    togglePursuit,
    setPursuit,
  } from '../../state/workspace.svelte.js'
  import { allShipsForReference } from '../../domain/derivations.js'
  import Button from '../../ui/Button.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'

  let pursuit = $derived(workspace.scene.pursuit)
  let candidates = $derived(allShipsForReference(workspace))

  const NULL_VALUE = '__none'

  let pursuerSelect = $derived(pursuit?.pursuerId ?? NULL_VALUE)
  let quarrySelect = $derived(pursuit?.quarryId ?? NULL_VALUE)
  let escapeDraft = $derived(pursuit?.escapeCondition ?? '')

  // Gap status colors mirror the §7 milestones (0 = caught, 10+ = escaped).
  // The stepper itself picks up the same tone so the visual signal isn't
  // hiding in the helper text alone (v0.4.1 audit fix F1.2).
  let gapTextTone = $derived.by(() => {
    if (!pursuit) return 'text-ink-700'
    if (pursuit.gap <= 0) return 'text-crimson-700 font-semibold'
    if (pursuit.gap <= 3) return 'text-amber-700 font-semibold'
    if (pursuit.gap >= 10) return 'text-sea-500 font-semibold'
    return 'text-ink-700'
  })

  /** @type {'neutral'|'amber'|'crimson'|'sea'} */
  let gapStepperTone = $derived.by(() => {
    if (!pursuit) return 'neutral'
    if (pursuit.gap <= 0) return 'crimson'
    if (pursuit.gap <= 3) return 'amber'
    if (pursuit.gap >= 10) return 'sea'
    return 'neutral'
  })

  let gapHint = $derived.by(() => {
    if (!pursuit) return ''
    if (pursuit.gap <= 0) return 'Caught — the chase becomes a fight.'
    if (pursuit.gap >= 10) return 'Escaped — the quarry slips clear.'
    return ''
  })

  const PURSUIT_HINT =
    "A lightweight chase tracker — Gap is squares of space between pursuer and quarry. 0 means caught and the fight starts; 10+ means the quarry slips away. Speed differences each round move the Gap."
  const TIMER_HINT =
    "Rounds of free running before the chase resolves on its own (PDF p. 181). The default is 6; the GM can shorten or lengthen it based on how close the quarry is to safe haven. Tick it down each round."
  const ESCAPE_HINT =
    "Free-text reminder of the escape window: a port to reach, a storm closing in, a portal opening. Whatever resolves the chase besides catching up."

  function onPursuerChange(event) {
    const value = event.currentTarget.value
    setPursuit({ pursuerId: value === NULL_VALUE ? null : value })
  }
  function onQuarryChange(event) {
    const value = event.currentTarget.value
    setPursuit({ quarryId: value === NULL_VALUE ? null : value })
  }

  function commitEscape() {
    if (!pursuit) return
    if (escapeDraft !== pursuit.escapeCondition) {
      setPursuit({ escapeCondition: escapeDraft })
    }
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3 border-b border-surface-200">
  <header class="flex items-center justify-between">
    <RuleTooltip hint={PURSUIT_HINT} display="inline-flex">
      <h3 class="text-[10px] uppercase tracking-wide text-ink-500">Pursuit</h3>
    </RuleTooltip>
    {#if pursuit}
      <button
        type="button"
        class="text-xs text-ink-500 hover:text-crimson-700"
        onclick={() => togglePursuit(false)}
        title="Close the pursuit tracker. The Gap and escape condition will be cleared."
      >
        End pursuit
      </button>
    {/if}
  </header>

  {#if !pursuit}
    <p class="text-xs text-ink-500">No chase underway.</p>
    <Button variant="secondary" size="sm" fullWidth onclick={() => togglePursuit(true)}>
      Begin pursuit
    </Button>
  {:else}
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-ink-500">Pursuer</span>
        <select
          class="h-8 px-2 rounded border border-surface-300 bg-surface-50 text-xs text-ink-900"
          value={pursuerSelect}
          onchange={onPursuerChange}
          aria-label="Pursuer"
        >
          <option value={NULL_VALUE}>(unassigned)</option>
          {#each candidates as ship (ship.id)}
            <option value={ship.id}>
              {ship.kind === 'scene' ? `${ship.name} (scene)` : ship.name}
            </option>
          {/each}
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-ink-500">Quarry</span>
        <select
          class="h-8 px-2 rounded border border-surface-300 bg-surface-50 text-xs text-ink-900"
          value={quarrySelect}
          onchange={onQuarryChange}
          aria-label="Quarry"
        >
          <option value={NULL_VALUE}>(unassigned)</option>
          {#each candidates as ship (ship.id)}
            <option value={ship.id}>
              {ship.kind === 'scene' ? `${ship.name} (scene)` : ship.name}
            </option>
          {/each}
        </select>
      </label>
    </div>

    <div class="flex items-center justify-between gap-3">
      <span class="text-[10px] uppercase tracking-wide text-ink-500">Gap</span>
      <div class="flex items-center gap-2">
        <NumberStepper
          ariaLabel="Gap"
          value={pursuit.gap}
          min={0}
          max={99}
          step={1}
          tone={gapStepperTone}
          onchange={(v) => setPursuit({ gap: v })}
        />
        <span class={`text-xs ${gapTextTone}`} aria-live="polite">{gapHint}</span>
      </div>
    </div>

    <RuleTooltip hint={TIMER_HINT} display="block">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[10px] uppercase tracking-wide text-ink-500">Escape timer</span>
        <div class="flex items-center gap-2">
          <NumberStepper
            ariaLabel="Escape timer (rounds)"
            value={pursuit.escapeTimer ?? 6}
            min={0}
            max={20}
            step={1}
            onchange={(v) => setPursuit({ escapeTimer: v })}
          />
          <span class="text-xs text-ink-500">rounds</span>
        </div>
      </div>
    </RuleTooltip>

    <RuleTooltip hint={ESCAPE_HINT} display="block">
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-ink-500">Escape condition</span>
        <input
          type="text"
          class="h-8 px-2 rounded border border-surface-300 bg-surface-50 text-xs text-ink-900"
          bind:value={escapeDraft}
          onblur={commitEscape}
          maxlength="120"
          placeholder="reach Port Skerry"
          aria-label="Escape condition"
        />
      </label>
    </RuleTooltip>
  {/if}
</div>
