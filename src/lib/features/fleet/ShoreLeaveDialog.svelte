<script>
  /**
   * ShoreLeaveDialog — v0.9 fleet-level refit composer.
   *
   * Opens from the WorkspaceTopBar to apply a single shore-leave action across
   * one or more loaded ships. Hull is restored (clamped at each ship's hp.max
   * headroom), supplies are added (no upper bound), and the user can optionally
   * clear scene conditions on each selected ship in the same commit. The
   * underlying mutator (`applyShoreLeave`) coalesces the whole batch into one
   * undo step; per-ship Captain's-Log entries land independently so each ship's
   * narrative shows its own delta line.
   *
   * Design notes:
   *   - Pre-selects every loaded ship on open (the common case is a fleet-wide
   *     port stop). User can deselect individuals or hit "Select none" to
   *     re-target. Selection state lives only while the dialog is open.
   *   - Live preview mirrors the exact workspace + per-ship summary lines that
   *     applyShoreLeave will commit, computed via composeShoreLeaveSummary so
   *     the dialog and the Activity Log are structurally guaranteed to agree.
   *   - Two-click confirm matches DamageComposer / RepairComposer: the primary
   *     button reads "Apply shore leave"; pressing it swaps in "Confirm: apply
   *     shore leave" plus a Back affordance, so the destructive batch is never
   *     a one-tap mistake.
   *   - The "no effect" state (every selected ship is already at full HP and
   *     no positive supply additions and no scene chips to clear) disables the
   *     primary button and tells the user explicitly — no quiet no-op.
   */

  import Dialog from '../../ui/Dialog.svelte'
  import Button from '../../ui/Button.svelte'
  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import { ui, closeDialog } from '../../state/ui.svelte.js'
  import { workspace, applyShoreLeave } from '../../state/workspace.svelte.js'
  import { composeShoreLeaveSummary } from '../../domain/derivations.js'
  import { SHIP_SIZE_LABELS } from '../../domain/rules.js'

  let open = $derived(ui.openDialog === 'shore-leave')

  let selectedIds = $state(/** @type {string[]} */ ([]))
  let hull = $state(0)
  let grub = $state(0)
  let grog = $state(0)
  let gear = $state(0)
  let clearScene = $state(false)
  let source = $state('')
  let confirming = $state(false)

  // Plain JS sentinel (not $state) so writing it doesn't re-trigger the
  // effect; we want the reset to fire ONCE per closed→open transition.
  let prevOpen = false
  $effect(() => {
    const isOpen = open
    if (isOpen && !prevOpen) {
      selectedIds = [...workspace.shipOrder]
      hull = 0
      grub = 0
      grog = 0
      gear = 0
      clearScene = false
      source = ''
      confirming = false
    }
    prevOpen = isOpen
  })

  let shipRows = $derived(
    workspace.shipOrder.map((id) => {
      const ship = workspace.ships[id]
      const sceneList = workspace.scene.shipConditions[id] ?? []
      return {
        id,
        ship,
        selected: selectedIds.includes(id),
        sceneCount: sceneList.length,
      }
    }),
  )

  let allSelected = $derived(
    workspace.shipOrder.length > 0 && selectedIds.length === workspace.shipOrder.length,
  )
  let anySelected = $derived(selectedIds.length > 0)

  function toggleShip(id) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((x) => x !== id)
    } else {
      // Preserve workspace ship order in the selection so the per-ship preview
      // and the workspace summary read top-down through the rail.
      const order = new Map(workspace.shipOrder.map((sid, idx) => [sid, idx]))
      selectedIds = [...selectedIds, id].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    }
    confirming = false
  }

  function selectAll() {
    selectedIds = [...workspace.shipOrder]
    confirming = false
  }

  function selectNone() {
    selectedIds = []
    confirming = false
  }

  let perShipPreviews = $derived.by(() => {
    if (selectedIds.length === 0) return []
    /** @type {{id: string, name: string, summary: string}[]} */
    const previews = []
    for (const id of selectedIds) {
      const ship = workspace.ships[id]
      if (!ship) continue
      const headroom = Math.max(0, ship.hp.max - ship.hp.current)
      const appliedHull = Math.min(hull, headroom)
      const sceneList = workspace.scene.shipConditions[id] ?? []
      const willClear = clearScene && sceneList.length > 0
      const summary = composeShoreLeaveSummary(
        { hull: appliedHull, grub, grog, gear },
        { clearSceneConditions: willClear },
        ship.name,
        source,
      )
      if (summary == null) continue
      previews.push({ id, name: ship.name, summary })
    }
    return previews
  })

  let willCommit = $derived(perShipPreviews.length > 0)

  let workspaceSummary = $derived.by(() => {
    if (perShipPreviews.length === 0) return null
    const trimmedSource = source.trim()
    const sourceClause = trimmedSource ? ` (${trimmedSource})` : ''
    const names = perShipPreviews.map((p) => p.name)
    return names.length <= 3
      ? `Shore leave on ${names.join(', ')}${sourceClause}.`
      : `Shore leave across ${names.length} ships${sourceClause}.`
  })

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
    if (!willCommit) return
    applyShoreLeave(
      selectedIds,
      { hull, grub, grog, gear },
      { clearSceneConditions: clearScene },
      source,
    )
    close()
  }

  // If the user dials all values back to zero while the confirm step is up,
  // collapse back out of confirming so the primary button becomes disabled.
  $effect(() => {
    if (confirming && !willCommit) confirming = false
  })
