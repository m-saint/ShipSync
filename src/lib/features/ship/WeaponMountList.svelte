<script>
  /**
   * WeaponMountList — per-side roster of cannons (or other arms) actually
   * mounted in a ship's slot bank.
   *
   * v1.0.4 promoted weapons from "just a count of slots" (`weapons.bow = 3`)
   * to a list of named mounts (a Ballista in one starboard slot, a Falconet
   * in the other, a 2-slot Large Cannon at the stern, &c.). The slot-count
   * stepper still lives one row up — it's the captain's declared *capacity*
   * for that side (the brig has four starboard slots). This component
   * tracks the *contents* of those slots and surfaces an "X of Y filled"
   * tally so under-equipped or overstuffed sides are visible at a glance.
   *
   * The text inputs commit on blur so a captain typing "Falconet" letter by
   * letter doesn't emit an entry per keystroke; the slots stepper commits
   * on every step but the workspace's coalesce logic folds successive
   * stepper bumps on the same mount into one log entry.
   */

  import NumberStepper from '../../ui/NumberStepper.svelte'
  import {
    addShipWeaponMount,
    setShipWeaponMount,
    removeShipWeaponMount,
  } from '../../state/workspace.svelte.js'

  /**
   * @type {{
   *   ship: import('../../domain/types.js').Ship,
   *   side: 'bow' | 'port' | 'starboard' | 'stern',
   *   label: string,
   * }}
   */
  let { ship, side, label } = $props()

  /**
   * Side-local draft for the name input. Keyed by mountId so each row
   * keeps its own buffer; commits on blur, then re-anchors to the live
   * canonical value so a no-op blur snaps clean.
   * @type {Record<string, string>}
   */
  let nameDrafts = $state({})

  let mounts = $derived(ship.weaponInventory?.[side] ?? [])
  let occupied = $derived(
    mounts.reduce((acc, m) => acc + (Number(m.slotsOccupied) || 0), 0),
  )
  let capacity = $derived(ship.weapons?.[side] ?? 0)
  let overCapacity = $derived(occupied > capacity)

  function readDraft(mount) {
    return nameDrafts[mount.id] ?? mount.name
  }

  function writeDraft(mountId, value) {
    nameDrafts = { ...nameDrafts, [mountId]: value }
  }

  function commitName(mount) {
    const draft = nameDrafts[mount.id]
    if (draft != null && draft !== mount.name) {
      setShipWeaponMount(ship.id, side, mount.id, { name: draft })
    }
    const { [mount.id]: _drop, ...rest } = nameDrafts
    nameDrafts = rest
  }
</script>

<div class="flex flex-col gap-1.5 mt-2">
  <div class="flex items-baseline justify-between gap-2 px-0.5">
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Weapons in {label}</span>
    <span
      class={`text-[11px] ${overCapacity ? 'text-amber-700 font-medium' : 'text-ink-500'}`}
      aria-live="polite"
    >
      <span class="font-mono">{occupied}</span>
      <span>of</span>
      <span class="font-mono">{capacity}</span>
      <span>slot{capacity === 1 ? '' : 's'} filled</span>
      {#if overCapacity}
        <span> · over capacity</span>
      {/if}
    </span>
  </div>

  {#if mounts.length === 0}
    <p class="text-[11px] text-ink-500 italic px-0.5">
      No weapons yet. Click below to add one.
    </p>
  {:else}
    <ul class="flex flex-col gap-1.5" role="list">
      {#each mounts as mount (mount.id)}
        <li class="flex items-center gap-1.5">
          <input
            type="text"
            class="flex-1 min-w-0 h-8 px-2 rounded-md border border-surface-300 bg-surface-50 text-xs text-ink-900"
            value={readDraft(mount)}
            oninput={(e) => writeDraft(mount.id, e.currentTarget.value)}
            onblur={() => commitName(mount)}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            aria-label={`${label} mount name`}
            placeholder="e.g. Falconet"
            maxlength="40"
            autocomplete="off"
          />
          <NumberStepper
            ariaLabel={`Slots occupied by ${mount.name || 'mount'} on ${label}`}
            value={mount.slotsOccupied}
            min={1}
            max={16}
            step={1}
            onchange={(v) => setShipWeaponMount(ship.id, side, mount.id, { slotsOccupied: v })}
          />
          <button
            type="button"
            class="w-7 h-7 shrink-0 flex items-center justify-center rounded text-ink-500 hover:bg-surface-100 hover:text-crimson-700"
            onclick={() => removeShipWeaponMount(ship.id, side, mount.id)}
            aria-label={`Remove ${mount.name || 'unnamed mount'} from ${label}`}
            title="Remove mount"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <button
    type="button"
    class="self-start text-[11px] uppercase tracking-wide text-brass-700 hover:text-brass-900 underline-offset-2 hover:underline"
    onclick={() => addShipWeaponMount(ship.id, side)}
  >
    + Add weapon
  </button>
</div>
