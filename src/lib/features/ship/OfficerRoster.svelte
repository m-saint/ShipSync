<script>
  /**
   * OfficerRoster — the ten officer stations on a ship. The bridge is split
   * into the rulebook's two tiers (PDF p. 198):
   *
   *   1. Captain — full-width because their rank feeds the Mettle baseline.
   *   2. Key Officers (First Mate, Navigator, Helmsperson, Master Gunner) —
   *      named on p. 198 as the four stations whose rank bonuses and
   *      casualty handling matter most during a fight.
   *   3. Secondary stations — Quartermaster, Boatswain, Cook, Shipwright,
   *      Surgeon — round out the bridge but don't fight the ship directly.
   *
   * Each station reuses the existing OfficerCard so name/rank/status/portrait
   * editing is identical everywhere. The roster is a flat container —
   * OfficerCard already wraps itself in a surface-card, so we don't
   * double-nest cards.
   *
   * v0.4 fold-in: the secondary stations grid can be collapsed to keep the
   * detail surface scannable when the player is mid-fight and the bridge
   * officers are the only ones that matter. Default is expanded; the choice
   * is remembered per ship in localStorage so a ship that's been collapsed
   * once stays collapsed when the user comes back to it.
   */

  import OfficerCard from './OfficerCard.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import { KEY_STATIONS, SECONDARY_STATIONS, STATIONS } from '../../domain/rules.js'
  import { officerCasualtyTally } from '../../domain/derivations.js'

  let { ship } = $props()

  // Captain is the lead Key Officer and gets her own slot above the grid;
  // the four remaining Key Officers form the next tier.
  const KEY_BRIDGE_STATIONS = /** @type {import('../../domain/types.js').StationKey[]} */ (
    KEY_STATIONS.filter((s) => s !== 'captain')
  )

  let tally = $derived(officerCasualtyTally(ship))

  // Casualty pill copy is built only from the non-zero buckets so a clean
  // bridge stays uncluttered. Tone escalates: any dead officer paints
  // crimson; otherwise any stricken officer paints amber.
  let casualtyParts = $derived.by(() => {
    /** @type {string[]} */
    const parts = []
    if (tally.stricken > 0) parts.push(`${tally.stricken} stricken`)
    if (tally.dead > 0) parts.push(`${tally.dead} dead`)
    return parts
  })
  let hasCasualties = $derived(casualtyParts.length > 0)
  let casualtyTone = $derived(tally.dead > 0 ? 'crimson' : 'amber')

  let storageKey = $derived(`shipsync.officerRoster.collapsed.${ship.id}`)

  // Local UI preference — not domain state and never goes through commit().
  // Reads on first render for this ship (and again whenever the ship swaps);
  // writes back when the user toggles.
  let collapsed = $state(false)

  $effect(() => {
    void storageKey
    if (typeof window === 'undefined') {
      collapsed = false
      return
    }
    try {
      collapsed = window.localStorage.getItem(storageKey) === '1'
    } catch {
      collapsed = false
    }
  })

  function toggleCollapsed() {
    collapsed = !collapsed
    if (typeof window === 'undefined') return
    try {
      if (collapsed) window.localStorage.setItem(storageKey, '1')
      else window.localStorage.removeItem(storageKey)
    } catch {
      // localStorage unavailable / quota — preference just won't persist.
    }
  }

  const COUNT_HINT =
    "Filled and active stations only. Empty posts and stricken or dead officers don't count toward the bridge running clean."
  const CASUALTY_HINT =
    'Officers currently down or lost. Tone is amber while anyone is wounded; goes crimson the moment a station has a death recorded.'
  let toggleHint = $derived(
    collapsed
      ? 'Show the secondary stations (Quartermaster, Boatswain, Cook, Shipwright, Surgeon).'
      : 'Hide the secondary stations to keep the detail surface compact.',
  )
  let toggleLabel = $derived(collapsed ? 'Show all stations' : 'Key officers only')

  const KEY_HINT =
    "Captain plus the four other Key Officers (First Mate, Navigator, Helmsperson, Master Gunner). Their ranks bonus the actions you take most in a fight, and they're the ones the rulebook checks first when it's casualty time."
  const SECONDARY_HINT =
    "Quartermaster, Boatswain, Cook, Shipwright, Surgeon — the rest of the bridge. They keep the ship running between fights and round out the supply, repair, and morale duties."
</script>

<section class="flex flex-col gap-3" aria-label="Officer roster">
  <header class="flex items-center justify-between px-1 gap-3 flex-wrap">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">Bridge Crew</h3>
    <div class="flex items-center gap-3 flex-wrap">
      <RuleTooltip hint={COUNT_HINT}>
        <span class="text-[10px] uppercase tracking-wide text-ink-500">
          {tally.active} of {STATIONS.length} on station
        </span>
      </RuleTooltip>
      {#if hasCasualties}
        <RuleTooltip hint={CASUALTY_HINT}>
          <span
            class={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-mono ${
              casualtyTone === 'crimson'
                ? 'bg-crimson-50 text-crimson-700 border border-crimson-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'
            }`}
            aria-live="polite"
          >
            {casualtyParts.join(' · ')}
          </span>
        </RuleTooltip>
      {/if}
      <button
        type="button"
        class="text-xs text-ink-700 hover:text-brass-600 inline-flex items-center gap-1"
        onclick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls={`officer-secondary-${ship.id}`}
        title={toggleHint}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          class={`transition-transform duration-100 ${collapsed ? '-rotate-90' : ''}`}
        >
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {toggleLabel}
      </button>
    </div>
  </header>

  <OfficerCard {ship} station="captain" />

  <div class="flex items-center gap-2 px-1 mt-1">
    <RuleTooltip hint={KEY_HINT}>
      <span class="display text-[11px] text-ink-500 uppercase tracking-wider">Key Officers</span>
    </RuleTooltip>
    <span class="flex-1 h-px bg-surface-200" aria-hidden="true"></span>
  </div>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
    {#each KEY_BRIDGE_STATIONS as station (station)}
      <OfficerCard {ship} {station} />
    {/each}
  </div>

  {#if !collapsed}
    <div class="flex items-center gap-2 px-1 mt-1">
      <RuleTooltip hint={SECONDARY_HINT}>
        <span class="display text-[11px] text-ink-500 uppercase tracking-wider">Secondary Stations</span>
      </RuleTooltip>
      <span class="flex-1 h-px bg-surface-200" aria-hidden="true"></span>
    </div>
    <div
      id={`officer-secondary-${ship.id}`}
      class="grid grid-cols-1 lg:grid-cols-2 gap-3"
    >
      {#each SECONDARY_STATIONS as station (station)}
        <OfficerCard {ship} {station} />
      {/each}
    </div>
  {/if}
</section>
