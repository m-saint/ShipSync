<script>
  /**
   * RepairComposer — inline panel for applying a hull repair plus optional
   * supply costs (Grub / Grog / Gear) in one undoable commit. Sibling to
   * DamageComposer; same two-click confirm pattern, same "build the full
   * event, commit once" philosophy.
   *
   * Hull is clamped to the ship's remaining headroom (hp.max - hp.current),
   * supply costs are clamped at the ship's current supply level. The
   * preview line below the inputs is the exact log summary that will land,
   * computed from `composeRepairSummary` so it matches the Activity Log
   * verbatim.
   *
   * A repair attempt that consumed supplies but didn't restore hull (e.g.
   * the carpenter botched it and burned through grog anyway) still commits
   * — composeRepairSummary handles the supply-only variant.
   */

  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import Button from '../../ui/Button.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import { applyRepair } from '../../state/workspace.svelte.js'
  import { composeRepairSummary } from '../../domain/derivations.js'

  let { ship, onclose } = $props()

  let hullRepaired = $state(0)
  let grubCost = $state(0)
  let grogCost = $state(0)
  let gearCost = $state(0)
  let source = $state('')
  let confirming = $state(false)

  let headroom = $derived(Math.max(0, ship.hp.max - ship.hp.current))

  let preview = $derived(
    composeRepairSummary(
      hullRepaired,
      { grub: grubCost, grog: grogCost, gear: gearCost },
      ship.name,
      source,
    ),
  )
  let hasAnyChange = $derived(preview != null)

  function reset() {
    hullRepaired = 0
    grubCost = 0
    grogCost = 0
    gearCost = 0
    source = ''
    confirming = false
  }

  function handleApply() {
    if (!hasAnyChange) return
    applyRepair(
      ship.id,
      hullRepaired,
      { grub: grubCost, grog: grogCost, gear: gearCost },
      source,
    )
    reset()
    onclose?.()
  }

  function handleCancel() {
    reset()
    onclose?.()
  }

  function startConfirm() {
    if (!hasAnyChange) return
    confirming = true
  }

  function cancelConfirm() {
    confirming = false
  }

  $effect(() => {
    if (confirming && !hasAnyChange) confirming = false
  })

  const COMPOSER_HINT =
    "Restore hull, optionally spending supplies in the same breath. Hull is capped at how much headroom the ship has; supply costs are capped at what's actually in the hold. The Source field rides into the log entry."
</script>

<div class="flex flex-col gap-3 rounded-md border border-sea-200 bg-sea-50/40 p-3">
  <header class="flex items-center justify-between gap-2">
    <h4 class="text-sm font-medium text-ink-900 flex items-center gap-2">
      Repair
      <RuleTooltip hint={COMPOSER_HINT} display="inline-flex">
        <span
          class="text-[10px] uppercase tracking-wide text-ink-400 cursor-help"
          aria-label="Repair composer note"
        >
          one commit
        </span>
      </RuleTooltip>
    </h4>
    <span class="text-[11px] text-ink-500">
      Hull {ship.hp.current}/{ship.hp.max} · Grub {ship.supplies.grub} · Grog {ship.supplies.grog} · Gear {ship.supplies.gear}
    </span>
  </header>

  <Field label="Hull restored" helpText={headroom > 0 ? `Up to +${headroom} headroom.` : 'Already at full HP.'}>
    <NumberStepper
      ariaLabel="Hull restored"
      bind:value={hullRepaired}
      min={0}
      max={headroom}
      step={1}
      tone={hullRepaired > 0 ? 'sea' : 'neutral'}
      autofocus
    />
  </Field>

  <fieldset class="flex flex-col gap-2">
    <legend class="text-[11px] uppercase tracking-wide text-ink-500">Supply costs (optional)</legend>
    <div class="grid grid-cols-3 gap-3">
      <Field label="Grub" helpText="Spent on this repair.">
        <NumberStepper
          ariaLabel="Grub spent"
          bind:value={grubCost}
          min={0}
          max={ship.supplies.grub}
          step={1}
          tone={grubCost > 0 ? 'amber' : 'neutral'}
        />
      </Field>
      <Field label="Grog" helpText="Spent on this repair.">
        <NumberStepper
          ariaLabel="Grog spent"
          bind:value={grogCost}
          min={0}
          max={ship.supplies.grog}
          step={1}
          tone={grogCost > 0 ? 'amber' : 'neutral'}
        />
      </Field>
      <Field label="Gear" helpText="Spent on this repair.">
        <NumberStepper
          ariaLabel="Gear spent"
          bind:value={gearCost}
          min={0}
          max={ship.supplies.gear}
          step={1}
          tone={gearCost > 0 ? 'amber' : 'neutral'}
        />
      </Field>
    </div>
  </fieldset>

  <Field
    label="Source"
    htmlFor={`repair-source-${ship.id}`}
    helpText="Optional. Names the repair in the log entry."
  >
    <input
      id={`repair-source-${ship.id}`}
      type="text"
      bind:value={source}
      maxlength="80"
      placeholder="e.g. shore party, carpenter's work"
      class="w-full px-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
    />
  </Field>

  <div class="rounded-md border border-surface-200 bg-surface-50/80 px-3 py-2 text-xs text-ink-700 min-h-[2rem] flex items-center">
    {#if preview}
      <span aria-live="polite">{preview}</span>
    {:else}
      <span class="text-ink-400" aria-live="polite">No repair entered yet.</span>
    {/if}
  </div>

  {#if !confirming}
    <div class="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={handleCancel}>Cancel</Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!hasAnyChange}
        onclick={startConfirm}
      >
        Apply repair
      </Button>
    </div>
  {:else}
    <div class="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={cancelConfirm}>Back</Button>
      <Button variant="primary" size="sm" onclick={handleApply}>
        Confirm: apply repair
      </Button>
    </div>
  {/if}
</div>
