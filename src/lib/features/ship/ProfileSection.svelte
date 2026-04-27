<script>
  /**
   * ProfileSection — editable particulars for a single ship: name, type, mobility,
   * speed, hull (current + max), explosion DC, weapon slots, heavy-weapons toggle,
   * and the ship's portrait. Each field is reactive: text inputs commit on blur,
   * pickers and toggles commit on change. Every commit is a single Captain's-Log
   * entry, undoable from the existing controls.
   */

  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import ImageUpload from '../../ui/ImageUpload.svelte'
  import Button from '../../ui/Button.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import {
    setShipName,
    setShipType,
    setShipMobility,
    setShipSpeed,
    setShipHpMax,
    setShipHpCurrent,
    setShipExplosionDC,
    setShipWeapons,
    setShipPortrait,
    workspace,
  } from '../../state/workspace.svelte.js'
  import { MOBILITY_OPTIONS, MOBILITY_LABELS } from '../../domain/rules.js'
  import { sumImageBytes } from '../../domain/derivations.js'

  let { ship } = $props()

  // Writable $derived: each input reads the canonical ship field by default so
  // undo/redo/file-load flows in automatically. The input writes back into the
  // local override on every keystroke; commit handlers push the override into
  // workspace state on blur and re-anchor to the canonical value (so a no-op
  // blur or a rejected edit, e.g. empty ship name, snaps the input back
  // instead of leaving stale text on screen).
  let nameDraft = $derived(ship.name)
  let typeDraft = $derived(ship.type ?? '')

  function commitName() {
    if (nameDraft.trim() !== ship.name) setShipName(ship.id, nameDraft)
    nameDraft = ship.name
  }
  function commitType() {
    if (typeDraft.trim() !== (ship.type ?? '')) setShipType(ship.id, typeDraft)
    typeDraft = ship.type ?? ''
  }

  let portraitDataUrl = $derived(
    ship.portraitImageId ? workspace.images[ship.portraitImageId] ?? null : null,
  )

  const SPEED_HINT =
    'Knots is the in-fiction speed; squares is how far she moves on the play surface this round.'
  const WEAPONS_HINT =
    'Cannons mounted on each side. Heavy-weapons eligibility unlocks the larger gun classes — toggle off if your ship rejects them.'
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">Particulars</h3>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Profile</span>
  </header>

  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <div class="sm:col-span-2">
      <Field label="Ship name" htmlFor="profile-name" required>
        <input
          id="profile-name"
          type="text"
          class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
          bind:value={nameDraft}
          onblur={commitName}
          autocomplete="off"
          maxlength="80"
          placeholder="The Black Spear"
        />
      </Field>
    </div>

    <Field label="Type" htmlFor="profile-type" helpText="Sloop, Frigate, Galleon, &c. Free text.">
      <input
        id="profile-type"
        type="text"
        class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
        bind:value={typeDraft}
        onblur={commitType}
        autocomplete="off"
        maxlength="40"
        placeholder="Sloop"
      />
    </Field>

    <Field label="Mobility" htmlFor="profile-mobility" helpText="High turns sharp; balanced is the default; low is broad and slow.">
      <select
        id="profile-mobility"
        class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
        value={ship.mobility}
        onchange={(e) => setShipMobility(ship.id, /** @type {any} */ (e.currentTarget.value))}
      >
        {#each MOBILITY_OPTIONS as opt (opt)}
          <option value={opt}>{MOBILITY_LABELS[opt]}</option>
        {/each}
      </select>
    </Field>

    <RuleTooltip hint={SPEED_HINT} display="block">
      <Field label="Speed" helpText="Both update independently — set whichever you track at the table.">
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5 text-sm text-ink-700">
            <NumberStepper
              ariaLabel="Speed in knots"
              value={ship.speed.knots}
              min={0}
              max={99}
              step={1}
              onchange={(v) => setShipSpeed(ship.id, { knots: v })}
            />
            <span class="text-xs text-ink-500">kt</span>
          </div>
          <div class="flex items-center gap-1.5 text-sm text-ink-700">
            <NumberStepper
              ariaLabel="Speed in squares"
              value={ship.speed.squares}
              min={0}
              max={99}
              step={1}
              onchange={(v) => setShipSpeed(ship.id, { squares: v })}
            />
            <span class="text-xs text-ink-500">sq</span>
          </div>
        </div>
      </Field>
    </RuleTooltip>

    <Field label="Hull (current / max)" helpText="Current is clamped to max. Lower max to scuttle a ship; raise it for refits.">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5 text-sm text-ink-700">
          <NumberStepper
            ariaLabel="Current hull"
            value={ship.hp.current}
            min={0}
            max={ship.hp.max}
            step={1}
            onchange={(v) => setShipHpCurrent(ship.id, v)}
          />
          <span class="text-xs text-ink-500">/ {ship.hp.max}</span>
        </div>
        <div class="flex items-center gap-1.5 text-sm text-ink-700">
          <span class="text-xs uppercase tracking-wide text-ink-500">Max</span>
          <NumberStepper
            ariaLabel="Hull max"
            value={ship.hp.max}
            min={1}
            max={99}
            step={1}
            onchange={(v) => setShipHpMax(ship.id, v)}
          />
        </div>
      </div>
    </Field>

    <Field label="Explosion DC" helpText="Higher means tougher when fires get loose.">
      <NumberStepper
        ariaLabel="Explosion DC"
        value={ship.explosionDC}
        min={1}
        max={40}
        step={1}
        onchange={(v) => setShipExplosionDC(ship.id, v)}
      />
    </Field>

    <div class="sm:col-span-2">
      <RuleTooltip hint={WEAPONS_HINT} display="block">
        <Field label="Weapon slots">
          <div class="grid grid-cols-2 gap-2">
            {#each [{ key: 'bow', label: 'Bow' }, { key: 'port', label: 'Port' }, { key: 'starboard', label: 'Starboard' }, { key: 'stern', label: 'Stern' }] as slot (slot.key)}
              <div class="flex flex-col items-stretch gap-1.5 px-2 py-2 rounded-md border border-surface-300 bg-surface-50">
                <span class="text-[10px] uppercase tracking-wide text-ink-500">{slot.label}</span>
                <NumberStepper
                  ariaLabel={`${slot.label} weapons`}
                  value={ship.weapons[slot.key]}
                  min={0}
                  max={99}
                  step={1}
                  onchange={(v) => setShipWeapons(ship.id, { [slot.key]: v })}
                />
              </div>
            {/each}
          </div>
          <label class="inline-flex items-center gap-2 mt-3 text-sm text-ink-700">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-surface-400"
              checked={ship.weapons.heavyEligible}
              onchange={(e) => setShipWeapons(ship.id, { heavyEligible: e.currentTarget.checked })}
            />
            Heavy weapons eligible
          </label>
        </Field>
      </RuleTooltip>
    </div>
  </div>

  <div class="border-t border-surface-200 pt-4">
    <Field label="Ship portrait" helpText="Bundled into the save file as a data URL. Larger images make save files heavier.">
      <div class="flex items-center gap-3">
        {#if portraitDataUrl}
          <img
            src={portraitDataUrl}
            alt={`${ship.name} portrait`}
            class="w-16 h-16 rounded-md object-cover border border-surface-300 bg-surface-100"
          />
        {:else}
          <div
            aria-hidden="true"
            class="w-16 h-16 rounded-md border border-dashed border-surface-300 bg-surface-100 flex items-center justify-center text-ink-500"
          >
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path
                d="M3 18l9 3 9-3M5 13l7-2 7 2M12 3v8m-4-3h8"
                stroke="currentColor"
                stroke-width="1.25"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          <ImageUpload
            label={portraitDataUrl ? 'Replace portrait' : 'Upload portrait'}
            existingTotalBytes={sumImageBytes(workspace.images)}
            onchange={(payload) => setShipPortrait(ship.id, payload.dataUrl)}
          />
          {#if portraitDataUrl}
            <Button variant="ghost" size="sm" onclick={() => setShipPortrait(ship.id, null)}>
              Remove
            </Button>
          {/if}
        </div>
      </div>
    </Field>
  </div>
</section>
