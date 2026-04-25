<script>
  /**
   * ActivityLog — workspace-wide undo/redo log.
   *
   * v0.7 adds two filter rows that narrow what's shown without touching the
   * undo stack itself:
   *
   *   - Ship chip: "All" + one chip per loaded player ship. When set, only
   *     actions whose `shipId` matches are rendered. Workspace-level events
   *     (e.g. "Cleared the dashboard", scene round/phase/wind changes that
   *     aren't tied to a specific ship) are hidden when a ship is selected.
   *   - Category segmented: "All / Combat / Crew / Refit / Journal" routed
   *     through the pure `actionCategory(kind)` derivation.
   *
   * Filters AND together. Only the rendered list is filtered — undo/redo
   * still operates on the full underlying stack so the player never gets
   * stranded on an action they can't reach via Ctrl+Z.
   *
   * To make filters useful we read more entries than we display so a tight
   * filter still surfaces meaningful history. We pull up to 100 recent
   * actions, filter, then cap the visible list at 30.
   */

  import EmptyState from '../../ui/EmptyState.svelte'
  import { recentActions, workspace, prunedActionCount } from '../../state/workspace.svelte.js'
  import {
    NauticalCopy,
    actionCategory,
    ACTION_CATEGORIES,
    ACTION_CATEGORY_LABELS,
  } from '../../domain/derivations.js'
  import {
    ui,
    setActivityLogShipFilter,
    setActivityLogCategoryFilter,
    clearActivityLogFilters,
  } from '../../state/ui.svelte.js'

  const READ_BUFFER = 100
  const VISIBLE_LIMIT = 30

  let actionsAll = $derived(recentActions(READ_BUFFER))
  let shipFilter = $derived(ui.activityLog.shipFilter)
  let categoryFilter = $derived(ui.activityLog.categoryFilter)

  let playerShips = $derived(
    workspace.shipOrder.map((id) => workspace.ships[id]).filter(Boolean),
  )

  let filtered = $derived(
    actionsAll.filter((action) => {
      if (shipFilter && action.shipId !== shipFilter) return false
      if (categoryFilter !== 'all' && actionCategory(action.kind) !== categoryFilter) {
        return false
      }
      return true
    }),
  )

  let visible = $derived(filtered.slice(0, VISIBLE_LIMIT))
  let hiddenCount = $derived(filtered.length - visible.length)
  let filtersActive = $derived(shipFilter != null || categoryFilter !== 'all')

  // Soft cap announce: when the global undo stack rolls past UNDO_LIMIT we
  // shift the oldest entries off the bottom. Surfacing the count under the
  // list lets the player see why ancient actions stop being undoable
  // without nagging them mid-session — it sits at the boundary, not in a
  // toast or the workspace chrome.
  let prunedCount = $derived(prunedActionCount())

  // If the selected ship is removed from the workspace, drop the filter so
  // we don't leave the user staring at an empty list referencing a ghost.
  $effect(() => {
    if (shipFilter && !workspace.ships[shipFilter]) {
      setActivityLogShipFilter(null)
    }
  })

  /** @param {string|null} shipId */
  function selectShip(shipId) {
    setActivityLogShipFilter(shipId)
  }

  /** @param {'all'|'combat'|'crew'|'refit'|'journal'} cat */
  function selectCategory(cat) {
    setActivityLogCategoryFilter(cat)
  }

  function clearFilters() {
    clearActivityLogFilters()
  }

  /** @param {string} kind */
  function categoryDotClass(kind) {
    const cat = actionCategory(kind)
    if (cat === 'combat') return 'bg-crimson-500'
    if (cat === 'crew') return 'bg-brass-500'
    if (cat === 'journal') return 'bg-deep-700'
    return 'bg-surface-400'
  }
</script>

