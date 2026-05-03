<script>
  import Dialog from '../../ui/Dialog.svelte'
  import Button from '../../ui/Button.svelte'
  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import { ui, closeDialog, pushToast } from '../../state/ui.svelte.js'
  import { workspace, addShip } from '../../state/workspace.svelte.js'
  import { settings } from '../../state/settings.svelte.js'
  import {
    SHIP_SIZES,
    SHIP_SIZE_LABELS,
    MOBILITY_OPTIONS,
    MOBILITY_LABELS,
  } from '../../domain/rules.js'
  import {
    defaultCrewMaxFor,
    defaultExplosionDCFor,
    defaultHpMaxFor,
    defaultMobilityFor,
    isHeavyWeaponEligible,
    makeEmptyOfficers,
    shipTypeProfileFor,
    skeletonCrewFor,
  } from '../../domain/derivations.js'

  let open = $derived(ui.openDialog === 'add-ship')

  /**
   * Donor lookup for the carry-forward affordance (v1.0 / Batch 4).
   *
   * The donor is whichever ship the captain is "looking at" — the focused
   * ship if any, otherwise the most recently chartered one. We don't dig
   * into `lastSavedAtByShipId` here because not every working ship has
   * been saved yet, and the focused ship is what the user mentally
   * associates with the carry-forward intent ("seed the new ship from
   * THIS one"). When no ships exist the carry-forward affordance hides.
   *
   * Officers are deep-cloned (not shared) so future edits to the new ship
   * don't bleed back into the donor. Portrait image IDs intentionally
   * carry over: `workspace.images` is a single shared map keyed by id, so
   * the same id pointing from two officer cards is fine — and when the
   * captain clears or replaces the new ship's officer portrait, the
   * pruning logic in workspace.svelte.js drops the image only when the
   * last reference goes away.
   */
  let donorShip = $derived(
    workspace.focusedShipId
      ? (workspace.ships[workspace.focusedShipId] ?? null)
      : workspace.shipOrder.length > 0
        ? (workspace.ships[workspace.shipOrder[workspace.shipOrder.length - 1]] ?? null)
        : null,
  )

  let canShowCarryOver = $derived(settings.carryOverOnCharter && donorShip !== null)

  let form = $state(initialForm())

  function initialForm() {
    return {
      name: '',
      size: /** @type {import('../../domain/types.js').ShipSize} */ ('medium'),
      sizeIsCustom: false,
      type: '',
      mobility: /** @type {import('../../domain/types.js').Mobility} */ ('balanced'),
      hpMax: defaultHpMaxFor('medium'),
      hpMaxIsCustom: false,
      explosionDC: defaultExplosionDCFor('medium'),
      explosionDCIsCustom: false,
      crewMax: defaultCrewMaxFor('medium'),
      crewMaxIsCustom: false,
      mobilityIsCustom: false,
      // v1.0.4: Captain ≡ Player Character. The dialog seeds a captain
      // name (optional), and the captain officer card on the ship detail
      // owns rank, status, portrait, and notes. There is no separate
      // "player character" extension to enable anymore.
      captainName: '',
      // Per-charter override for the carry-forward affordance. Defaults
      // to true so the global toggle's intent is respected unless the
      // captain explicitly opts out for this particular charter.
      carryOver: true,
    }
  }

  // Auto-fill defaults from the canonical ship-type profile (PDF p. 169 /
  // 198) when one is selected, otherwise from the size-keyed tables. The
  // captain can always override any field after auto-fill — the
  // *IsCustom flags freeze the field to whatever they typed. Size is
  // included in the auto-fill set: a Sloop is small by definition, a
  // Galleon is large, etc., and seeding size from the profile lets the
  // size-keyed defaults (e.g. explosion DC) land correctly even before
  // the captain has typed anything else.
  let typeProfile = $derived(shipTypeProfileFor(form.type))

  $effect(() => {
    const profile = typeProfile
    if (profile && !form.sizeIsCustom) form.size = profile.size
    if (!form.hpMaxIsCustom) form.hpMax = profile?.hpMax ?? defaultHpMaxFor(form.size)
    if (!form.explosionDCIsCustom) form.explosionDC = defaultExplosionDCFor(form.size)
    if (!form.crewMaxIsCustom) form.crewMax = profile?.crewMax ?? defaultCrewMaxFor(form.size)
    if (!form.mobilityIsCustom) form.mobility = profile?.mobility ?? defaultMobilityFor(form.size)
  })

  let nameTouched = $state(false)
  let nameError = $derived(form.name.trim().length === 0 ? 'Name is required.' : '')
  let canSubmit = $derived(form.name.trim().length > 0)
  let showNameError = $derived(nameTouched && nameError.length > 0)

  function close() {
    closeDialog()
    form = initialForm()
    nameTouched = false
  }

  function submit(event) {
    event.preventDefault()
    if (!canSubmit) {
      nameTouched = true
      return
    }

    // Skeleton crew is half the max (PDF p. 198 — "Short Staffed"); when a
    // canonical type profile is in play, use its skeleton-crew value
    // verbatim because some types round in unexpected directions.
    const skeleton = typeProfile?.crewSkeleton ?? skeletonCrewFor(form.crewMax)

    const willCarryOver = canShowCarryOver && form.carryOver && donorShip !== null

    /**
     * Build the carry-forward overrides off the donor ship. We use
     * structuredClone for the officers map so the new ship has its own
     * mutable subtree (no shared references with the donor's reactive
     * state), and we copy supplies as a plain spread (it's a shallow
     * record of three numbers, so structuredClone would be overkill).
     *
     * The carry-forward intentionally does NOT touch hp, crew, mettle,
     * or flags — those are charter-time decisions controlled by the form
     * fields above.
     *
     * v1.0.4: when the captain seeds a name in the form, we layer it
     * onto whichever officers block we end up with — either the carry-
     * forward clone, or a fresh empty bridge — so the new ship's captain
     * card lands populated without an extra trip through the officer
     * roster.
     */
    /** @type {Record<string, unknown>} */
    const overrides = {}
    if (willCarryOver) {
      overrides.officers = structuredClone($state.snapshot(donorShip.officers))
      overrides.supplies = { ...donorShip.supplies }
    }
    const captainName = form.captainName.trim()
    if (captainName.length > 0) {
      // Preserve any donor-carried captain rank / status / notes /
      // portrait — only the name is the captain's prerogative on a new
      // charter. (The full carry-forward is "her bridge", but the
      // person on top of the bridge is the player.) When there's no
      // carry-forward, seed a fresh empty roster so the other stations
      // aren't dropped to undefined by the partial overlay.
      const officers =
        /** @type {import('../../domain/types.js').OfficerStations} */ (
          overrides.officers ?? makeEmptyOfficers()
        )
      officers.captain = { ...officers.captain, name: captainName }
      overrides.officers = officers
    }

    const id = addShip({
      name: form.name.trim(),
      size: form.size,
      type: form.type.trim(),
      mobility: form.mobility,
      hp: { current: form.hpMax, max: form.hpMax },
      explosionDC: form.explosionDC,
      weapons: {
        bow: 0,
        port: 0,
        starboard: 0,
        stern: 0,
        heavyEligible: isHeavyWeaponEligible(form.type),
      },
      crew: { current: form.crewMax, max: form.crewMax, skeleton },
      portraitImageId: null,
      ...overrides,
    })

    const carryOverNote = willCarryOver
      ? ` · Carried forward ${donorShip.name}'s bridge crew & supplies`
      : ''

    pushToast({
      kind: 'success',
      title: `Added ${form.name.trim()}.`,
      body: `Hull ${form.hpMax} · Crew ${form.crewMax} · Explosion DC ${form.explosionDC}${carryOverNote}`,
    })

    void id
    close()
  }
