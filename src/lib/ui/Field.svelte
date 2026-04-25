<script>
  let {
    label,
    helpText = '',
    errorText = '',
    required = false,
    htmlFor,
    children,
  } = $props()
</script>

<div class="flex flex-col gap-1.5">
  <label for={htmlFor} class="text-sm font-medium text-ink-700">
    {label}
    {#if required}
      <span class="text-crimson-500" aria-hidden="true" title="Required">*</span>
    {/if}
  </label>
  {#if children}{@render children()}{/if}
  {#if errorText}
    <p class="text-xs text-crimson-500" role="alert">{errorText}</p>
  {:else if helpText}
    <p class="text-xs text-ink-500">{helpText}</p>
  {/if}
</div>
