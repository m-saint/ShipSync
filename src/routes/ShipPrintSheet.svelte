<script>
  /**
   * ShipPrintSheet — pure rendering body for one ship's print sheet.
   *
   * Extracted from PrintView (v0.7) so the same layout can be used by both:
   *   - PrintView (?print=<shipId>): a single sheet, one print job.
   *   - FleetPrintView (?print=fleet, v0.8): one sheet per loaded ship,
   *     joined by `break-after: page` so the user can print the whole fleet
   *     with a single Cmd+P.
   *
   * The component is read-only and stateless: it takes the ship to render
   * plus the image dictionary it needs to resolve portrait / flag art ids
   * into data URLs. It deliberately does NOT touch the workspace store —
   * keeping it pure means the fleet view can render N ships side by side
   * without any reactive surprises, and a future "preview a saved file"
   * use case can drop in without changes.
   *
   * Bug fix moved over from PrintView: officerCasualtyTally takes the full
   * ship object, not just ship.officers. The previous call site silently
   * returned an all-zero tally, which made the sheet under-report bridge
   * losses.
   */

  import {
    baselineMettle,
    damageThresholdFor,
    actionsAllowedThisTurn,
    flagTotalReputation,
    isSkeletonStaffed,
    officerCasualtyTally,
  } from '../lib/domain/derivations.js'
  import {
    SHIP_SIZE_LABELS,
    MOBILITY_LABELS,
    STATIONS,
    STATION_LABELS,
    PERSISTENT_CONDITION_LABELS,
  } from '../lib/domain/rules.js'

  /**
   * @type {{
   *   ship: import('../lib/domain/types.js').Ship,
   *   images: Record<string, string>,
   * }}
   */
  let { ship, images } = $props()

  let portraitDataUrl = $derived(
    ship?.portraitImageId ? images[ship.portraitImageId] ?? null : null,
  )

  let baseline = $derived(baselineMettle(ship))
  let threshold = $derived(damageThresholdFor(ship.size))
  let actionAllowance = $derived(actionsAllowedThisTurn(ship))
  let skeleton = $derived(isSkeletonStaffed(ship))
  let casualties = $derived(officerCasualtyTally(ship))

  let activeFlag = $derived(
    ship?.flags?.flyingId
      ? ship.flags.flown.find((f) => f.id === ship.flags.flyingId) ?? null
      : null,
  )

  function statusLabel(status) {
    if (status === 'stricken') return 'Stricken'
    if (status === 'dead') return 'Dead'
    return 'Active'
  }

  function flagArtUrl(flag) {
    return flag?.artImageId ? images[flag.artImageId] ?? null : null
  }
</script>

