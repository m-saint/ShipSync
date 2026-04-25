<script>
  let {
    variant = 'primary',
    size = 'md',
    type = 'button',
    fullWidth = false,
    disabled = false,
    loading = false,
    title = undefined,
    onclick,
    children,
    ...rest
  } = $props()

  const baseClasses =
    'inline-flex items-center justify-center gap-2 font-medium transition-colors duration-100 ' +
    'border rounded-md focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60'

  const variantClasses = {
    primary:
      'bg-brass-500 hover:bg-brass-600 active:bg-brass-700 border-brass-600 text-ink-50 shadow-sail',
    secondary:
      'bg-surface-50 hover:bg-surface-100 active:bg-surface-200 border-surface-300 text-ink-900',
    ghost: 'bg-transparent hover:bg-surface-100 border-transparent text-ink-700',
    danger:
      'bg-crimson-500 hover:bg-crimson-700 border-crimson-700 text-ink-50 shadow-sail',
  }

  const sizeClasses = {
    sm: 'h-8 px-2.5 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-5 text-base',
  }

  let composed = $derived(
    [
      baseClasses,
      variantClasses[variant] ?? variantClasses.primary,
      sizeClasses[size] ?? sizeClasses.md,
      fullWidth ? 'w-full' : '',
    ].join(' '),
  )
</script>

<button
  {type}
  class={composed}
  disabled={disabled || loading}
  aria-busy={loading || undefined}
  {title}
  {onclick}
  {...rest}
>
  {#if loading}
    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
  {/if}
  {#if children}{@render children()}{/if}
</button>
