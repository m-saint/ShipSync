<script>
  /**
   * SuppliesSection — three NumberSteppers for Grub, Grog, and Gear. Each commits
   * on change and rolls into a single Captain's-Log entry. The hints are gentle
   * paraphrases of how the tracks behave between fights; no direct rule citations.
   */

  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import { setShipSupplies } from '../../state/workspace.svelte.js'
  import { supplyCapsForShip } from '../../domain/derivations.js'

  let { ship } = $props()

  // Per-ship-type caps (PDF p. 173 supplies table) when the type matches a
  // canonical entry; otherwise we fall back to size-keyed defaults so a
  // free-text "Caravel" still gets sensible cap suggestions. The cap also
  // gates the stepper, so a captain trying to over-stuff a Sloop's hold
  // gets stopped at the rulebook value instead of running up to 999.
  let caps = $derived(supplyCapsForShip(ship))

  const TRACKS = /** @type {const} */ ([
    {
      key: 'grub',
      label: 'Grub',
      hint: 'Food and water. Spent each travel leg to sustain the crew.',
      helpText: 'Start taking casualties if you run out of food.',
      // The two consumable tracks tint amber at zero per the v0.3 audit fold-in:
      // Heuristic 1 says the empty bin should announce itself rather than read
      // the same as a healthy "0 of 50".
      warnAtZero: true,
    },
    {
      key: 'grog',
      label: 'Grog',
      hint: 'Alcohol keeps spirits high.',
      helpText: 'Run dry and morale will suffer.',
      warnAtZero: true,
    },
    {
      key: 'gear',
      label: 'Gear',
      hint: 'Used for ship repairs — sails, rope, wood, and so on.',
      helpText: "You normally needn't spend gear while traveling, save for emergency repairs.",
      warnAtZero: false,
    },
  ])
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">Stores Below Decks</h3>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Supplies</span>
  </header>

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
    {#each TRACKS as track (track.key)}
      {@const value = ship.supplies[track.key]}
      {@const cap = caps[track.key]}
      {@const tone = track.warnAtZero && value === 0 ? 'amber' : 'neutral'}
      {@const capLabel = `${ship.type || ship.size} cap`}
      <RuleTooltip hint={track.hint} display="block">
        <Field label={track.label} helpText={`${track.helpText} ${capLabel}: ${cap}.`}>
          <NumberStepper
            ariaLabel={`${track.label} on ${ship.name}`}
            {value}
            min={0}
            max={cap}
            step={1}
            {tone}
            fullWidth
            onchange={(v) => setShipSupplies(ship.id, { [track.key]: v })}
          />
        </Field>
      </RuleTooltip>
    {/each}
  </div>
</section>
