<script>
  /**
   * FleetPrintView — multi-ship print sheet route (`?print=fleet`).
   *
   * One sheet per loaded player ship in the user's workspace, rendered in
   * `workspace.shipOrder` so the dashboard and the printout stay in sync.
   * Each sheet is followed by a CSS page break (`break-after: page` /
   * `page-break-after: always` for older renderers) so a single Cmd+P
   * produces the entire fleet without a second print dialog.
   *
   * Hydration mirrors PrintView: read the local autosave snapshot at boot
   * because this URL is usually opened in a fresh tab from the dashboard's
   * "Print fleet" button. The view is read-only — it never commits.
   *
   * Empty-state handling: a workspace with zero ships shows a brief notice
   * instead of an empty page. This is the only practical reason the
   * underlying store could be empty after a successful hydrate (autosave
   * exists but no ships were loaded), and we'd rather say so than print a
   * blank piece of paper.
   */

  import { onMount } from 'svelte'
  import { workspace, hydrateFromSnapshot } from '../lib/state/workspace.svelte.js'
  import { readAutosave } from '../lib/persistence/autosave.js'
  import ShipPrintSheet from './ShipPrintSheet.svelte'

  let hydrated = $state(false)
  let hydrationError = $state(/** @type {string|null} */ (null))

  onMount(() => {
    if (typeof window === 'undefined') return
    try {
      const snap = readAutosave()
      if (!snap) {
        hydrationError =
          'No local autosave found. Open the dashboard first, load your fleet, then print.'
        return
      }
      hydrateFromSnapshot(snap)
      hydrated = true
    } catch (e) {
      hydrationError = e instanceof Error ? e.message : String(e)
    }
  })

  let ships = $derived.by(() => {
    if (!hydrated) return []
    return workspace.shipOrder
      .map((id) => workspace.ships[id])
      .filter((ship) => ship != null)
  })

  function doPrint() {
    if (typeof window !== 'undefined') window.print()
  }

  function close() {
    if (typeof window !== 'undefined') window.close()
  }
</script>

<svelte:head>
  <title>Fleet sheets — ShipSync</title>
</svelte:head>

<div class="print-root min-h-dvh bg-white text-ink-900 print:bg-white">
  <div class="print-actions sticky top-0 z-10 bg-surface-100 border-b border-surface-300 print:hidden">
    <div class="max-w-3xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
      <div class="text-sm text-ink-700">
        Fleet sheets
        {#if hydrated}
          — <span class="font-medium">{ships.length} ship{ships.length === 1 ? '' : 's'}</span>
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
          class="h-8 px-3 rounded-md border border-brass-600 bg-brass-500 hover:bg-brass-600 text-sm text-ink-50 disabled:opacity-60 disabled:cursor-not-allowed"
          onclick={doPrint}
          disabled={!hydrated || ships.length === 0}
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
      <p class="text-sm text-ink-500">Loading fleet…</p>
    {:else if ships.length === 0}
      <div class="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm">
        No ships in the workspace yet. Load some in the dashboard, then come back to print.
      </div>
    {:else}
      <div class="flex flex-col gap-12">
        {#each ships as ship, idx (ship.id)}
          <div class={`fleet-page ${idx < ships.length - 1 ? 'fleet-page-break' : ''}`}>
            <ShipPrintSheet {ship} images={workspace.images} />
          </div>
        {/each}
      </div>
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
    /* One sheet per page — the page-break declaration covers older print
       engines, the modern one covers Chromium. */
    .fleet-page-break {
      break-after: page;
      page-break-after: always;
    }
  }
</style>