</script>

<Dialog
  bind:open
  title="Shore leave"
  description="Refit selected ships in a single step — restore hull, top up supplies, and optionally clear scene conditions."
  onClose={close}
  size="lg"
>
  {#if workspace.shipOrder.length === 0}
    <div class="text-sm text-ink-500 py-6 text-center">
      No ships in the workspace. Charter or load a vessel first.
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <fieldset class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <legend class="text-[11px] uppercase tracking-wide text-ink-500">Ships</legend>
          <div class="flex items-center gap-2 text-xs">
            <button
              type="button"
              class="text-sea-700 hover:underline disabled:text-ink-400 disabled:no-underline disabled:cursor-default"
              onclick={selectAll}
              disabled={allSelected}
            >
              Select all
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
        <div class="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-md border border-surface-200 bg-surface-50/40 p-2">
          {#each shipRows as row (row.id)}
            <label class="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-surface-100 cursor-pointer">
              <input
                type="checkbox"
                checked={row.selected}
                onchange={() => toggleShip(row.id)}
                class="h-4 w-4 rounded border-surface-400"
                aria-label={`Include ${row.ship.name} in shore leave`}
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm text-ink-900 truncate">{row.ship.name}</div>
                <div class="text-xs text-ink-500">
                  {SHIP_SIZE_LABELS[row.ship.size] ?? row.ship.size} · Hull {row.ship.hp.current}/{row.ship.hp.max}
                  {#if row.sceneCount > 0}
                    · {row.sceneCount} scene tag{row.sceneCount === 1 ? '' : 's'}
                  {/if}
                </div>
              </div>
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset class="flex flex-col gap-2">
        <legend class="text-[11px] uppercase tracking-wide text-ink-500">
          Refit deltas (applied per ship)
        </legend>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Hull" helpText="Clamped at each ship's headroom.">
            <NumberStepper
              ariaLabel="Hull restored"
              bind:value={hull}
              min={0}
              max={9999}
              step={1}
              tone={hull > 0 ? 'sea' : 'neutral'}
              autofocus
            />
          </Field>
          <Field label="Grub" helpText="Added to each ship.">
            <NumberStepper
              ariaLabel="Grub added"
              bind:value={grub}
              min={0}
              max={9999}
              step={1}
              tone={grub > 0 ? 'sea' : 'neutral'}
            />
          </Field>
          <Field label="Grog" helpText="Added to each ship.">
            <NumberStepper
              ariaLabel="Grog added"
              bind:value={grog}
              min={0}
              max={9999}
              step={1}
              tone={grog > 0 ? 'sea' : 'neutral'}
            />
          </Field>
          <Field label="Gear" helpText="Added to each ship.">
            <NumberStepper
              ariaLabel="Gear added"
              bind:value={gear}
              min={0}
              max={9999}
              step={1}
              tone={gear > 0 ? 'sea' : 'neutral'}
            />
          </Field>
        </div>
      </fieldset>

      <label class="inline-flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={clearScene}
          class="h-4 w-4 mt-0.5 rounded border-surface-400"
        />
        <span>
          <span class="font-medium">Clear scene conditions</span>
          <span class="block text-xs text-ink-500">
            Removes scene-only chips (heeling, in irons, crossing the T) from each selected ship. Persistent ship conditions stay put.
          </span>
        </span>
      </label>

      <Field
        label="Source"
        htmlFor="shore-leave-source"
        helpText="Optional. Names the refit in the log entries."
      >
        <input
          id="shore-leave-source"
          type="text"
          bind:value={source}
          maxlength="80"
          placeholder="e.g. The Hub, Mercani Outpost, etc"
          class="w-full px-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
        />
      </Field>

      <div
        class="rounded-md border border-surface-200 bg-surface-50/80 px-3 py-2 text-xs text-ink-700 flex flex-col gap-1.5 min-h-[2.5rem]"
      >
        {#if workspaceSummary}
          <span aria-live="polite" class="font-medium text-ink-900">{workspaceSummary}</span>
          <ul class="flex flex-col gap-0.5 list-disc list-inside text-ink-600">
            {#each perShipPreviews as p (p.id)}
              <li>{p.summary}</li>
            {/each}
          </ul>
        {:else if !anySelected}
          <span class="text-ink-400" aria-live="polite">Select at least one ship to begin.</span>
        {:else}
          <span class="text-ink-400" aria-live="polite">
            No effect on the selected ships yet — set hull, supplies, or scene clear.
          </span>
        {/if}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    {#if !confirming}
      <Button variant="ghost" onclick={close}>Cancel</Button>
      <Button variant="primary" disabled={!willCommit} onclick={startConfirm}>
        Apply shore leave
      </Button>
    {:else}
      <Button variant="ghost" onclick={cancelConfirm}>Back</Button>
      <Button variant="primary" onclick={handleApply}>
        Confirm: apply shore leave
      </Button>
    {/if}
  {/snippet}
</Dialog>
