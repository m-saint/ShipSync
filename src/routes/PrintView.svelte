<script>
  /**
   * PrintView — single-ship print sheet route (`?print=<shipId>`).
   *
   * Designed to live in its own browser tab so the user can `Cmd+P` it (or
   * take it with them as a paper sheet for the table). The view is read-only
   * — no mutators run, no autosave triggers, no listeners get installed
   * beyond the ones the underlying $state proxies already carry. We hydrate
   * the workspace from the local autosave at boot because the print URL
   * might be opened in a fresh tab where the in-memory workspace is empty;
   * the parent dashboard's autosave is the most-recent trustworthy snapshot
   * we have.
   *
   * Layout philosophy: one column, generous typography, readable at arm's
   * length. App chrome (top bar / fleet rail / scene panel / activity log)
   * is omitted. A small action bar at the top with Print / Close survives
   * on screen but is hidden in `@media print` so it doesn't show on paper.
   *
   * v0.8 — the actual ship rendering moved into `ShipPrintSheet.svelte` so
   * the same body can be reused by `FleetPrintView` (?print=fleet) for a
   * one-job multi-page print of the entire workspace.
   */

  import { onMount } from 'svelte'
  import { workspace, hydrateFromSnapshot } from '../lib/state/workspace.svelte.js'
  import { readAutosave } from '../lib/persistence/autosave.js'
  import ShipPrintSheet from './ShipPrintSheet.svelte'

  /** @type {{ shipId: string }} */
  let { shipId } = $props()

  let hydrated = $state(false)
  let hydrationError = $state(/** @type {string|null} */ (null))

  onMount(() => {
    if (typeof window === 'undefined') return
    try {
      const snap = readAutosave()
      if (!snap) {
        hydrationError =
          'No local autosave found. Open the dashboard first, load this ship, then print.'
        return
      }
      hydrateFromSnapshot(snap)
      hydrated = true
    } catch (e) {
      hydrationError = e instanceof Error ? e.message : String(e)
    }
  })

  let ship = $derived(hydrated ? workspace.ships[shipId] ?? null : null)

  function doPrint() {
    if (typeof window !== 'undefined') window.print()
  }

  function close() {
    if (typeof window !== 'undefined') window.close()
  }
</script>

<svelte:head>
  <title>{ship ? `${ship.name} — ShipSync` : 'ShipSync print sheet'}</title>
</svelte:head>

<div class="print-root min-h-dvh bg-white text-ink-900 print:bg-white">
  <div class="print-actions sticky top-0 z-10 bg-surface-100 border-b border-surface-300 print:hidden">
    <div class="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
      <div class="text-sm text-ink-700">
        Print sheet
        {#if ship}
          — <span class="font-medium">{ship.name}</span>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="h-8 px-3 rounded-md border border-surface-300 bg-surface-50 hover:bg-surface-100 text-sm text-ink-800"
          onclick={close}
        >
          Close
        </button>
        <button
          type="button"
          class="h-8 px-3 rounded-md border border-brass-600 bg-brass-500 hover:bg-brass-600 text-sm text-ink-50"
          onclick={doPrint}
        >
          Print
        </button>
      </div>
    </div>
  </div>

  <main class="max-w-3xl mx-auto px-6 py-8 print:py-0 print:px-0">
    {#if hydrationError}
      <div class="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm">
        {hydrationError}
      </div>
    {:else if !hydrated}
      <p class="text-sm text-ink-500">Loading sheet…</p>
    {:else if !ship}
      <div class="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm">
        No ship found for id <code class="font-mono">{shipId}</code>.
        Load this ship in the dashboard first, then come back.
      </div>
    {:else}
      <ShipPrintSheet {ship} images={workspace.images} />
    {/if}
  </main>
</div>

<style>
  @media print {
    :global(body) {
      background: white !important;
    }
    .print-root {
      min-height: auto;
    }
    .print-actions {
      display: none !important;
    }
    main {
      font-size: 11pt;
    }
  }
</style>
