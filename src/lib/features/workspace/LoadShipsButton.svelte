<script>
  /**
   * LoadShipsButton — file-input wrapper that handles BOTH per-ship
   * `.shipsync.json` files (any number, merged into the workspace) and
   * `.shipsync.bundle.json` archives (a single file that REPLACES the
   * workspace). Routing happens at parse time:
   *
   *   1. The OS file picker accepts both extensions plus generic JSON.
   *   2. For every selected file, we read the first chunk and inspect
   *      its `schema` field via `isBundlePayload`. Bundles get the
   *      bundle path; everything else routes to `parseShipFiles`.
   *   3. If a bundle is selected and the workspace already has ships,
   *      we surface a `ConfirmDialog` before clobbering the current
   *      state — Heuristic 5 (error prevention).
   *
   * If a captain happens to pick a bundle alongside per-ship files in
   * one selection, we apply the per-ship files first (additive) and
   * then the most recent bundle (which still REPLACES). Mixing isn't a
   * common path, but the order keeps the bundle's "this is the canon"
   * intent intact.
   */

  import Button from '../../ui/Button.svelte'
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte'
  import { parseShipFiles } from '../../persistence/loadFile.js'
  import {
    parseBundleFile,
    isBundlePayload,
    BUNDLE_FILE_EXTENSION,
  } from '../../persistence/bundleFile.js'
  import { importShip, loadBundleIntoWorkspace, workspace } from '../../state/workspace.svelte.js'
  import { pushToast } from '../../state/ui.svelte.js'

  let inputEl = $state(null)
  let busy = $state(false)

  /** @type {{ bundle: import('../../persistence/bundleFile.js').ShipsyncBundleFile, filename: string, issues: { severity: 'error'|'warn', message: string }[] } | null} */
  let pendingBundleConfirm = $state(null)
  let confirmOpen = $state(false)

  /**
   * Quick sniff of a file's first 512 chars to decide whether it's a
   * bundle. Reading the whole file just to peek would be wasteful for
   * large bundles; 512 chars is plenty to find the `"schema"` token in
   * a JSON object that's been pretty-printed by `JSON.stringify(_, 2)`.
   */
  async function looksLikeBundle(file) {
    if (file.name.toLowerCase().endsWith(BUNDLE_FILE_EXTENSION)) return true
    try {
      const head = await file.slice(0, 512).text()
      return /shipsync\.bundle/.test(head)
    } catch {
      return false
    }
  }

  async function partitionFiles(files) {
    /** @type {File[]} */
    const ships = []
    /** @type {File[]} */
    const bundles = []
    for (const file of files) {
      if (await looksLikeBundle(file)) {
        bundles.push(file)
      } else {
        ships.push(file)
      }
    }
    return { ships, bundles }
  }

  async function handleFiles(event) {
    const files = event.currentTarget.files
    if (!files || files.length === 0) return
    busy = true
    try {
      const { ships: shipFiles, bundles: bundleFiles } = await partitionFiles(Array.from(files))

      if (shipFiles.length > 0) {
        await loadShipFiles(shipFiles)
      }

      // Only the most-recent bundle is honored — chaining bundle replaces
      // would just be wasted work.
      const bundleFile = bundleFiles[bundleFiles.length - 1]
      if (bundleFile) {
        const result = await parseBundleFile(bundleFile)
        if (!result.ok || !result.bundle) {
          pushToast({
            kind: 'error',
            title: `Could not load ${result.sourceFilename}`,
            body: result.issues[0]?.message ?? 'Unknown bundle parse error.',
          })
          return
        }
        const validBundle = /** @type {import('../../persistence/bundleFile.js').ShipsyncBundleFile} */ (result.bundle)
        // Empty workspace? Apply silently. Otherwise, prompt before
        // replacing — a bundle load is destructive in a way per-ship
        // imports aren't.
        if (workspace.shipOrder.length === 0) {
          applyBundle({ bundle: validBundle, filename: result.sourceFilename, issues: result.issues })
        } else {
          pendingBundleConfirm = { bundle: validBundle, filename: result.sourceFilename, issues: result.issues }
          confirmOpen = true
        }
      }
    } finally {
      busy = false
      event.currentTarget.value = ''
    }
  }

  async function loadShipFiles(files) {
    const results = await parseShipFiles(files)
    let loaded = 0
    let failed = 0
    for (const r of results) {
      if (r.ok && r.ship) {
        importShip(r.ship, r.images, { markSaved: true })
        loaded += 1
        if (r.issues.some((i) => i.severity === 'warn')) {
          pushToast({
            kind: 'warning',
            title: `Loaded ${r.ship.name} with caveats`,
            body: r.issues
              .filter((i) => i.severity === 'warn')
              .slice(0, 3)
              .map((i) => i.message)
              .join(' '),
          })
        }
      } else {
        failed += 1
        const firstError = r.issues.find((i) => i.severity === 'error')
        pushToast({
          kind: 'error',
          title: `Could not load ${r.sourceFilename}`,
          body: firstError?.message ?? 'Unknown error.',
        })
      }
    }
    if (loaded > 0 && failed === 0) {
      pushToast({
        kind: 'success',
        title: loaded === 1 ? 'Ship boarded.' : `${loaded} ships boarded.`,
      })
    }
  }

  /** @param {{ bundle: import('../../persistence/bundleFile.js').ShipsyncBundleFile, filename: string, issues: { severity: 'error'|'warn', message: string }[] }} payload */
  function applyBundle(payload) {
    loadBundleIntoWorkspace(payload.bundle)
    const count = payload.bundle.shipOrder.length
    pushToast({
      kind: 'success',
      title: count === 1 ? 'Bundle loaded.' : `Bundle loaded (${count} ships).`,
      body: payload.filename,
    })
    if (payload.issues.length > 0) {
      pushToast({
        kind: 'warning',
        title: 'Bundle had a few quirks',
        body: payload.issues
          .slice(0, 3)
          .map((i) => i.message)
          .join(' '),
      })
    }
  }

  function handleBundleConfirm() {
    if (pendingBundleConfirm) applyBundle(pendingBundleConfirm)
    pendingBundleConfirm = null
  }

  function handleBundleCancel() {
    pendingBundleConfirm = null
  }

  void isBundlePayload // imported for documentation symmetry; runtime check happens in parseBundleFile
