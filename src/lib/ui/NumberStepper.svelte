<script>
  let {
    value = $bindable(0),
    min = -Infinity,
    max = Infinity,
    step = 1,
    id,
    ariaLabel = undefined,
    disabled = false,
    /**
     * Optional accent tone. Use `'amber'` for warning states (e.g. Grub
     * running dry) and `'crimson'` for alarm states (e.g. Gap hits zero in
     * a pursuit — the chase just became a fight). `'sea'` is reserved for
     * the milder "good news" case (Gap escaped). All three pick up matching
     * border, background, and inner-divider colors.
     */
    tone = /** @type {'neutral'|'amber'|'crimson'|'sea'} */ ('neutral'),
    /**
     * When true, the numeric input is focused and its current value selected
     * on mount. Intended for cases where a stepper appears as the first
     * interactive element of an inline panel (e.g. the damage / repair
     * composers) so a keyboard user can immediately type a new value over
     * the placeholder zero. The select() makes type-over feel native instead
     * of forcing a manual select-all gesture before typing.
     */
    autofocus = false,
    onchange,
  } = $props()

  let inputEl = $state(/** @type {HTMLInputElement | null} */ (null))

  $effect(() => {
    if (autofocus && inputEl) {
      inputEl.focus()
      inputEl.select()
    }
  })

  function clamp(n) {
    if (Number.isNaN(n)) return 0
    return Math.max(min, Math.min(max, n))
  }

  function bump(delta) {
    const next = clamp(Number(value) + delta)
    if (next !== value) {
      value = next
      onchange?.(next)
    }
  }

  function onInput(event) {
    const raw = event.currentTarget.value
    if (raw === '' || raw === '-') return
    const n = clamp(Number(raw))
    if (n !== value) {
      value = n
      onchange?.(n)
    }
  }

  // Outer wrapper border + background per tone.
  let toneClass = $derived.by(() => {
    if (tone === 'amber') return 'border-amber-400 bg-amber-50'
    if (tone === 'crimson') return 'border-crimson-700 bg-crimson-50'
    if (tone === 'sea') return 'border-sea-500 bg-surface-50'
    return 'border-surface-300 bg-surface-50'
  })
  // Inner left/right dividers for the numeric input track.
  let innerDividerClass = $derived.by(() => {
    if (tone === 'amber') return 'border-amber-400'
    if (tone === 'crimson') return 'border-crimson-700'
    if (tone === 'sea') return 'border-sea-500'
    return 'border-surface-300'
  })
</script>

<div class={`inline-flex items-center rounded-md border overflow-hidden ${toneClass}`}>
  <button
    type="button"
    class="w-8 h-9 flex items-center justify-center text-ink-700 hover:bg-surface-100 disabled:opacity-50 disabled:cursor-not-allowed"
    onclick={() => bump(-step)}
    disabled={disabled || value <= min}
    aria-label={ariaLabel ? `Decrease ${ariaLabel}` : 'Decrease'}
  >
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
  <input
    bind:this={inputEl}
    {id}
    type="number"
    class={`w-16 h-9 text-center bg-transparent border-x ${innerDividerClass} text-sm font-medium text-ink-900 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none`}
    value={value}
    {min}
    {max}
    {step}
    {disabled}
    aria-label={ariaLabel}
    oninput={onInput}
  />
  <button
    type="button"
    class="w-8 h-9 flex items-center justify-center text-ink-700 hover:bg-surface-100 disabled:opacity-50 disabled:cursor-not-allowed"
    onclick={() => bump(step)}
    disabled={disabled || value >= max}
    aria-label={ariaLabel ? `Increase ${ariaLabel}` : 'Increase'}
  >
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6h8M6 2v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>
</div>
