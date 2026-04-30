<script>
  /**
   * FlagCard — a single editable flag entry in the FlagsSection roster.
   *
   * Owns nothing it doesn't have to: art URL is derived from `workspace.images`
   * via the parent's `flag.artImageId`, mutators are imported direct, and
   * hint copy lives next to the controls it explains rather than at the
   * section level. The card is rendered both inline (for the always-visible
   * flags) and inside the `<details>` overflow disclosure (for collapsed
   * flags) when a ship's roster gets long; the visual treatment is the same
   * either way so the user can edit a tucked-away flag without expanding
   * back to "all visible" first.
   */

  import Field from '../../ui/Field.svelte'
  import Button from '../../ui/Button.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import ImageUpload from '../../ui/ImageUpload.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import {
    removeShipFlag,
    setShipFlag,
    setShipFlagArt,
    setShipFlagFlying,
    workspace,
  } from '../../state/workspace.svelte.js'
  import { openApplyFlagDialog } from '../../state/ui.svelte.js'
  import {
    flagTotalReputation,
    normalizeReputation,
    sumImageBytes,
  } from '../../domain/derivations.js'
  import { REPUTATION_AXES, REPUTATION_AXIS_LABELS } from '../../domain/rules.js'

  /**
   * @typedef {{
   *   ship: import('../../domain/types.js').Ship,
   *   flag: import('../../domain/types.js').Flag,
   *   isFlying: boolean,
   * }} Props
   */

  /** @type {Props} */
  let { ship, flag, isFlying } = $props()

  let artUrl = $derived(
    flag.artImageId ? workspace.images[flag.artImageId] ?? null : null,
  )

  let otherShipCount = $derived(
    Math.max(0, Object.keys(workspace.ships).length - 1),
  )

  // Normalize the reputation into the four-axis shape on read so that legacy
  // flags (where reputation might still be a single integer until autosave
  // round-trips) still display correctly.
  let rep = $derived(normalizeReputation(flag.reputation))
  let repTotal = $derived(flagTotalReputation(flag))

  const FALSE_HINT =
    "Flying false colors — the ship is sailing under a banner that isn't really hers."
  const PIRATE_HINT =
    "Your pirate flag — Affects how other vessels read your intent."
  const FACTION_HINT =
    "Faction flags belong to an organization. Reputation on these flags belongs to the faction itself, not your ship."
  const REP_HINT =
    "Four independent values — Good, Evil, Lawful, Chaotic. The total across all four is your effective reputation at the table."
  const FLYING_HINT =
    "Only one flag can fly at a time. Lower colors to fly nothing."
</script>

<li
  class={`border rounded-lg p-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4 ${
    isFlying
      ? 'border-brass-400 bg-brass-50/40'
      : 'border-surface-200 bg-surface-50'
  }`}
