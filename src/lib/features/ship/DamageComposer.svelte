<script>
  /**
   * DamageComposer — inline panel for applying a multi-resource damage event in
   * one undoable commit. Lives in the Combat Readiness footer; only visible
   * when the user has explicitly opened it from the section's [Take damage]
   * button.
   *
   * Why a composer instead of just clicking the existing steppers? At the
   * table the same combat event usually shaves multiple resources at once
   * (hull + mettle + a fire + a few crew). Each separate stepper edit creates
   * its own log line and undo step, which clutters the Activity Log and
   * makes "rewind that broadside" awkward. The composer builds up a single
   * payload, previews the resulting summary line, and commits with one click.
   *
   * Two-click confirm pattern matches ScenePanel's End-scene affordance —
   * deliberate, but not modal.
   */

  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import Button from '../../ui/Button.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import { applyCombatDamage } from '../../state/workspace.svelte.js'
  import { composeDamageSummary } from '../../domain/derivations.js'

  let { ship, onclose } = $props()

  let hull = $state(0)
  let mettle = $state(0)
  let crew = $state(0)
  let fires = $state(0)
  let source = $state('')
  let confirming = $state(false)

  let preview = $derived(
    composeDamageSummary(
      { hull, mettle, crew, fires },
      ship.name,
      source,
    ),
  )
  let hasAnyDamage = $derived(preview != null)

  function reset() {
    hull = 0
    mettle = 0
    crew = 0
    fires = 0
    source = ''
    confirming = false
  }

  function handleApply() {
    if (!hasAnyDamage) return
    applyCombatDamage(
      ship.id,
      { hull, mettle, crew, fires },
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
    if (!hasAnyDamage) return
    confirming = true
  }

  function cancelConfirm() {
    confirming = false
  }

  $effect(() => {
    if (confirming && !hasAnyDamage) confirming = false
  })

  const COMPOSER_HINT = 'Build the full hit, then commit it all at once.'
</script>

<div class="flex flex-col gap-3 rounded-md border border-crimson-200 bg-crimson-50/40 p-3">
  <header class="flex items-center justify-between gap-2">
    <h4 class="text-sm font-medium text-ink-900 flex items-center gap-2">
      Take damage
      <RuleTooltip hint={COMPOSER_HINT} display="inline-flex">
        <span
          class="text-[10px] uppercase tracking-wide text-ink-400 cursor-help"
          aria-label="Damage composer note"
        >
          one commit
        </span>
      </RuleTooltip>
    </h4>
    <span class="text-[11px] text-ink-500">
      Hull {ship.hp.current} · Mettle {ship.mettle.current} · Crew {ship.crew.current} · Fires {ship.fires}
    </span>
  </header>

  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <Field label="Hull" helpText="Damage to the ship.">
      <NumberStepper
        ariaLabel="Hull damage"
        bind:value={hull}
        min={0}
        max={ship.hp.current}
        step={1}
        tone={hull > 0 ? 'crimson' : 'neutral'}
        autofocus
      />
    </Field>
    <Field label="Mettle" helpText="Morale hit.">
      <NumberStepper
        ariaLabel="Mettle damage"
        bind:value={mettle}
        min={0}
        max={ship.mettle.current}
        step={1}
        tone={mettle > 0 ? 'amber' : 'neutral'}
      />
    </Field>
    <Field label="Crew" helpText="Casualties this hit.">
      <NumberStepper
        ariaLabel="Crew casualties"
        bind:value={crew}
        min={0}
        max={ship.crew.current}
        step={1}
        tone={crew > 0 ? 'amber' : 'neutral'}
      />
    </Field>
    <Field label="Fires" helpText="New fires igniting.">
      <NumberStepper
        ariaLabel="Fires ignited"
        bind:value={fires}
        min={0}
        max={20}
        step={1}
        tone={fires > 0 ? 'crimson' : 'neutral'}
      />
    </Field>
  </div>

  <Field
    label="Source"
    htmlFor={`damage-source-${ship.id}`}
    helpText="Optional. Names the source in the log entry."
  >
    <input
      id={`damage-source-${ship.id}`}
      type="text"
      bind:value={source}
      maxlength="80"
      placeholder="e.g. USS Enterprise broadside"
      class="w-full px-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
    />
  </Field>

  <div class="rounded-md border border-surface-200 bg-surface-50/80 px-3 py-2 text-xs text-ink-700 min-h-[2rem] flex items-center">
    {#if preview}
      <span aria-live="polite">{preview}</span>
    {:else}
      <span class="text-ink-400" aria-live="polite">No damage entered yet.</span>
    {/if}
  </div>

  {#if !confirming}
    <div class="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={handleCancel}>Cancel</Button>
      <Button
        variant="danger"
        size="sm"
        disabled={!hasAnyDamage}
        onclick={startConfirm}
      >
        Apply damage
      </Button>
    </div>
  {:else}
    <div class="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={cancelConfirm}>Back</Button>
      <Button variant="danger" size="sm" onclick={handleApply}>
        Confirm: apply damage
      </Button>
    </div>
  {/if}
</div>
