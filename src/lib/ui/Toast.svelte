<script>
  import { ui, dismissToast } from '../state/ui.svelte.js'

  const kindClasses = {
    info: 'border-tide-300 bg-tide-50 text-tide-700',
    success: 'border-sea-300 bg-sea-50 text-sea-700',
    warning: 'border-amber-300 bg-amber-50 text-amber-700',
    error: 'border-crimson-300 bg-crimson-50 text-crimson-700',
  }
</script>

<!--
  The outer container is rendered unconditionally so the aria-live
  region exists in the DOM *before* the first toast appears. Screen
  readers only announce content added to a live region that was
  already present when the announcement happened — gating the
  container on `ui.toasts.length > 0` would cause the very first
  toast to land silently. Pointer-events stay none on the container
  so the empty region never absorbs clicks.
-->
<div
  class="pointer-events-none fixed inset-0 z-[60] flex flex-col items-end justify-end gap-2 p-4"
  role="region"
  aria-label="Notifications"
  aria-live="polite"
  aria-relevant="additions text"
>
  {#each ui.toasts as toast (toast.id)}
    <div
      class="pointer-events-auto min-w-[280px] max-w-[420px] rounded-md border shadow-deck px-4 py-3 {kindClasses[toast.kind] ?? kindClasses.info}"
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
    >
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <div class="font-medium text-sm">{toast.title}</div>
          {#if toast.body}
            <div class="text-sm opacity-90 mt-0.5">{toast.body}</div>
          {/if}
        </div>
        <button
          type="button"
          class="text-current opacity-60 hover:opacity-100 -mr-1 -mt-1 w-6 h-6 inline-flex items-center justify-center rounded"
          onclick={() => dismissToast(toast.id)}
          aria-label="Dismiss notification"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  {/each}
</div>
