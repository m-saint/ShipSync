<script>
  import WorkspaceTopBar from '../lib/features/workspace/WorkspaceTopBar.svelte'
  import LoadedShipsRail from '../lib/features/fleet/LoadedShipsRail.svelte'
  import ShipDetail from '../lib/features/ship/ShipDetail.svelte'
  import ScenePanel from '../lib/features/scene/ScenePanel.svelte'
  import ActivityLog from '../lib/features/activityLog/ActivityLog.svelte'
  import AddShipDialog from '../lib/features/fleet/AddShipDialog.svelte'
  import ShoreLeaveDialog from '../lib/features/fleet/ShoreLeaveDialog.svelte'
  import ApplyFlagDialog from '../lib/features/ship/ApplyFlagDialog.svelte'
  import SettingsDialog from '../lib/features/workspace/SettingsDialog.svelte'
  import Toast from '../lib/ui/Toast.svelte'
  import Button from '../lib/ui/Button.svelte'
  import {
    workspace,
    hydrateFromSnapshot,
    undo,
    redo,
    getFocusedShip,
  } from '../lib/state/workspace.svelte.js'
  import {
    readAutosave,
    readAutosaveMeta,
    clearAutosave,
    makeAutosaver,
  } from '../lib/persistence/autosave.js'
  import {
    ui,
    showResumeBanner,
    dismissResumeBanner,
    pushToast,
    openDialog,
  } from '../lib/state/ui.svelte.js'
  import { settings } from '../lib/state/settings.svelte.js'
  import { downloadShipFile } from '../lib/persistence/shipFile.js'
  import { saveAllDirtyShips } from '../lib/persistence/saveAllShips.js'
  import { downloadBundleFile } from '../lib/persistence/bundleFile.js'
  import { markShipSaved } from '../lib/state/workspace.svelte.js'

  let autosaveState = $state(/** @type {'idle'|'saving'|'error'} */ ('idle'))
  let autosaveMeta = $state(/** @type {import('../lib/persistence/autosave.js').AutosaveMeta|null} */ (null))

  const autosaver = makeAutosaver(
    () => JSON.parse(JSON.stringify($state.snapshot(workspace))),
    {
      // Read live so the SettingsDialog's "Autosave cadence" choice
      // applies on the next mutation without re-creating the autosaver.
      debounceMs: () => settings.autosaveDebounceMs,
      onWrite: (meta) => {
        autosaveState = 'idle'
        autosaveMeta = meta
      },
      onError: () => {
        autosaveState = 'error'
      },
    },
  )

  /**
   * Retry handler for the autosave indicator. Flips the indicator to 'saving'
   * to give immediate feedback, then synchronously re-runs the write — the
   * onWrite/onError callbacks above flip the state back to 'idle' or 'error'.
   */
  function retryAutosave() {
    autosaveState = 'saving'
    try {
      autosaver.flushNow()
    } catch {
      autosaveState = 'error'
    }
  }

  let resumeSnapshot = $state(/** @type {object|null} */ (null))

  // Boot: check for autosave to offer Resume.
  $effect(() => {
    if (typeof window === 'undefined') return
    const snap = readAutosave()
    const meta = readAutosaveMeta()
    if (snap && meta) {
      const hasContent = snap.shipOrder?.length > 0
      if (hasContent) {
        resumeSnapshot = snap
        showResumeBanner(meta.savedAt)
      } else {
        clearAutosave()
      }
    }
  })

  // Autosave on every workspace mutation.
  $effect(() => {
    void $state.snapshot(workspace)
    autosaveState = 'saving'
    autosaver.schedule()
  })

  // Keyboard shortcuts: Cmd/Ctrl+S, Cmd/Ctrl+Shift+P, Cmd/Ctrl+Shift+L,
  // Cmd/Ctrl+Shift+B, Cmd/Ctrl+`,`, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z (or
  // Cmd/Ctrl+Y). Cmd/Ctrl+P alone is intentionally NOT intercepted — the
  // user expects native print on the active document; the fleet shortcut
  // takes the Shift modifier to opt in to the multi-ship print tab path.
  // Same shape for L: Cmd/Ctrl+L is the browser's address-bar shortcut, so
  // we add Shift on top to opt into the shore-leave dialog without
  // colliding. B follows the same Shift-on-top pattern for symmetry with
  // S/P/L (one canonical "save / print / refit / archive" family). The
  // bare-meta-comma shortcut is the conventional macOS / VSCode preferences
  // shortcut; no browser action sits on it, so we don't need the Shift
  // modifier for collision avoidance.
  $effect(() => {
    if (typeof window === 'undefined') return
    function onKey(event) {
      const meta = event.metaKey || event.ctrlKey
      if (!meta) return
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        // Cmd/Ctrl + Shift + S → save every dirty ship.
        // Cmd/Ctrl + S        → save just the focused ship.
        if (event.shiftKey) {
          saveAllDirtyShips()
          return
        }
        const ship = getFocusedShip()
        if (!ship) {
          pushToast({
            kind: 'info',
            title: 'Nothing focused to save',
            body: 'Pick a ship from the rail and try again.',
          })
          return
        }
        try {
          const filename = downloadShipFile(ship, workspace.images)
          markShipSaved(ship.id)
          pushToast({ kind: 'success', title: 'Ship saved.', body: filename })
        } catch (e) {
          pushToast({
            kind: 'error',
            title: 'Could not save ship',
            body: e instanceof Error ? e.message : String(e),
          })
        }
      } else if ((event.key === 'p' || event.key === 'P') && event.shiftKey) {
        // Cmd/Ctrl + Shift + P → open the fleet print sheet in a new tab.
        // Mirrors the Save All shortcut: same modifier shape, parallel toast
        // on empty workspace, action gates on `shipOrder.length` to match the
        // PrintFleetButton's disabled state. The new tab path is a
        // window.open() call rather than a route navigation so the dashboard
        // stays put — the player can keep editing while a print job is queued.
        event.preventDefault()
        if (workspace.shipOrder.length === 0) {
          pushToast({
            kind: 'info',
            title: 'Nothing to print',
            body: 'Load at least one ship before printing the fleet.',
          })
          return
        }
        window.open(`${window.location.pathname}?print=fleet`, '_blank', 'noopener')
      } else if ((event.key === 'l' || event.key === 'L') && event.shiftKey) {
        // Cmd/Ctrl + Shift + L → open the Shore leave dialog. Mirrors the
        // Save All / Print fleet shortcuts: same modifier shape, parallel
        // toast on empty workspace, action gates on `shipOrder.length` to
        // match the toolbar button's disabled state.
        event.preventDefault()
        if (workspace.shipOrder.length === 0) {
          pushToast({
            kind: 'info',
            title: 'No ships aboard',
            body: 'Load at least one ship before calling shore leave.',
          })
          return
        }
        openDialog('shore-leave')
      } else if ((event.key === 'b' || event.key === 'B') && event.shiftKey) {
        // Cmd/Ctrl + Shift + B → save the workspace as a bundle. Mirrors
        // the Save All / Print fleet / Shore leave shape — same modifier
        // skeleton, same empty-workspace toast, action gates on
        // `shipOrder.length` to match SaveBundleButton's disabled state.
        // The bundle write is inlined here (rather than calling into
        // SaveBundleButton's handler) for the same reason Cmd+S inlines
        // its own save: the shortcut should work even when the toolbar
        // button is offscreen or unmounted.
        event.preventDefault()
        if (workspace.shipOrder.length === 0) {
          pushToast({
            kind: 'info',
            title: 'No ships aboard',
            body: 'Load at least one ship before saving a bundle.',
          })
          return
        }
        try {
          const filename = downloadBundleFile({
            ships: $state.snapshot(workspace.ships),
            shipOrder: [...workspace.shipOrder],
            scene: $state.snapshot(workspace.scene),
            images: $state.snapshot(workspace.images),
          })
          pushToast({
            kind: 'success',
            title: 'Bundle saved.',
            body: `Wrote ${filename}.`,
          })
        } catch (e) {
          pushToast({
            kind: 'error',
            title: 'Bundle save failed.',
            body: e instanceof Error ? e.message : 'Could not write the bundle file.',
          })
        }
      } else if (event.key === ',' && !event.shiftKey) {
        // Cmd/Ctrl + `,` → open the Preferences dialog. Conventional
        // macOS / VSCode shortcut; no browser action sits on it, so no
        // Shift modifier is needed. The dialog is its own visible
        // confirmation — no toast — and the action has no preconditions
        // (preferences are workspace-independent).
        event.preventDefault()
        openDialog('settings')
      } else if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Flush autosave on unload so we never miss the last edit.
  $effect(() => {
    if (typeof window === 'undefined') return
    function flushNow() {
      try {
        autosaver.flushNow()
      } catch {
        // ignore
      }
    }
    window.addEventListener('beforeunload', flushNow)
    return () => window.removeEventListener('beforeunload', flushNow)
  })

  function restoreFromAutosave() {
    if (!resumeSnapshot) return
    hydrateFromSnapshot(resumeSnapshot)
    resumeSnapshot = null
    dismissResumeBanner()
    pushToast({
      kind: 'success',
      title: 'Workspace restored.',
      body: 'Picked up from your last local autosave.',
    })
  }

  function discardAutosave() {
    resumeSnapshot = null
    clearAutosave()
    dismissResumeBanner()
  }
</script>

<div class="h-dvh flex flex-col overflow-hidden bg-surface-50 text-ink-900">
  <WorkspaceTopBar {autosaveState} {autosaveMeta} onAutosaveRetry={retryAutosave} />

  {#if ui.resumeBanner.visible}
    <div
      class="px-4 py-2 bg-amber-50 border-b border-amber-300 text-amber-700 flex items-center justify-between gap-4"
      role="region"
      aria-label="Resume previous session"
    >
      <div class="text-sm">
        <span class="font-medium">Welcome back.</span>
        Your last local autosave is from
        <time datetime={ui.resumeBanner.lastSavedAt}>
          {ui.resumeBanner.lastSavedAt
            ? new Date(ui.resumeBanner.lastSavedAt).toLocaleString()
            : ''}
        </time>.
        Restore it, or start with a fresh dashboard.
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" onclick={discardAutosave}>Start fresh</Button>
        <Button variant="primary" size="sm" onclick={restoreFromAutosave}>Restore</Button>
      </div>
    </div>
  {/if}

  <div class="flex-1 flex min-h-0 overflow-x-auto">
    <LoadedShipsRail />
    <ShipDetail />
    <aside
      class="surface-rail-right w-80 shrink-0 flex flex-col min-h-0"
      aria-label="Scene and log"
    >
      <ScenePanel />
      <ActivityLog />
    </aside>
  </div>
</div>

<AddShipDialog />
<ShoreLeaveDialog />
<ApplyFlagDialog />
<SettingsDialog />
<Toast />
