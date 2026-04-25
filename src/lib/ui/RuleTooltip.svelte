<script>
  import Tooltip from './Tooltip.svelte'

  let {
    /** The hint text shown on hover/focus. Keep it gentle — no rule citations. */
    hint,
    /** Layout mode for the wrapper: `'inline'` (default) or `'block'`. */
    display = 'inline-flex',
    /** Pass a max-width utility (e.g. 'max-w-xs') so longer tips wrap nicely. */
    bubbleClass = 'max-w-xs whitespace-normal text-left',
    placement = 'top',
    children,
  } = $props()
</script>

<Tooltip text={hint} {display} {placement} {bubbleClass}>
  {#if children}{@render children()}{/if}
</Tooltip>
