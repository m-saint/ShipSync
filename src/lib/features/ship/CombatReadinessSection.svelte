<script>
  /**
   * CombatReadinessSection — the editor for the player ship's during-combat
   * resources: Mettle (current), Crew (current; max & skeleton tucked
   * into a collapsed config block), and Fires.
   *
   * Mutators behind these steppers (setShipMettleCurrent / setShipCrewCurrent /
   * setShipFires) coalesce per round, so a flurry of clicks on the same field
   * inside one scene round shows up as a single Captain's-Log line and a single
   * undo step. Crossing a round boundary or switching to a different stat
   * breaks the chain so the next edit reads as a fresh entry.
   *
   * Hull (HP current + max) intentionally lives in ProfileSection — it's edited
   * by the same NumberStepper there, and the four KPI tiles at the top of
   * ShipDetail give the at-a-glance view across all four readiness metrics.
   */

  import Button from '../../ui/Button.svelte'
  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import DamageComposer from './DamageComposer.svelte'
  import RepairComposer from './RepairComposer.svelte'
  import {
    setShipCrewCurrent,
    setShipCrewMax,
    setShipCrewSkeleton,
    setShipFires,
    setShipMettleCurrent,
  } from '../../state/workspace.svelte.js'
  import {
    actionsAllowedThisTurn,
    baselineMettle,
    isSkeletonStaffed,
  } from '../../domain/derivations.js'

  let { ship } = $props()

  // v0.8 — Damage / Repair composers are mutually exclusive panels in the
  // section footer. Tracking which one (if any) is open as a single string
  // keeps the toggle rules trivial: opening one closes the other; clicking
  // the same trigger twice closes the panel; the panel itself can also call
  // `onclose` after a successful commit or a cancel.
  let openComposer = $state(/** @type {'damage'|'repair'|null} */ (null))

  function openDamage() {
    openComposer = openComposer === 'damage' ? null : 'damage'
  }
  function openRepair() {
    openComposer = openComposer === 'repair' ? null : 'repair'
  }
  function closeComposer() {
    openComposer = null
  }

  let baseline = $derived(baselineMettle(ship))
  let skeleton = $derived(isSkeletonStaffed(ship))
  let actionAllowance = $derived(actionsAllowedThisTurn(ship))

  // Tone derivations — Heuristic 1 (system status): a stat at 0 (or below the
  // skeleton mark) shouldn't read the same as a healthy "0 of 50". Crimson is
  // reserved for fires escalating into "magazine in trouble" territory.
  let mettleTone = /** @type {'neutral'|'amber'} */ ($derived(
    ship.mettle.current === 0 ? 'amber' : 'neutral',
  ))
  // Empty crew is qualitatively different from "below the skeleton mark" — a
  // hull with nobody aboard is functionally derelict, so it deserves the
  // same crimson alarm tone the Fires stepper uses at the magazine-trouble
  // threshold. Keep amber for the in-between "short-handed but still
  // crewed" state.
  let crewTone = /** @type {'neutral'|'amber'|'crimson'} */ ($derived.by(() => {
    if (ship.crew.current === 0) return 'crimson'
    if (skeleton) return 'amber'
    return 'neutral'
  }))
  let firesTone = /** @type {'neutral'|'amber'|'crimson'} */ ($derived.by(() => {
    if (ship.fires >= 3) return 'crimson'
    if (ship.fires > 0) return 'amber'
    return 'neutral'
  }))

  const METTLE_HINT =
    "The captain's nerve, and the morale of the crew."
  const CREW_HINT =
    "Crew runs the stations. At or below the skeleton mark, the ship is short-staffed."
  const CREW_MAX_HINT =
    "Set during refit or recruitment, not in the middle of a fight."
  const CREW_SKELETON_HINT =
    "The threshold at or below which the ship becomes short-staffed."
  const FIRES_HINT =
    "Each fire adds to the chances of an explosion."
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">Combat Readiness</h3>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">During the fight</span>
  </header>

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <RuleTooltip hint={METTLE_HINT} display="block">
      <Field label="Mettle" helpText={`Baseline ${baseline}.`}>
        <NumberStepper
          ariaLabel={`Mettle on ${ship.name}`}
          value={ship.mettle.current}
          min={0}
          max={99}
          step={1}
          tone={mettleTone}
          onchange={(v) => setShipMettleCurrent(ship.id, v)}
        />
      </Field>
    </RuleTooltip>

    <RuleTooltip hint={CREW_HINT} display="block">
      <Field
        label="Crew"
        helpText={`Skeleton ${ship.crew.skeleton} of ${ship.crew.max} · ${actionAllowance} action${actionAllowance === 1 ? '' : 's'}/turn.`}
      >
        <NumberStepper
          ariaLabel={`Crew on ${ship.name}`}
          value={ship.crew.current}
          min={0}
          max={ship.crew.max}
          step={1}
          tone={crewTone}
          onchange={(v) => setShipCrewCurrent(ship.id, v)}
        />
      </Field>
    </RuleTooltip>

    <RuleTooltip hint={FIRES_HINT} display="block">
      <Field
        label="Fires"
        helpText={`Explosion DC ${ship.explosionDC}.`}
      >
        <NumberStepper
          ariaLabel={`Fires on ${ship.name}`}
          value={ship.fires}
          min={0}
          max={99}
          step={1}
          tone={firesTone}
          onchange={(v) => setShipFires(ship.id, v)}
        />
      </Field>
    </RuleTooltip>
  </div>

  <details class="border-t border-surface-200 pt-3 group">
    <summary class="text-sm font-medium text-ink-700 cursor-pointer list-none flex items-center gap-2">
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
        class="transition-transform group-open:rotate-90 text-ink-500"
      >
        <path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Crew configuration
      <span class="text-[10px] uppercase tracking-wide text-ink-500 font-normal">
        Refit / recruitment
      </span>
    </summary>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
      <RuleTooltip hint={CREW_MAX_HINT} display="block">
        <Field
          label="Crew max"
          helpText="Carrying a full crew grants additional benefits."
        >
          <NumberStepper
            ariaLabel="Crew max"
            value={ship.crew.max}
            min={1}
            max={999}
            step={1}
            onchange={(v) => setShipCrewMax(ship.id, v)}
          />
        </Field>
      </RuleTooltip>

      <RuleTooltip hint={CREW_SKELETON_HINT} display="block">
        <Field
          label="Skeleton mark"
          helpText="At or below this line the ship is short-staffed."
        >
          <NumberStepper
            ariaLabel="Skeleton crew mark"
            value={ship.crew.skeleton}
            min={0}
            max={ship.crew.max}
            step={1}
            onchange={(v) => setShipCrewSkeleton(ship.id, v)}
          />
        </Field>
      </RuleTooltip>
    </div>
  </details>

  <footer class="border-t border-surface-200 pt-3 flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <span class="text-[11px] text-ink-500 leading-snug">
        Whole event in one commit
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant={openComposer === 'damage' ? 'danger' : 'secondary'}
          size="sm"
          onclick={openDamage}
          aria-expanded={openComposer === 'damage'}
        >
          Take damage
        </Button>
        <Button
          variant={openComposer === 'repair' ? 'primary' : 'secondary'}
          size="sm"
          onclick={openRepair}
          aria-expanded={openComposer === 'repair'}
        >
          Repair
        </Button>
      </div>
    </div>

    {#if openComposer === 'damage'}
      <DamageComposer {ship} onclose={closeComposer} />
    {:else if openComposer === 'repair'}
      <RepairComposer {ship} onclose={closeComposer} />
    {/if}
  </footer>
</section>
