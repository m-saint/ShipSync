<script>
  import { trapFocus } from './focus-trap.js'

  let {
    open = $bindable(false),
    title,
    description = undefined,
    onClose = () => {},
    children,
    footer,
    size = 'md',
  } = $props()

  let dialogEl = $state(null)

  /**
   * Sync the dialog's open state with the native `<dialog>` element and
   * attach the focus trap + Escape backup while it's open. The trap
   * cleanup and listener removal both run when `open` flips back to
   * false (or when the host component unmounts).
   *
   * Escape is normally handled by the native `cancel` event below, but
   * automation harnesses and a few input contexts can suppress it; the
   * window-level keydown listener is a defensive backup so users always
   * get an obvious way out of any modal.
   */
  $effect(() => {
    if (!dialogEl) return
    if (open && !dialogEl.open) {
      dialogEl.showModal()
    } else if (!open && dialogEl.open) {
      dialogEl.close()
    }

    if (!open) return

    const releaseTrap = trapFocus(dialogEl)
    const handleEscape = (/** @type {KeyboardEvent} */ event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      releaseTrap()
      window.removeEventListener('keydown', handleEscape, true)
    }
  })

  function handleClose() {
    open = false
    onClose()
  }

  function handleBackdrop(event) {
    if (event.target === dialogEl) handleClose()
  }

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={handleClose}
  onclick={handleBackdrop}
  oncancel={(e) => {
    e.preventDefault()
    handleClose()
  }}
  class="m-auto p-0 rounded-lg shadow-hold backdrop:bg-ink-900/40 backdrop:backdrop-blur-sm bg-surface-50 text-ink-900 border border-surface-300 w-full {sizeClasses[size] ?? sizeClasses.md}"
  aria-labelledby="dialog-title"
  aria-describedby={description ? 'dialog-desc' : undefined}
>
  <div class="flex flex-col max-h-[80vh]">
    <header class="px-5 py-4 border-b border-surface-200 flex items-start justify-between gap-4">
      <div>
        <h2 id="dialog-title" class="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {#if description}
          <p id="dialog-desc" class="text-sm text-ink-500 mt-0.5">{description}</p>
        {/if}
      </div>
      <button
        type="button"
        class="text-ink-500 hover:text-ink-900 hover:bg-surface-100 rounded-md w-8 h-8 inline-flex items-center justify-center"
        onclick={handleClose}
        aria-label="Close dialog"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </header>
    <div class="px-5 py-4 overflow-y-auto">
      {#if children}{@render children()}{/if}
    </div>
    {#if footer}
      <footer class="px-5 py-3 border-t border-surface-200 flex justify-end gap-2 bg-surface-100/40">
        {@render footer()}
      </footer>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    padding: 0;
  }
</style>