>
  <div class="flex flex-col items-start gap-2 shrink-0 sm:w-32">
    {#if artUrl}
      <img
        src={artUrl}
        alt={`${flag.name} art`}
        class="w-32 h-20 rounded object-cover border border-surface-300 bg-surface-100"
      />
    {:else}
      <div
        aria-hidden="true"
        class="w-32 h-20 rounded border border-dashed border-surface-300 bg-surface-100 flex items-center justify-center text-ink-500"
      >
        <svg width="32" height="32" viewBox="0 0 24 24">
          <path
            d="M5 21V3l8 4-8 4M5 11l8 4 6-3-6-4"
            stroke="currentColor"
            stroke-width="1.25"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    {/if}
    <div class="flex flex-wrap items-center gap-1.5">
      <ImageUpload
        label={artUrl ? 'Replace' : 'Upload art'}
        existingTotalBytes={sumImageBytes(workspace.images)}
        onchange={(payload) => setShipFlagArt(ship.id, flag.id, payload.dataUrl)}
      />
      {#if artUrl}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => setShipFlagArt(ship.id, flag.id, null)}
        >
          Remove art
        </Button>
      {/if}
    </div>
  </div>

  <div class="flex flex-col gap-3 flex-1 min-w-0">
    <div class="flex items-center gap-2 flex-wrap">
      <input
        type="text"
        aria-label={`Name for flag ${flag.name}`}
        class="flex-1 min-w-[8rem] h-9 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
        value={flag.name}
        onblur={(e) => setShipFlag(ship.id, flag.id, { name: e.currentTarget.value })}
        maxlength="60"
        placeholder="Untitled flag"
      />
      {#if isFlying}
        <span
          class="text-[10px] uppercase tracking-wide bg-brass-200 text-brass-900 px-2 py-1 rounded"
          title="Currently flown."
        >
          Flying
        </span>
      {/if}
      {#if flag.isFalse}
        <span class="text-[10px] uppercase tracking-wide bg-surface-200 text-ink-700 px-2 py-1 rounded">
          False
        </span>
      {/if}
      {#if flag.isPirate}
        <span class="text-[10px] uppercase tracking-wide bg-crimson-100 text-crimson-700 px-2 py-1 rounded">
          Pirate
        </span>
      {/if}
      {#if flag.isFaction}
        <span class="text-[10px] uppercase tracking-wide bg-sea-100 text-sea-800 px-2 py-1 rounded">
          Faction
        </span>
      {/if}
    </div>

    <div class="flex items-center gap-4 flex-wrap text-sm text-ink-700">
      <RuleTooltip hint={FALSE_HINT} display="inline-flex">
        <label class="inline-flex items-center gap-2">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-400"
            checked={flag.isFalse}
            onchange={(e) =>
              setShipFlag(ship.id, flag.id, { isFalse: e.currentTarget.checked })}
          />
          False flag
        </label>
      </RuleTooltip>
      <RuleTooltip hint={PIRATE_HINT} display="inline-flex">
        <label class="inline-flex items-center gap-2">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-400"
            checked={flag.isPirate}
            onchange={(e) =>
              setShipFlag(ship.id, flag.id, { isPirate: e.currentTarget.checked })}
          />
          Pirate flag
        </label>
      </RuleTooltip>
      <RuleTooltip hint={FACTION_HINT} display="inline-flex">
        <label class="inline-flex items-center gap-2">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-400"
            checked={flag.isFaction}
            onchange={(e) =>
              setShipFlag(ship.id, flag.id, { isFaction: e.currentTarget.checked })}
          />
          Faction flag
        </label>
      </RuleTooltip>
    </div>

    {#if flag.isFaction}
      <p class="text-xs text-ink-500 italic">
        Faction flag — reputation belongs to the faction, not the ship. Toggle this off to track per-axis reputation here.
      </p>
    {:else}
      <RuleTooltip hint={REP_HINT} display="block">
        <Field
          label="Reputation"
          helpText={`Total reputation: ${repTotal}. Shared across every hull in the workspace flying this flag.`}
        >
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {#each REPUTATION_AXES as axis (axis)}
              <div class="flex flex-col gap-1">
                <span class="text-[11px] uppercase tracking-wide text-ink-500">
                  {REPUTATION_AXIS_LABELS[axis]}
                </span>
                <NumberStepper
                  ariaLabel={`${REPUTATION_AXIS_LABELS[axis]} reputation for ${flag.name}`}
                  value={rep[axis]}
                  min={0}
                  max={99}
                  step={1}
                  onchange={(v) =>
                    setShipFlag(ship.id, flag.id, {
                      reputation: { [axis]: v },
                    })}
                />
              </div>
            {/each}
          </div>
        </Field>
      </RuleTooltip>
    {/if}

    <div class="flex items-center gap-2 flex-wrap">
      {#if !isFlying}
        <RuleTooltip hint={FLYING_HINT} display="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => setShipFlagFlying(ship.id, flag.id)}
          >
            Hoist this one
          </Button>
        </RuleTooltip>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        disabled={otherShipCount === 0}
        onclick={() => openApplyFlagDialog(ship.id, flag.id)}
        title={otherShipCount === 0
          ? 'Load another ship to copy this banner.'
          : "Copy this flag's name, art, reputation, and pirate/false toggles onto other ships in one undoable step."}
      >
        Apply to other ships…
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={() => removeShipFlag(ship.id, flag.id)}
        title="Strike this flag from the ship's locker. Other hulls' copies aren't affected. Undo will bring it back."
      >
        Strike this flag
      </Button>
    </div>
  </div>
</li>