</script>

<Dialog
  bind:open
  title="Assign a ship"
  description="Claim her, name her, and prepare to set sail."
  onClose={close}
  size="lg"
>
  <form id="add-ship-form" onsubmit={submit} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <div class="sm:col-span-2">
      <Field
        label="Ship name"
        required
        htmlFor="add-ship-name"
        helpText="The name of your vessel."
        errorText={showNameError ? nameError : ''}
      >
        <input
          id="add-ship-name"
          type="text"
          class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
          bind:value={form.name}
          autocomplete="off"
          maxlength="80"
          placeholder="RLS Legacy"
          required
          onblur={() => (nameTouched = true)}
        />
      </Field>
    </div>

    <Field
      label="Size"
      htmlFor="add-ship-size"
      helpText={form.sizeIsCustom
        ? 'Custom — auto-fill from the type profile is disabled.'
        : typeProfile
          ? `Auto-filled from ${form.type}.`
          : 'determines default hull, crew, and explosion DC when no type is set.'}
    >
      <select
        id="add-ship-size"
        class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm"
        value={form.size}
        onchange={(e) => {
          form.size = /** @type {any} */ (e.currentTarget.value)
          form.sizeIsCustom = true
        }}
      >
        {#each SHIP_SIZES as size (size)}
          <option value={size}>{SHIP_SIZE_LABELS[size]}</option>
        {/each}
      </select>
    </Field>

    <Field
      label="Type"
      htmlFor="add-ship-type"
      helpText={typeProfile
        ? `Recognized — auto-filling stats from the ${form.type} profile.`
        : 'Sloop, Frigate, Galleon, etc. Recognized types auto-fill mobility and stats.'}
    >
      <input
        id="add-ship-type"
        type="text"
        class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm"
        bind:value={form.type}
        autocomplete="off"
        maxlength="40"
        placeholder="Sloop"
        list="add-ship-type-list"
      />
      <datalist id="add-ship-type-list">
        <option value="Sloop"></option>
        <option value="Schooner"></option>
        <option value="Brigantine"></option>
        <option value="Frigate"></option>
        <option value="Galleon"></option>
        <option value="Man o' War"></option>
      </datalist>
    </Field>

    <Field
      label="Mobility"
      htmlFor="add-ship-mobility"
      helpText={form.mobilityIsCustom
        ? 'Custom — auto-fill is disabled.'
        : `Auto-filled from ${typeProfile ? form.type : form.size}.`}
    >
      <select
        id="add-ship-mobility"
        class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm"
        value={form.mobility}
        onchange={(e) => {
          form.mobility = /** @type {any} */ (e.currentTarget.value)
          form.mobilityIsCustom = true
        }}
      >
        {#each MOBILITY_OPTIONS as opt (opt)}
          <option value={opt}>{MOBILITY_LABELS[opt]}</option>
        {/each}
      </select>
    </Field>

    <Field
      label="Hull (HP max)"
      htmlFor="add-ship-hp"
      helpText={form.hpMaxIsCustom
        ? 'Custom value — auto-fill is disabled.'
        : `Auto-filled from ${typeProfile ? form.type : form.size}. Change to override.`}
    >
      <NumberStepper
        id="add-ship-hp"
        ariaLabel="HP max"
        bind:value={form.hpMax}
        min={1}
        max={99}
        step={1}
        onchange={() => (form.hpMaxIsCustom = true)}
      />
    </Field>

    <Field
      label="Explosion DC"
      htmlFor="add-ship-dc"
      helpText={form.explosionDCIsCustom
        ? 'Custom DC — auto-fill is disabled.'
        : `Auto-filled from ${form.size} default. Change to override.`}
    >
      <NumberStepper
        id="add-ship-dc"
        ariaLabel="Explosion DC"
        bind:value={form.explosionDC}
        min={1}
        max={40}
        step={1}
        onchange={() => (form.explosionDCIsCustom = true)}
      />
    </Field>

    <div class="sm:col-span-2">
      <Field
        label="Crew max"
        htmlFor="add-ship-crew"
        helpText={form.crewMaxIsCustom
          ? `Custom — skeleton crew defaults to ${typeProfile?.crewSkeleton ?? skeletonCrewFor(form.crewMax)}.`
          : `Auto-filled from ${typeProfile ? form.type : form.size}. Skeleton crew defaults to half of the max.`}
      >
        <NumberStepper
          id="add-ship-crew"
          ariaLabel="Crew max"
          bind:value={form.crewMax}
          min={1}
          max={99}
          step={1}
          onchange={() => (form.crewMaxIsCustom = true)}
        />
      </Field>
    </div>

    {#if canShowCarryOver}
      <div class="sm:col-span-2 mt-2 pt-4 border-t border-surface-200">
        <label class="inline-flex items-start gap-2 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            bind:checked={form.carryOver}
            class="h-4 w-4 rounded border-surface-400 mt-0.5"
          />
          <span>
            <span>Carry forward {donorShip?.name}'s bridge crew &amp; supplies</span>
            <span class="block text-xs text-ink-500 font-normal mt-0.5">
              Copies officer names, ranks, statuses, notes, portraits, and current Grub/Grog/Gear onto the new ship.
            </span>
          </span>
        </label>
      </div>
    {/if}

    <div class="sm:col-span-2 mt-2 pt-4 border-t border-surface-200">
      <Field
        label="Captain"
        htmlFor="add-ship-captain-name"
        helpText="Optional — your character's name (or whoever else calls the shots)."
      >
        <input
          id="add-ship-captain-name"
          type="text"
          class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm"
          bind:value={form.captainName}
          autocomplete="off"
          maxlength="80"
          placeholder="James Hook"
        />
      </Field>
    </div>
  </form>

  {#snippet footer()}
    <Button variant="ghost" onclick={close}>Cancel</Button>
    <Button variant="primary" type="submit" disabled={!canSubmit} onclick={submit}>
      Add ship
    </Button>
  {/snippet}
</Dialog>