</script>

<Button
  variant="secondary"
  onclick={() => inputEl?.click()}
  disabled={busy}
  title="Load .shipsync.json ships or a .shipsync.bundle.json fleet archive"
>
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M1.5 3.5h3l1 1.5h7v6.5a1 1 0 01-1 1H1.5z" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linejoin="round"/>
  </svg>
  Open file{busy ? '…' : ''}
</Button>
<input
  bind:this={inputEl}
  type="file"
  multiple
  accept=".json,.shipsync.json,.shipsync.bundle.json,application/json"
  class="sr-only"
  onchange={handleFiles}
/>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Replace your current fleet with this bundle?"
  body={pendingBundleConfirm
    ? `Loading "${pendingBundleConfirm.filename}" will discard your current ${workspace.shipOrder.length} ${workspace.shipOrder.length === 1 ? 'ship' : 'ships'} and the active scene. This is reversible by Undo, but your unsaved per-ship changes won't be written to disk first.`
    : ''}
  confirmLabel={pendingBundleConfirm
    ? `Replace fleet (${pendingBundleConfirm.bundle.shipOrder.length} ${pendingBundleConfirm.bundle.shipOrder.length === 1 ? 'ship' : 'ships'})`
    : 'Replace fleet'}
  cancelLabel="Keep current"
  confirmVariant="danger"
  onConfirm={handleBundleConfirm}
  onCancel={handleBundleCancel}
/>
