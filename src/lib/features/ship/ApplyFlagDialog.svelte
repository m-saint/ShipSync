<script>
  /**
   * ApplyFlagDialog — v0.9 "copy this flag to other ships" composer.
   *
   * Triggered from a single FlagCard via `openApplyFlagDialog(shipId, flagId)`.
   * The dialog reads `ui.applyFlagSource` to identify which flag the user is
   * copying and which ship it came from. The list of candidate target ships
   * is the workspace fleet minus the source ship; rows whose ship already
   * carries a flag with the same name (case- and whitespace-insensitive) are
   * disabled with an "Already flies this banner" hint, mirroring the dedup
   * rule enforced by `applyFlagToShips` so the UI never lets the user
   * commit to a copy that the mutator would silently skip.
   *
   * Pre-selection is *empty* (unlike ShoreLeaveDialog's pre-select-all). A
   * captain copying a banner is usually targeting a specific hull or two;
   * forcing the choice keeps fleet-wide accidental copies off the table.
   * "Select all eligible" / "Select none" are still here for power users.
   *
   * Apply flow uses the two-click confirm pattern shared with the damage,
   * repair, and shore-leave composers — primary button reads "Apply",
   * pressing it swaps in "Confirm: apply" plus a Back affordance.
   *
   * Post-apply toasts:
   *   - applied N, skipped 0 → success: "Flag X applied to N ship(s)."
   *   - applied N, skipped M → success with skipped count appended.
   *   - applied 0, skipped M → warning: "Skipped all M; already flying X."
   * The skipped count comes from `applyFlagToShips`'s return value, which
   * also covers the "user disabled the dedup check by ignoring the dimmed
   * row" edge case (currently impossible because we disable the input, but
   * cheap insurance against future UI regressions).
   */

  import Dialog from '../../ui/Dialog.svelte'
  import Button from '../../ui/Button.svelte'
  import Field from '../../ui/Field.svelte'
  import { ui, closeDialog, pushToast } from '../../state/ui.svelte.js'
  import { workspace, applyFlagToShips } from '../../state/workspace.svelte.js'

  let open = $derived(ui.openDialog === 'apply-flag')

  let sourceShipId = $derived(ui.applyFlagSource?.shipId ?? null)
  let sourceFlagId = $derived(ui.applyFlagSource?.flagId ?? null)
  let sourceShip = $derived(sourceShipId ? workspace.ships[sourceShipId] : null)
  let sourceFlag = $derived.by(() => {
    if (!sourceShip || !sourceFlagId) return null
    return (
      sourceShip.flags?.flown?.find((f) => f.id === sourceFlagId) ?? null
    )
  })

  let selectedIds = $state(/** @type {string[]} */ ([]))
  let raiseOnTargets = $state(false)
  let confirming = $state(false)

  // Map from row id → checkbox element so we can autofocus the first
  // eligible row when the dialog opens. Plain object keyed by ship id;
  // entries are written by the `bind:this` on each checkbox and read by
  // the open-transition effect. Not reactive — Svelte 5 keeps focus in
  // imperative-DOM territory, and we don't render anything off this map.
  const checkboxRefs = /** @type {Record<string, HTMLInputElement | null>} */ ({})

  let prevOpen = false
  $effect(() => {
    const isOpen = open
    if (isOpen && !prevOpen) {
      selectedIds = []
      raiseOnTargets = false
      confirming = false
      // Autofocus the first eligible target's checkbox after the dialog
      // body renders. v0.9.1 F7.2 — without this, a keyboard-only user
      // had to tab past the dialog close button and the legend before
      // reaching the first interactive control. queueMicrotask runs
      // after the current $effect tick has reconciled the DOM, so the
      // checkbox refs the {#each} block writes via `bind:this` are
      // populated by the time we read them. If every row is a clash
      // (the empty-eligible case), `eligibleIds` is empty and we leave
      // focus on the dialog default — the empty-state caption already
      // tells the user what to do.
      queueMicrotask(() => {
        const firstEligible = eligibleIds[0]
        if (!firstEligible) return
        const node = checkboxRefs[firstEligible]
        if (node && typeof node.focus === 'function') {
          node.focus()
        }
      })
    }
    prevOpen = isOpen
  })

  /**
   * Candidate rows for the picker — every ship except the source, with a
   * pre-computed `clash` flag so the row can render in its dimmed-disabled
   * state without re-walking the flag list on every keystroke.
   */
  let candidateRows = $derived.by(() => {
    if (!sourceFlag || !sourceShipId) return []
    const sourceNameKey = sourceFlag.name.trim().toLowerCase()
    return workspace.shipOrder
      .filter((id) => id !== sourceShipId)
      .map((id) => {
        const ship = workspace.ships[id]
        const clash = (ship.flags?.flown ?? []).some(
          (f) => f.name.trim().toLowerCase() === sourceNameKey,
        )
        return {
          id,
          ship,
          clash,
          selected: selectedIds.includes(id),
        }
      })
  })

  let eligibleIds = $derived(candidateRows.filter((r) => !r.clash).map((r) => r.id))
  let allEligibleSelected = $derived(
    eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.includes(id)),
  )
  let anySelected = $derived(selectedIds.length > 0)
  let willCommit = $derived(anySelected && sourceFlag != null)

  /** @param {string} id */
  function toggleShip(id) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((x) => x !== id)
    } else {
      // Preserve workspace ship order in the selection so the workspace log
      // line ("Copied flag X to A, B, C") reads top-down through the rail.
      const order = new Map(workspace.shipOrder.map((sid, idx) => [sid, idx]))
      selectedIds = [...selectedIds, id].sort(
        (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
      )
    }
    confirming = false
  }

  function selectAllEligible() {
    selectedIds = [...eligibleIds]
    confirming = false
  }

  function selectNone() {
    selectedIds = []
    confirming = false
  }

  function close() {
    closeDialog()
    confirming = false
  }

  function startConfirm() {
    if (!willCommit) return
    confirming = true
  }

  function cancelConfirm() {
    confirming = false
  }

  function handleApply() {
    if (!willCommit || !sourceShipId || !sourceFlagId || !sourceFlag) return
    const flagName = sourceFlag.name
    const result = applyFlagToShips(sourceShipId, sourceFlagId, selectedIds, {
      raiseOnTargets,
    })
    const appliedCount = result.applied.length
    const skippedCount = result.skipped.length

    if (appliedCount > 0 && skippedCount === 0) {
      pushToast({
        kind: 'success',
        title: `Flag “${flagName}” applied`,
        body: `Copied to ${appliedCount} ship${appliedCount === 1 ? '' : 's'}.`,
      })
    } else if (appliedCount > 0 && skippedCount > 0) {
      pushToast({
        kind: 'success',
        title: `Flag “${flagName}” applied`,
        body: `Copied to ${appliedCount} ship${appliedCount === 1 ? '' : 's'}; skipped ${skippedCount} already flying it.`,
      })
    } else if (appliedCount === 0 && skippedCount > 0) {
      pushToast({
        kind: 'warning',
        title: 'Nothing applied',
        body: `Every selected ship already flies a flag named “${flagName}”.`,
      })
    }
    close()
  }

  // Drop confirm step if the user re-selects nothing while the confirm step
  // is showing (e.g. unchecks the last target after starting confirm).
  $effect(() => {
    if (confirming && !willCommit) confirming = false
  })

  let titleText = $derived(
    sourceFlag ? `Apply “${sourceFlag.name}”` : 'Apply flag',
  )
  let descriptionText = $derived.by(() => {
    if (!sourceFlag || !sourceShip) return ''
    return `Copy this banner from ${sourceShip.name} onto one or more other hulls. Each target gets its own copy of the four-axis reputation tally — future bumps on either flag won't propagate back to the other.`
  })
