<script>
  /**
   * Tooltip — viewport-aware hover/focus hint bubble (v1.0.3 rewrite).
   *
   * The bubble used to render as a `position: absolute` sibling of the
   * trigger, which meant any ancestor with `overflow: hidden` (right
   * rail, activity log, dialog body) clipped it; rule hints that overran
   * the trigger's row were unreadable. The fix: render the bubble as a
   * `position: fixed` element so the viewport — not the nearest scrolling
   * ancestor — is its containing block, then place it with
   * `getBoundingClientRect()` on the trigger and a small flip+shift
   * routine so the bubble always lands inside the viewport.
   *
   * Positioning rules:
   *   1. Try the requested placement first.
   *   2. Auto-flip top↔bottom or left↔right if the bubble wouldn't fit
   *      on its preferred side.
   *   3. Clamp the bubble's primary-axis position so it never sticks
   *      out past the viewport edge (with an 8px safety margin).
   *   4. Cap bubble max-width at min(viewport - 32, 320px) so a
   *      long-running hint can never exceed half the screen.
   *
   * Hover/focus/blur control visibility; a small (80ms) hide debounce
   * keeps the bubble open when the cursor crosses a 1-2px gap between
   * the trigger and the bubble. Scrolling or window resize hides the
   * tooltip immediately because the cached trigger rect would otherwise
   * go stale and the bubble would float away from its anchor.
   */

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

  let triggerEl = $state(/** @type {HTMLElement | null} */ (null))
  let bubbleEl = $state(/** @type {HTMLElement | null} */ (null))

  let top = $state(0)
  let left = $state(0)
  // Placement chosen by `reposition()`; may differ from the requested
  // `placement` prop after auto-flip near a viewport edge. The literal
  // default is overwritten on the first frame the bubble becomes visible
  // (see the rAF-driven `$effect` below), so users never see this value.
  let actualPlacement = $state(/** @type {'top'|'bottom'|'left'|'right'} */ ('top'))

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

  function hideImmediate() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = 0
    }
    visible = false
  }

  /**
   * Compute the bubble's fixed-coordinate position. Runs whenever the
   * tooltip becomes visible (after the bubble has been mounted so we
   * can measure its actual size).
   *
   * Margin = 8px buffer between the trigger edge and the bubble, plus
   * 8px breathing room from the viewport edge during clamping.
   */
  function reposition() {
    if (!triggerEl || !bubbleEl) return
    const triggerRect = triggerEl.getBoundingClientRect()
    const bubbleRect = bubbleEl.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    let chosen = placement
    if (chosen === 'top' && triggerRect.top - bubbleRect.height - margin < margin) {
      chosen = 'bottom'
    } else if (chosen === 'bottom' && triggerRect.bottom + bubbleRect.height + margin > vh - margin) {
      chosen = 'top'
    } else if (chosen === 'left' && triggerRect.left - bubbleRect.width - margin < margin) {
      chosen = 'right'
    } else if (chosen === 'right' && triggerRect.right + bubbleRect.width + margin > vw - margin) {
      chosen = 'left'
    }

    let nextTop
    let nextLeft

    if (chosen === 'top') {
      nextTop = triggerRect.top - bubbleRect.height - margin
      nextLeft = triggerRect.left + triggerRect.width / 2 - bubbleRect.width / 2
    } else if (chosen === 'bottom') {
      nextTop = triggerRect.bottom + margin
      nextLeft = triggerRect.left + triggerRect.width / 2 - bubbleRect.width / 2
    } else if (chosen === 'left') {
      nextTop = triggerRect.top + triggerRect.height / 2 - bubbleRect.height / 2
      nextLeft = triggerRect.left - bubbleRect.width - margin
    } else {
      nextTop = triggerRect.top + triggerRect.height / 2 - bubbleRect.height / 2
      nextLeft = triggerRect.right + margin
    }

    nextLeft = Math.max(margin, Math.min(nextLeft, vw - bubbleRect.width - margin))
    nextTop = Math.max(margin, Math.min(nextTop, vh - bubbleRect.height - margin))

    actualPlacement = chosen
    top = nextTop
    left = nextLeft
  }

  $effect(() => {
    if (!visible) return
    // Defer one frame so the bubble is mounted and we can measure it.
    const id = requestAnimationFrame(reposition)
    return () => cancelAnimationFrame(id)
  })

  $effect(() => {
    if (!visible || typeof window === 'undefined') return
    const onScrollOrResize = () => hideImmediate()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  })

  let wrapperTag = $derived(display === 'block' ? 'div' : 'span')
  let wrapperClass = $derived(
    display === 'block' ? 'relative block' : 'relative inline-flex',
  )

  // Viewport-relative max width — the inline style overrides whatever
  // `max-w-*` utility the caller passed via `bubbleClass`.
  let bubbleMaxWidth = $derived('min(calc(100vw - 32px), 320px)')
</script>

<!--
  The wrapper is a passive hover/focus surrogate; the interactive
  controls live inside as children and carry their own roles. Adding
  a role here would mislead screen readers. The pointer/focus
  listeners attached are observation-only — they don't change page
  state, only the local `visible` flag.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element
  this={wrapperTag}
  bind:this={triggerEl}
  class={wrapperClass}
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  {#if children}{@render children()}{/if}
</svelte:element>

{#if visible && text}
  <span
    bind:this={bubbleEl}
    role="tooltip"
    data-placement={actualPlacement}
    style="top: {top}px; left: {left}px; max-width: {bubbleMaxWidth};"
    class="fixed z-[60] rounded-md bg-ink-900 px-2 py-1.5 text-xs leading-snug text-ink-50 shadow-deck pointer-events-none {bubbleClass}"
  >
    {text}
  </span>
{/if}
