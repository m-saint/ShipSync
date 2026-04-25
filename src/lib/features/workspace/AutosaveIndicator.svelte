<script>
  let {
    state = 'idle',
    lastSavedAt = null,
    imagesStripped = false,
    onretry = /** @type {(() => void) | null} */ (null),
  } = $props()

  let label = $derived.by(() => {
    if (state === 'saving') return 'Saving locally…'
    if (state === 'error') return 'Local save failed'
    if (lastSavedAt) {
      try {
        const d = new Date(lastSavedAt)
        return `Local save · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      } catch {
        return 'Local save'
      }
    }
    return 'No local save yet'
  })

  let dotClass = $derived.by(() => {
    if (state === 'saving') return 'bg-amber-500 animate-pulse'
    if (state === 'error') return 'bg-crimson-500'
    if (lastSavedAt) return 'bg-sea-500'
    return 'bg-surface-300'
  })

  let title = $derived.by(() => {
    const parts = []
    if (state === 'error') {
      parts.push('Local autosave write failed — usually a full storage quota.')
    } else if (lastSavedAt) {
      parts.push(`Last local autosave at ${new Date(lastSavedAt).toLocaleString()}.`)
    }
    if (imagesStripped) parts.push('Images were dropped because storage was full; reload ship files to restore portraits.')
    parts.push('Autosave is for crash recovery only. Use Save to write a `.shipsync.json` file.')
    return parts.join(' ')
  })
</script>

<div
  class="inline-flex items-center gap-2 text-xs text-ink-500"
  aria-label={title}
  title={title}
>
  <span class="w-2 h-2 rounded-full {dotClass}" aria-hidden="true"></span>
  <span>{label}</span>
  {#if imagesStripped}
    <span class="text-amber-700 font-medium">(no images)</span>
  {/if}
  {#if state === 'error' && onretry}
    <button
      type="button"
      class="ml-1 px-1.5 h-6 rounded text-xs font-medium text-crimson-700 hover:bg-crimson-50 focus:outline-none focus:ring-2 focus:ring-crimson-300"
      onclick={onretry}
      title="Try the local autosave write again."
    >
      Retry
    </button>
  {/if}
</div>
