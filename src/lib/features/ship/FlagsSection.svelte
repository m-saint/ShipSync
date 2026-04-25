<script>
  /**
   * FlagsSection — the editor for the per-ship flag roster and the workspace-
   * shared reputation that follows each flag id.
   *
   * Reputation is **per-flag, not per-ship** (the v0.1 product decision): when
   * Wavecutter raises The Black Spear and earns rep with it, Salt Wraith
   * inherits that same rep the moment she hoists the same colors. The mutators
   * `addShipFlag` / `setShipFlag` keep this invariant by inheriting on add and
   * propagating reputation across all workspace ships on update. Other fields
   * (name, isFalse, isPirate, art) stay per-ship — captains can fly the same
   * flag with different names or as false colors and that's a feature.
   *
   * Conflict banner: surfaces when ship files loaded from disk disagree on a
   * flag's rep (`detectFlagConflicts`). One-click "match this ship" pushes the
   * focused ship's value through to every other hull via `setShipFlag`, which
   * then propagates by the usual rules.
   */

  import Button from '../../ui/Button.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import FlagCard from './FlagCard.svelte'
  import {
    addShipFlag,
    setShipFlag,
    setShipFlagFlying,
    workspace,
  } from '../../state/workspace.svelte.js'
  import {
    detectFlagConflicts,
    normalizeReputation,
  } from '../../domain/derivations.js'
  import { REPUTATION_AXES, REPUTATION_AXIS_LABELS } from '../../domain/rules.js'

  let { ship } = $props()

  let flown = $derived(ship.flags?.flown ?? [])
  let flyingId = $derived(ship.flags?.flyingId ?? null)

  // Collapse threshold for the flag roster. The v0.5 audit flagged that a
  // privateer collecting half a dozen flags pushes this section long. We
  // keep the first N flags in the array order and tuck the rest behind a
  // disclosure — but the currently-flying flag is always promoted into the
  // visible list, even if its array position would otherwise hide it. This
  // can produce a small order gap when the flying flag lives in the tail
  // (e.g. visible=[A,B,C,E] when E is flying and D was added before it),
  // which is the intentional trade for "the colors you fly are never
  // hidden." Below the threshold, the disclosure never renders.
  const MAX_VISIBLE_FLAGS = 3

  let flagSplit = $derived.by(() => {
    if (flown.length <= MAX_VISIBLE_FLAGS) {
      return { visible: flown, collapsed: /** @type {typeof flown} */ ([]) }
    }
    /** @type {typeof flown} */
    const visible = []
    /** @type {typeof flown} */
    const collapsed = []
    for (const flag of flown) {
      if (visible.length < MAX_VISIBLE_FLAGS) {
        visible.push(flag)
      } else if (flag.id === flyingId) {
        visible.push(flag)
      } else {
        collapsed.push(flag)
      }
    }
    return { visible, collapsed }
  })

  let conflicts = $derived(detectFlagConflicts(Object.values(workspace.ships)))

  // v0.7 — remember the locker disclosure state per ship in localStorage so a
  // privateer who lives in the locker doesn't have to re-open it every visit.
  // Default is closed; opening writes a sentinel, closing clears it.
  let lockerStorageKey = $derived(`shipsync.flagsLocker.open.${ship.id}`)
  let lockerOpen = $state(false)

  $effect(() => {
    void lockerStorageKey
    if (typeof window === 'undefined') {
      lockerOpen = false
      return
    }
    try {
      lockerOpen = window.localStorage.getItem(lockerStorageKey) === '1'
    } catch {
      lockerOpen = false
    }
  })

  /** @param {boolean} next */
  function persistLockerOpen(next) {
    if (typeof window === 'undefined') return
    try {
      if (next) window.localStorage.setItem(lockerStorageKey, '1')
      else window.localStorage.removeItem(lockerStorageKey)
    } catch {
      // localStorage unavailable / quota — preference just won't persist.
    }
  }

  /** @param {Event} ev */
  function onLockerToggle(ev) {
    const target = /** @type {HTMLDetailsElement} */ (ev.currentTarget)
    lockerOpen = target.open
    persistLockerOpen(lockerOpen)
  }

  // Conflicts that involve a flag this ship flies (or knows). The banner only
  // surfaces relevant rows so a ship without flags doesn't see other ships'
  // disagreements.
  let relevantConflicts = $derived(
    conflicts.filter(
      (c) =>
        flown.some((f) => f.id === c.flagId) ||
        (ship.flags?.known ?? []).some((f) => f.id === c.flagId),
    ),
  )

  /**
   * Raise a fresh flag on this ship. The mutator falls back to "Untitled flag"
   * if the user-supplied name is blank, and inherits reputation from any other
   * workspace ship that already flies the same id.
   */
  function raiseFlag() {
    addShipFlag(ship.id, { name: 'New flag' })
  }

  function lowerColors() {
    setShipFlagFlying(ship.id, null)
  }

  /**
   * Push this ship's value for the given flag to every other ship in the
   * workspace. Implemented via setShipFlag with `reputation` set to the
   * current four-axis tally — propagation is built into the mutator.
   * @param {string} flagId
   */
  function reconcileToThisShip(flagId) {
    const here = flown.find((f) => f.id === flagId) ?? (ship.flags?.known ?? []).find((f) => f.id === flagId)
    if (!here) return
    setShipFlag(ship.id, flagId, { reputation: { ...normalizeReputation(here.reputation) } })
  }

  /**
   * Render a reputation tally compactly for the conflict banner: only show
   * non-zero axes ("Good 3 · Lawful 1") with a fallback to "—" for an empty
   * tally. Keeps the banner readable when most flags only have one or two
   * axes touched.
   * @param {import('../../domain/types.js').Reputation} rep
   */
  function formatReputation(rep) {
    const r = normalizeReputation(rep)
    const parts = []
    for (const axis of REPUTATION_AXES) {
      if (r[axis] > 0) parts.push(`${REPUTATION_AXIS_LABELS[axis]} ${r[axis]}`)
    }
    if (parts.length === 0) return '—'
    return parts.join(' · ')
  }

  const FLAG_HINT =
    "Flags collect reputation as you sail under them. Rep follows the flag — fly The Black Spear on a second hull and she gets credit too. Lower colors when you want to be unflagged."
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between gap-2 flex-wrap">
    <RuleTooltip hint={FLAG_HINT} display="inline-flex">
      <h3 class="display text-base text-ink-900 uppercase tracking-wider">Colors Aloft</h3>
    </RuleTooltip>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Reputation &amp; banners</span>
  </header>

  {#if relevantConflicts.length > 0}
    <div class="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm" role="alert">
      <div class="font-medium text-amber-900">Flag reputation differs across hulls</div>
      <ul class="mt-1 space-y-1 text-amber-900">
        {#each relevantConflicts as conflict (conflict.flagId)}
          <li class="flex flex-wrap items-center gap-2">
            <span><strong>{conflict.flagName}:</strong></span>
            <span class="text-xs text-amber-800">
              {conflict.entries
                .map((e) => `${e.shipName}: ${formatReputation(e.reputation)}`)
                .join(' · ')}
            </span>
            {#if flown.some((f) => f.id === conflict.flagId)}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => reconcileToThisShip(conflict.flagId)}
                title="Push this ship's reputation tally to every other hull flying the same flag."
              >
                Match this ship
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="mt-2 text-xs text-amber-800">
        Reputation is shared per flag, so this typically only happens after loading saves that
        weren't last edited together. Pick a value and the others come into line.
      </p>
    </div>
  {/if}

  {#if flown.length === 0}
    <div class="text-center py-6 text-ink-500 border border-dashed border-surface-300 rounded-md">
      <p class="text-sm">No colors flown.</p>
      <p class="text-xs mt-1">Raise a flag to start tracking its reputation across the fleet.</p>
    </div>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each flagSplit.visible as flag (flag.id)}
        <FlagCard {ship} {flag} isFlying={flag.id === flyingId} />
      {/each}
    </ul>

    {#if flagSplit.collapsed.length > 0}
      <details class="group" bind:open={lockerOpen} ontoggle={onLockerToggle}>
        <summary class="text-sm font-medium text-ink-700 cursor-pointer list-none flex items-center gap-2 py-1">
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            class="transition-transform group-open:rotate-90 text-ink-500"
          >
            <path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Show all flags
          <span class="text-[10px] uppercase tracking-wide text-ink-500 font-normal">
            {flagSplit.collapsed.length} more in the locker
          </span>
        </summary>
        <ul class="flex flex-col gap-3 mt-3">
          {#each flagSplit.collapsed as flag (flag.id)}
            <FlagCard {ship} {flag} isFlying={flag.id === flyingId} />
          {/each}
        </ul>
      </details>
    {/if}
  {/if}

  <div class="flex items-center gap-2 flex-wrap">
    <Button variant="primary" size="sm" onclick={raiseFlag}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6h8M6 2v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      Raise a flag
    </Button>
    {#if flyingId != null}
      <Button variant="ghost" size="sm" onclick={lowerColors} title="Stop flying this flag — it stays in the locker. Hoist any flag to fly again.">
        Lower colors
      </Button>
    {/if}
  </div>
</section>
