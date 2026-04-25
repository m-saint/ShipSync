<script>
  /**
   * ShipCard — fleet-rail entry. Clicking the body focuses the ship in the
   * detail pane; the right-edge column carries the v0.9 sail-order controls
   * (Move up / Move down) so the captain can rearrange the rail without
   * pulling open a sub-dialog. The focus area and the reorder buttons are
   * siblings (not nested) so each control reads as a discrete activatable
   * region for keyboard and screen-reader users.
   *
   * v0.9.1 F7.3 — `Alt+Up` / `Alt+Down` while the ship's focus button has
   * keyboard focus runs `moveShipUp` / `moveShipDown` so a power user can
   * reorder the rail without reaching for the mouse. The handler lives on
   * the focus button itself (not the wrapper div) because Tab navigation
   * naturally lands the user there. Tooltip glyphs on the visible Move-up
   * and Move-down buttons advertise the shortcut for discoverability.
   */

  import {
    workspace,
    focusShip,
    moveShipDown,
    moveShipUp,
  } from '../../state/workspace.svelte.js'
  import { shortcutHint } from '../../ui/platform.js'

  let { ship } = $props()

  let isFocused = $derived(workspace.focusedShipId === ship.id)
  let savedAt = $derived(workspace.lastSavedAtByShipId[ship.id] ?? null)
  let unsavedSince = $derived.by(() => {
    if (!savedAt) return ship.sessionHistory.length > 0 ? 'never saved' : 'unsaved'
    return null
  })

  let hpPct = $derived(ship.hp.max > 0 ? Math.round((ship.hp.current / ship.hp.max) * 100) : 0)
  let pcLabel = $derived(ship.playerCharacter?.characterName ?? null)

  let orderIdx = $derived(workspace.shipOrder.indexOf(ship.id))
  let isFirst = $derived(orderIdx === 0)
  let isLast = $derived(orderIdx === workspace.shipOrder.length - 1)

  const MOVE_UP_SHORTCUT = shortcutHint('ArrowUp', { alt: true, cmd: false })
  const MOVE_DOWN_SHORTCUT = shortcutHint('ArrowDown', { alt: true, cmd: false })

  let moveUpTitle = $derived(
    isFirst
      ? 'Already at the head of the line.'
      : `Sail ${ship.name} ahead one slot · ${MOVE_UP_SHORTCUT}.`,
  )
  let moveDownTitle = $derived(
    isLast
      ? 'Already at the tail of the line.'
      : `Sail ${ship.name} astern one slot · ${MOVE_DOWN_SHORTCUT}.`,
  )

  /**
   * Keyboard handler on the focus button. Alt+Up / Alt+Down map to the
   * equivalent reorder action when the ship isn't already at the
   * corresponding edge. Modifier-less arrow keys are left to the browser
   * (or a future Tab-replacement rail navigator) so we don't override
   * native behavior in default cases.
   *
   * @param {KeyboardEvent} event
   */
  function handleFocusKeydown(event) {
    if (!event.altKey) return
    if (event.metaKey || event.ctrlKey || event.shiftKey) return
    if (event.key === 'ArrowUp') {
      if (isFirst) return
      event.preventDefault()
      moveShipUp(ship.id)
    } else if (event.key === 'ArrowDown') {
      if (isLast) return
      event.preventDefault()
      moveShipDown(ship.id)
    }
  }
</script>

<div
  class="flex w-full rounded-md border transition-colors {isFocused
    ? 'bg-brass-50 border-brass-500 shadow-sail'
    : 'bg-surface-50 border-surface-200 hover:bg-surface-100'}"
  aria-current={isFocused ? 'true' : undefined}
>
  <button
    type="button"
    class="flex-1 min-w-0 text-left p-3 rounded-l-md"
    onclick={() => focusShip(ship.id)}
    onkeydown={handleFocusKeydown}
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-ink-900 truncate">{ship.name}</div>
        <div class="text-xs text-ink-500 truncate">
          {ship.type || 'Unknown type'} · {ship.size}
        </div>
        {#if pcLabel}
          <div class="text-xs text-brass-700 mt-1 truncate">⚓ {pcLabel}</div>
        {/if}
      </div>
      {#if unsavedSince}
        <span
          class="shrink-0 inline-flex items-center text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300"
          title={unsavedSince === 'unsaved' ? 'Has not been saved to a file yet.' : 'Edits since the last file save.'}
        >
          Unsaved
        </span>
      {/if}
    </div>

    <div class="mt-2.5">
      <div class="flex items-center justify-between text-[11px] text-ink-500 mb-1">
        <span>HP</span>
        <span class="font-mono">{ship.hp.current}/{ship.hp.max}</span>
      </div>
      <div class="h-1.5 rounded-full bg-surface-200 overflow-hidden">
        <div
          class="h-full {hpPct < 33 ? 'bg-crimson-500' : hpPct < 66 ? 'bg-amber-500' : 'bg-sea-500'}"
          style="width: {Math.max(0, Math.min(100, hpPct))}%"
        ></div>
      </div>
    </div>
  </button>

  <div
    class="flex flex-col border-l border-surface-200 shrink-0"
    role="group"
    aria-label={`Reorder ${ship.name}`}
  >
    <button
      type="button"
      class="flex-1 px-2 flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-surface-100 disabled:opacity-30 disabled:cursor-default rounded-tr-md"
      onclick={() => moveShipUp(ship.id)}
      disabled={isFirst}
      aria-label={`Move ${ship.name} up in the fleet order`}
      title={moveUpTitle}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 7l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
    </button>
    <button
      type="button"
      class="flex-1 px-2 flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-surface-100 disabled:opacity-30 disabled:cursor-default border-t border-surface-200 rounded-br-md"
      onclick={() => moveShipDown(ship.id)}
      disabled={isLast}
      aria-label={`Move ${ship.name} down in the fleet order`}
      title={moveDownTitle}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>
    </button>
  </div>
</div>
