<script>
  /**
   * SceneShipCard — a sketch-board entry for a non-player ship in the current
   * scene. Designed tight: a single column of compact rows so a 320-pixel right
   * column can hold a few cards without scrolling sideways. Everything edits
   * inline (no modal); name uses a writable $derived draft so blank/whitespace
   * input snaps back to the canonical name on blur.
   */

  import { setSceneShip, removeSceneShip } from '../../state/workspace.svelte.js'
  import {
    SHIP_SIZES,
    SHIP_SIZE_LABELS,
    MOBILITY_OPTIONS,
    MOBILITY_LABELS,
    DISPOSITIONS,
    DISPOSITION_LABELS,
  } from '../../domain/rules.js'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'

  let { sceneShip } = $props()

  let nameDraft = $derived(sceneShip.name)
  let threatDraft = $derived(sceneShip.threat)

  function commitName() {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== sceneShip.name) {
      setSceneShip(sceneShip.id, { name: trimmed })
    }
    nameDraft = sceneShip.name
  }

  function commitThreat() {
    if (threatDraft !== sceneShip.threat) {
      setSceneShip(sceneShip.id, { threat: threatDraft })
    }
  }

  /**
   * Disposition tones — tinting for the closed select (the OS native popup
   * doesn't pick this up but the closed trigger does).
   * @type {Record<import('../../domain/types.js').Disposition, string>}
   */
  const DISPOSITION_TONES = {
    hostile: 'text-crimson-700',
    neutral: 'text-ink-700',
    allied: 'text-sea-500',
    unknown: 'text-ink-500',
  }

  let dispoTone = $derived(DISPOSITION_TONES[sceneShip.disposition] ?? 'text-ink-700')

  const FIRES_HINT =
    "Fires sparked from cannon hits. Each fire raises the bar for an explosion check at the end of the round."
</script>

<article class="surface-card p-3 flex flex-col gap-2 text-sm">
  <header class="flex items-center gap-2">
    <input
      type="text"
      class="flex-1 min-w-0 h-8 px-2 rounded border border-surface-300 bg-surface-50 text-sm font-medium text-ink-900"
      bind:value={nameDraft}
      onblur={commitName}
      maxlength="80"
      aria-label="Scene ship name"
    />
    <button
      type="button"
      class="text-xs text-ink-500 hover:text-crimson-700 px-1.5 h-7 rounded hover:bg-crimson-50"
      onclick={() => removeSceneShip(sceneShip.id)}
      title="Drop this ship from the scene."
      aria-label={`Remove ${sceneShip.name} from the scene`}
    >
      Remove
    </button>
  </header>

  <div class="grid grid-cols-3 gap-2 text-xs">
    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-ink-500">Size</span>
      <select
        class="h-7 px-1.5 rounded border border-surface-300 bg-surface-50"
        value={sceneShip.size}
        onchange={(e) =>
          setSceneShip(sceneShip.id, {
            size: /** @type {import('../../domain/types.js').ShipSize} */ (e.currentTarget.value),
          })}
      >
        {#each SHIP_SIZES as size (size)}
          <option value={size}>{SHIP_SIZE_LABELS[size]}</option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-ink-500">Mobility</span>
      <select
        class="h-7 px-1.5 rounded border border-surface-300 bg-surface-50"
        value={sceneShip.mobility}
        onchange={(e) =>
          setSceneShip(sceneShip.id, {
            mobility: /** @type {import('../../domain/types.js').Mobility} */ (
              e.currentTarget.value
            ),
          })}
      >
        {#each MOBILITY_OPTIONS as opt (opt)}
          <option value={opt}>{MOBILITY_LABELS[opt]}</option>
        {/each}
      </select>
    </label>

    <label class="flex flex-col gap-1">
      <span class="text-[10px] uppercase tracking-wide text-ink-500">Stance</span>
      <select
        class={`h-7 px-1.5 rounded border border-surface-300 bg-surface-50 ${dispoTone}`}
        value={sceneShip.disposition}
        onchange={(e) =>
          setSceneShip(sceneShip.id, {
            disposition: /** @type {import('../../domain/types.js').Disposition} */ (
              e.currentTarget.value
            ),
          })}
      >
        {#each DISPOSITIONS as opt (opt)}
          <option value={opt}>{DISPOSITION_LABELS[opt]}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="flex items-center justify-between gap-2 text-xs">
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Hull</span>
    <div class="flex items-center gap-1">
      <NumberStepper
        ariaLabel={`${sceneShip.name} current hull`}
        value={sceneShip.hp.current}
        min={0}
        max={sceneShip.hp.max}
        step={1}
        onchange={(v) => setSceneShip(sceneShip.id, { hp: { current: v } })}
      />
      <span class="text-ink-500 px-1">/</span>
      <NumberStepper
        ariaLabel={`${sceneShip.name} max hull`}
        value={sceneShip.hp.max}
        min={1}
        max={9999}
        step={5}
        onchange={(v) => setSceneShip(sceneShip.id, { hp: { max: v } })}
      />
    </div>
  </div>

  <div class="flex items-center justify-between gap-2 text-xs">
    <RuleTooltip hint={FIRES_HINT} display="inline-flex">
      <span class="text-[10px] uppercase tracking-wide text-ink-500">Fires</span>
    </RuleTooltip>
    <NumberStepper
      ariaLabel={`${sceneShip.name} fires`}
      value={sceneShip.fires}
      min={0}
      max={99}
      step={1}
      onchange={(v) => setSceneShip(sceneShip.id, { fires: v })}
    />
  </div>

  <div class="flex items-center justify-between gap-2 text-xs">
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Explosion DC</span>
    <NumberStepper
      ariaLabel={`${sceneShip.name} explosion DC`}
      value={sceneShip.explosionDC}
      min={1}
      max={40}
      step={1}
      onchange={(v) => setSceneShip(sceneShip.id, { explosionDC: v })}
    />
  </div>

  <label class="flex flex-col gap-1 text-xs">
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Threat note</span>
    <textarea
      rows="2"
      class="px-2 py-1 rounded border border-surface-300 bg-surface-50 text-xs resize-y"
      bind:value={threatDraft}
      onblur={commitThreat}
      maxlength="200"
      placeholder="mortars at close range; carries marines"
      aria-label={`Threat note for ${sceneShip.name}`}
    ></textarea>
  </label>
</article>
