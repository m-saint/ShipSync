<script>
  import { undo, redo, undoableCount, redoableCount } from '../../state/workspace.svelte.js'
  import { shortcutHint } from '../../ui/platform.js'

  let undoCount = $derived(undoableCount())
  let redoCount = $derived(redoableCount())

  const undoShortcut = shortcutHint('Z')
  const redoShortcut = shortcutHint('Z', { shift: true })
</script>

<div class="inline-flex items-center rounded-md border border-surface-300 bg-surface-50 overflow-hidden">
  <button
    type="button"
    class="w-8 h-8 inline-flex items-center justify-center text-ink-700 hover:bg-surface-100 disabled:opacity-40 disabled:cursor-not-allowed"
    onclick={undo}
    disabled={undoCount === 0}
    aria-label="Undo last action"
    title={undoCount === 0
      ? `Nothing to undo (${undoShortcut})`
      : `Undo · ${undoShortcut} · ${undoCount} step${undoCount === 1 ? '' : 's'} available`}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3.5 7l3-3M3.5 7l3 3M3.5 7H9a3 3 0 013 3v.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <button
    type="button"
    class="w-8 h-8 inline-flex items-center justify-center text-ink-700 hover:bg-surface-100 disabled:opacity-40 disabled:cursor-not-allowed border-l border-surface-300"
    onclick={redo}
    disabled={redoCount === 0}
    aria-label="Redo last action"
    title={redoCount === 0
      ? `Nothing to redo (${redoShortcut})`
      : `Redo · ${redoShortcut} · ${redoCount} step${redoCount === 1 ? '' : 's'} available`}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M10.5 7l-3-3M10.5 7l-3 3M10.5 7H5a3 3 0 00-3 3v.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
</div>
