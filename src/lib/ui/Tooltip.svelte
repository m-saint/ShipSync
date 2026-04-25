<script>
  let {
    text,
    placement = 'top',
    /** Pass `'block'` to wrap a block-level child without forcing it inline. */
    display = 'inline-flex',
    /** Allow long tips to wrap by passing a max-width Tailwind utility, e.g. 'max-w-xs'. */
    bubbleClass = 'whitespace-nowrap',
    children,
  } = $props()

  let visible = $state(false)
  let hideTimer = 0

  function show() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
    visible = true
  }

  function hide() {
    hideTimer = window.setTimeout(() => {
      visible = false
      hideTimer = 0
    }, 80)
  }

  const placementClasses = {
    top: 'bottom-full mb-1.5 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-1.5 left-1/2 -translate-x-1/2',
    left: 'right-full mr-1.5 top-1/2 -translate-y-1/2',
    right: 'left-full ml-1.5 top-1/2 -translate-y-1/2',
  }

  let wrapperTag = $derived(display === 'block' ? 'div' : 'span')
  let wrapperClass = $derived(
    display === 'block' ? 'relative block' : 'relative inline-flex',
  )
</script>

<svelte:element
  this={wrapperTag}
  class={wrapperClass}
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {#if children}{@render children()}{/if}
  {#if visible && text}
    <span
      role="tooltip"
      class="absolute z-50 rounded-md bg-ink-900 px-2 py-1.5 text-xs leading-snug text-ink-50 shadow-deck pointer-events-none {bubbleClass} {placementClasses[placement] ?? placementClasses.top}"
    >
      {text}
    </span>
  {/if}
</svelte:element>