</script>

<Dialog
  bind:open
  title={titleText}
  description={descriptionText}
  onClose={close}
  size="lg"
>
  {#if !sourceFlag || !sourceShip}
    <div class="text-sm text-ink-500 py-6 text-center">
      Source flag is no longer available. Close and reopen from the flag you want to copy.
    </div>
  {:else if candidateRows.length === 0}
    <div class="text-sm text-ink-500 py-6 text-center">
      No other ships in the workspace. Add or load a second ship first.
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <fieldset class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <legend class="text-[11px] uppercase tracking-wide text-ink-500">
            Targets
          </legend>
          <div class="flex items-center gap-2 text-xs">
            <button
              type="button"
              class="text-sea-700 hover:underline disabled:text-ink-400 disabled:no-underline disabled:cursor-default"
              onclick={selectAllEligible}
              disabled={eligibleIds.length === 0 || allEligibleSelected}
            >
              Select all eligible
            </button>
            <span class="text-ink-300" aria-hidden="true">·</span>
            <button
              type="button"
              class="text-sea-700 hover:underline disabled:text-ink-400 disabled:no-underline disabled:cursor-default"
              onclick={selectNone}
              disabled={!anySelected}
            >
              Select none
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-md border border-surface-200 bg-surface-50/40 p-2">
          {#each candidateRows as row (row.id)}
            <label
              class={`flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer ${
                row.clash ? 'opacity-60 cursor-not-allowed' : 'hover:bg-surface-100'
              }`}
            >
              <input
                type="checkbox"
                checked={row.selected}
                disabled={row.clash}
                onchange={() => toggleShip(row.id)}
                class="h-4 w-4 rounded border-surface-400"
                aria-label={`Apply flag to ${row.ship.name}`}
                bind:this={checkboxRefs[row.id]}
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm text-ink-900 truncate">{row.ship.name}</div>
                <div class="text-xs text-ink-500 truncate">
                  Hull {row.ship.hp.current}/{row.ship.hp.max}
                  {#if row.clash}
                    · Already flies a banner with this name
                  {/if}
                </div>
              </div>
            </label>
          {/each}
        </div>
        {#if eligibleIds.length === 0}
          <p class="text-xs text-amber-700">
            Every other ship already flies a banner with this name. Strike or rename one to clear a slot.
          </p>
        {/if}
      </fieldset>

      <Field
        label="Hoist on each target"
        helpText="Raise the new copy as the flying flag on every target. Leave off to add it to the locker without changing what each ship currently flies."
      >
        <label class="inline-flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-400"
            bind:checked={raiseOnTargets}
          />
          Hoist this banner after copying
        </label>
      </Field>

      <div
        class="rounded-md border border-surface-200 bg-surface-50/80 px-3 py-2 text-xs text-ink-700 min-h-[2.25rem]"
      >
        {#if anySelected}
          <span aria-live="polite">
            Will copy <strong>“{sourceFlag.name}”</strong> from {sourceShip.name} to
            {selectedIds.length} ship{selectedIds.length === 1 ? '' : 's'}.
          </span>
        {:else}
          <span class="text-ink-400" aria-live="polite">
            Pick one or more eligible ships to copy this banner to.
          </span>
        {/if}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    {#if !confirming}
      <Button variant="ghost" onclick={close}>Cancel</Button>
      <Button variant="primary" disabled={!willCommit} onclick={startConfirm}>
        Apply flag
      </Button>
    {:else}
      <Button variant="ghost" onclick={cancelConfirm}>Back</Button>
      <Button variant="primary" onclick={handleApply}>
        Confirm: apply flag
      </Button>
    {/if}
  {/snippet}
</Dialog>
