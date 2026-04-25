<script>
  /**
   * Reusable confirm/cancel modal built on Dialog.svelte.
   *
   * Use for destructive-ish actions where a two-click inline confirm
   * isn't enough — currently the Remove-from-workspace path
   * (ShipDetail) and any future "are you sure?" gate. The dialog
   * inherits Dialog's centralized Escape handling, focus trap, and
   * backdrop dismiss; cancelling with Escape or backdrop counts as
   * Cancel (no `onConfirm` fire).
   *
   * The default `confirmVariant` is "danger" because every existing
   * caller in the app is asking before discarding state. Pass
   * `confirmVariant="primary"` (or `"ghost"`) for non-destructive
   * confirmations like "save and proceed".
   */

  import Dialog from './Dialog.svelte'
  import Button from './Button.svelte'

  let {
    open = $bindable(false),
    title,
    description = undefined,
    body = undefined,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmVariant = 'danger',
    onConfirm = () => {},
    onCancel = () => {},
  } = $props()

  function handleConfirm() {
    open = false
    onConfirm()
  }

  function handleCancel() {
    open = false
    onCancel()
  }
</script>

<Dialog
  bind:open
  {title}
  {description}
  size="sm"
  onClose={handleCancel}
>
  {#if body}
    <p class="text-sm text-ink-700 leading-relaxed whitespace-pre-line">{body}</p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={handleCancel}>{cancelLabel}</Button>
    <Button variant={confirmVariant} onclick={handleConfirm}>{confirmLabel}</Button>
  {/snippet}
</Dialog>