<section class="flex-1 min-h-0 flex flex-col">
  <header class="px-3 py-2.5 border-b border-surface-200 flex items-center justify-between bg-surface-100">
    <div class="flex flex-col gap-0.5">
      <h2 class="display text-sm uppercase tracking-wider text-ink-500">Activity Log</h2>
      <span class="text-[10px] uppercase tracking-wide text-ink-400">Workspace edits · undo / redo</span>
    </div>
    <span class="text-xs text-ink-500">
      {#if filtersActive}
        {filtered.length} / {actionsAll.length}
      {:else}
        {actionsAll.length}
      {/if}
    </span>
  </header>

  {#if actionsAll.length > 0}
    <div class="px-3 py-2 border-b border-surface-200 bg-surface-50/60 flex flex-col gap-1.5">
      {#if playerShips.length > 0}
        <div
          class="flex items-center gap-1 flex-wrap"
          role="group"
          aria-label="Filter activity log by ship"
        >
          <button
            type="button"
            class="px-2 h-6 rounded-full border text-[11px] font-medium transition-colors {shipFilter === null
              ? 'bg-ink-900 border-ink-900 text-ink-50'
              : 'bg-surface-50 border-surface-300 text-ink-700 hover:bg-surface-100'}"
            onclick={() => selectShip(null)}
            aria-pressed={shipFilter === null}
          >
            All ships
          </button>
          {#each playerShips as ship (ship.id)}
            <button
              type="button"
              class="px-2 h-6 rounded-full border text-[11px] font-medium transition-colors max-w-[180px] truncate {shipFilter === ship.id
                ? 'bg-ink-900 border-ink-900 text-ink-50'
                : 'bg-surface-50 border-surface-300 text-ink-700 hover:bg-surface-100'}"
              onclick={() => selectShip(ship.id)}
              aria-pressed={shipFilter === ship.id}
              title={ship.name}
            >
              {ship.name}
            </button>
          {/each}
        </div>
      {/if}

      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div
          class="inline-flex rounded-md border border-surface-300 bg-surface-50 p-0.5"
          role="group"
          aria-label="Filter activity log by category"
        >
          <button
            type="button"
            class="px-2 h-6 rounded text-[11px] font-medium transition-colors {categoryFilter === 'all'
              ? 'bg-ink-900 text-ink-50'
              : 'text-ink-700 hover:bg-surface-100'}"
            onclick={() => selectCategory('all')}
            aria-pressed={categoryFilter === 'all'}
          >
            All
          </button>
          {#each ACTION_CATEGORIES as cat (cat)}
            <button
              type="button"
              class="px-2 h-6 rounded text-[11px] font-medium transition-colors {categoryFilter === cat
                ? 'bg-ink-900 text-ink-50'
                : 'text-ink-700 hover:bg-surface-100'}"
              onclick={() => selectCategory(cat)}
              aria-pressed={categoryFilter === cat}
            >
              {ACTION_CATEGORY_LABELS[cat]}
            </button>
          {/each}
        </div>
        {#if filtersActive}
          <button
            type="button"
            class="text-[11px] text-ink-500 hover:text-ink-800 underline-offset-2 hover:underline"
            onclick={clearFilters}
          >
            Clear filters
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto">
    {#if actionsAll.length === 0}
      <EmptyState
        align="left"
        title={NauticalCopy.emptyLogTitle}
        body={NauticalCopy.emptyLogBody}
      />
    {:else if visible.length === 0}
      <div class="px-3 py-6 text-sm text-ink-500 text-center leading-relaxed">
        No entries match this filter yet.
        <br />
        <button
          type="button"
          class="text-ink-700 underline underline-offset-2 hover:text-ink-900"
          onclick={clearFilters}
        >
          Show everything
        </button>
      </div>
    {:else}
      <ol class="px-3 py-2 flex flex-col">
        {#each visible as action (action.id)}
          <li class="py-2 border-b border-surface-200/70 last:border-b-0">
            <div class="flex items-start gap-2">
              <time class="shrink-0 text-[10px] uppercase tracking-wide text-ink-500 mt-0.5 font-mono">
                {new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
              <div class="min-w-0 flex-1">
                <div class="text-sm text-ink-900">{action.summary}</div>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span
                    class="inline-block w-1.5 h-1.5 rounded-full {categoryDotClass(action.kind)}"
                    aria-hidden="true"
                  ></span>
                  <span class="text-[10px] text-ink-500 font-mono">{action.kind}</span>
                </div>
              </div>
            </div>
          </li>
        {/each}
      </ol>
      {#if hiddenCount > 0}
        <div class="px-3 py-2 text-[11px] text-ink-500 text-center">
          {hiddenCount} more entr{hiddenCount === 1 ? 'y' : 'ies'} match — narrow the filter to surface them.
        </div>
      {/if}
      {#if prunedCount > 0}
        <div class="px-3 py-2 text-[11px] text-ink-500 text-center border-t border-surface-200/70 italic">
          {prunedCount} earlier action{prunedCount === 1 ? '' : 's'} pruned to keep history light — those steps can't be undone.
        </div>
      {/if}
    {/if}
  </div>
</section>
