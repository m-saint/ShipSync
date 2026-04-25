<script>
  let {
    title,
    body = '',
    icon,
    action,
    align = 'center',
  } = $props()
</script>

<div class="flex flex-col gap-3 px-6 py-10 {align === 'center' ? 'items-center text-center' : 'items-start text-left'}">
  {#if icon}
    <div class="text-brass-500 opacity-80">{@render icon()}</div>
  {/if}
  <h3 class="display text-lg text-ink-900">{title}</h3>
  {#if body}
    <p class="text-sm text-ink-500 max-w-sm">{body}</p>
  {/if}
  {#if action}
    <div class="mt-2">{@render action()}</div>
  {/if}
</div>