<article class="ship-print-sheet flex flex-col gap-6">
  <header class="flex items-start gap-4 pb-4 border-b-2 border-ink-900">
    {#if portraitDataUrl}
      <img
        src={portraitDataUrl}
        alt={`${ship.name} portrait`}
        class="w-24 h-24 rounded-md object-cover border border-surface-300 shrink-0"
      />
    {/if}
    <div class="min-w-0 flex-1">
      <h1 class="display text-4xl text-ink-900 leading-tight break-words">{ship.name}</h1>
      <p class="text-base text-ink-700 mt-1 break-words">
        {ship.type || 'Unknown type'}
        · {SHIP_SIZE_LABELS[ship.size] ?? ship.size}
        · {MOBILITY_LABELS[ship.mobility] ?? ship.mobility} mobility
      </p>
      {#if ship.officers.captain.name}
        <p class="text-sm text-brass-700 mt-1 break-words">
          Captained by <span class="font-medium">{ship.officers.captain.name}</span>
        </p>
      {/if}
      {#if activeFlag}
        <p class="text-sm text-ink-700 mt-1 break-words">
          Colors: <span class="font-medium">{activeFlag.name}</span>
          {#if activeFlag.isFalse}
            <span class="text-xs italic text-ink-500">(false flag)</span>
          {/if}
          {#if activeFlag.isPirate}
            <span class="text-xs italic text-crimson-700">(pirate)</span>
          {/if}
          {#if activeFlag.isFaction}
            <span class="text-xs italic text-sea-700">(faction)</span>
          {:else}
            · rep {flagTotalReputation(activeFlag)}
          {/if}
        </p>
      {/if}
    </div>
  </header>

  <section class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div class="border border-ink-300 rounded-md p-3">
      <div class="text-xs uppercase tracking-wide text-ink-500">Hull</div>
      <div class="text-2xl font-semibold mt-0.5">
        {ship.hp.current}<span class="text-base text-ink-500">/{ship.hp.max}</span>
      </div>
      <div class="text-xs text-ink-500">Threshold {threshold}</div>
    </div>
    <div class="border border-ink-300 rounded-md p-3">
      <div class="text-xs uppercase tracking-wide text-ink-500">Mettle</div>
      <div class="text-2xl font-semibold mt-0.5">{ship.mettle.current}</div>
      <div class="text-xs text-ink-500">Baseline {baseline}</div>
    </div>
    <div class="border border-ink-300 rounded-md p-3">
      <div class="text-xs uppercase tracking-wide text-ink-500">Crew</div>
      <div class="text-2xl font-semibold mt-0.5">
        {ship.crew.current}<span class="text-base text-ink-500">/{ship.crew.max}</span>
      </div>
      <div class={`text-xs ${skeleton ? 'text-amber-700 font-medium' : 'text-ink-500'}`}>
        Skeleton {ship.crew.skeleton} · {actionAllowance}/turn
      </div>
    </div>
    <div class="border border-ink-300 rounded-md p-3">
      <div class="text-xs uppercase tracking-wide text-ink-500">Explosion DC</div>
      <div class="text-2xl font-semibold mt-0.5">{ship.explosionDC}</div>
      <div class="text-xs text-ink-500">{ship.fires} fire{ship.fires === 1 ? '' : 's'}</div>
    </div>
  </section>

  {#if ship.boardedBy}
    <section class="border border-amber-400 bg-amber-50 rounded-md p-3 text-sm text-amber-900">
      ⚓ Currently boarded by <span class="font-medium">{ship.boardedBy}</span>
    </section>
  {/if}

  {#if (ship.conditions ?? []).length > 0}
    <section>
      <h2 class="display text-base uppercase tracking-wider text-ink-500 border-b border-ink-300 pb-1 mb-2">
        Conditions
      </h2>
      <ul class="flex flex-wrap gap-2">
        {#each ship.conditions as cond (cond)}
          <li class="px-2.5 py-0.5 border border-ink-300 rounded-full text-sm">
            {PERSISTENT_CONDITION_LABELS[cond] ?? cond}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section>
    <h2 class="display text-base uppercase tracking-wider text-ink-500 border-b border-ink-300 pb-1 mb-2">
      Particulars
    </h2>
    <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
      <div>
        <dt class="text-xs uppercase tracking-wide text-ink-500">Speed</dt>
        <dd>{ship.speed.knots} knots · {ship.speed.squares} sq/round</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-ink-500">Heavy weapons</dt>
        <dd>{ship.weapons?.heavyEligible ? 'Eligible' : 'Not eligible'}</dd>
      </div>
    </dl>
    {#if ship.weapons}
      <div class="mt-3">
        <div class="text-xs uppercase tracking-wide text-ink-500 mb-1">Weapon mounts</div>
        <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {#each [{ key: 'bow', label: 'Bow' }, { key: 'port', label: 'Port' }, { key: 'starboard', label: 'Starboard' }, { key: 'stern', label: 'Stern' }] as side (side.key)}
            {@const mounts = ship.weaponInventory?.[side.key] ?? []}
            <li class="border border-ink-300 rounded px-2 py-1.5 break-inside-avoid">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-xs uppercase tracking-wide text-ink-500">{side.label}</span>
                <span class="text-xs text-ink-500">
                  <span class="font-mono">{ship.weapons[side.key]}</span> slot{ship.weapons[side.key] === 1 ? '' : 's'}
                </span>
              </div>
              {#if mounts.length > 0}
                <ul class="mt-1 text-xs leading-snug">
                  {#each mounts as mount (mount.id)}
                    <li class="flex items-baseline justify-between gap-2 break-words">
                      <span>{mount.name?.trim() ? mount.name : '— unnamed —'}</span>
                      {#if mount.slotsOccupied > 1}
                        <span class="text-ink-500 shrink-0">×{mount.slotsOccupied}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {:else if ship.weapons[side.key] > 0}
                <p class="mt-1 text-xs text-ink-500 italic">
                  {ship.weapons[side.key]} unassigned slot{ship.weapons[side.key] === 1 ? '' : 's'}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  <section>
    <h2 class="display text-base uppercase tracking-wider text-ink-500 border-b border-ink-300 pb-1 mb-2">
      Bridge Crew
    </h2>
    <p class="text-xs text-ink-500 mb-2">
      {casualties.active} active · {casualties.stricken} stricken · {casualties.dead} dead
    </p>
    <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {#each STATIONS as station (station)}
        {@const officer = ship.officers[station]}
        <li class="break-inside-avoid">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs uppercase tracking-wide text-ink-500">
              {STATION_LABELS[station]}
            </span>
            <span
              class={`text-[10px] uppercase tracking-wide ${
                officer.status === 'dead'
                  ? 'text-crimson-700'
                  : officer.status === 'stricken'
                    ? 'text-amber-700'
                    : 'text-ink-500'
              }`}
            >
              {statusLabel(officer.status)} · rank {officer.rank}
            </span>
          </div>
          <div class="font-medium">{officer.name || '—'}</div>
          {#if officer.notes}
            <div class="text-xs text-ink-700 mt-0.5 italic break-words leading-snug">
              {officer.notes}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <h2 class="display text-base uppercase tracking-wider text-ink-500 border-b border-ink-300 pb-1 mb-2">
      Supplies
    </h2>
    <ul class="flex gap-6 text-sm">
      <li><span class="text-xs uppercase tracking-wide text-ink-500 mr-1">Grub</span>{ship.supplies.grub}</li>
      <li><span class="text-xs uppercase tracking-wide text-ink-500 mr-1">Grog</span>{ship.supplies.grog}</li>
      <li><span class="text-xs uppercase tracking-wide text-ink-500 mr-1">Gear</span>{ship.supplies.gear}</li>
    </ul>
  </section>

  {#if (ship.flags?.flown ?? []).length > 0}
    <section>
      <h2 class="display text-base uppercase tracking-wider text-ink-500 border-b border-ink-300 pb-1 mb-2">
        Colors
      </h2>
      <ul class="space-y-1.5 text-sm">
        {#each ship.flags.flown as flag (flag.id)}
          {@const isFlying = flag.id === ship.flags.flyingId}
          {@const artUrl = flagArtUrl(flag)}
          <li class="flex items-start gap-2">
            {#if artUrl}
              <img src={artUrl} alt={`${flag.name} art`} class="w-8 h-8 object-cover rounded border border-surface-300" />
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="font-medium">{flag.name}</span>
                {#if !flag.isFaction}
                  <span class="text-xs text-ink-500">rep {flagTotalReputation(flag)}</span>
                {/if}
                {#if isFlying}
                  <span class="text-[10px] uppercase tracking-wide text-brass-700">flying</span>
                {/if}
                {#if flag.isFalse}
                  <span class="text-[10px] uppercase tracking-wide text-ink-500 italic">false</span>
                {/if}
                {#if flag.isPirate}
                  <span class="text-[10px] uppercase tracking-wide text-crimson-700">pirate</span>
                {/if}
                {#if flag.isFaction}
                  <span class="text-[10px] uppercase tracking-wide text-sea-700">faction</span>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

</article>
