<script>
  /**
   * PrintFleetButton — workspace-level affordance to open the fleet print
   * sheet in a new browser tab. The new tab hydrates from the local autosave
   * (see FleetPrintView), so the user keeps their dashboard tab intact and
   * can immediately Cmd+P from the print tab to send the entire workspace
   * through one print job.
   *
   * Disabled when the workspace is empty — there's nothing to print, and the
   * print view itself shows the same "no ships" empty state if you arrive
   * there via the URL anyway. Disabling here avoids the surprise of clicking
   * a button only to learn the workspace was empty.
   */

  import Button from '../../ui/Button.svelte'
  import { workspace } from '../../state/workspace.svelte.js'
  import { shortcutHint } from '../../ui/platform.js'

  let count = $derived(workspace.shipOrder.length)
  let disabled = $derived(count === 0)

  const PRINT_FLEET_SHORTCUT = shortcutHint('P', { shift: true })

  let title = $derived.by(() => {
    if (count === 0) {
      return `Load at least one ship to print the fleet (${PRINT_FLEET_SHORTCUT}).`
    }
    return `Open a print-ready sheet for each of the ${count} ship${count === 1 ? '' : 's'} aboard · ${PRINT_FLEET_SHORTCUT}. One Cmd+P inside the print tab sends them all.`
  })

  function openFleetPrint() {
    if (typeof window === 'undefined' || disabled) return
    window.open(`${window.location.pathname}?print=fleet`, '_blank', 'noopener')
  }
</script>

<Button
  variant="secondary"
  size="md"
  onclick={openFleetPrint}
  {disabled}
  {title}
>
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M3.5 5V2h7v3M3.5 9h7v3.5h-7zM2 5h10v4h-1.5"
      stroke="currentColor"
      stroke-width="1.25"
      fill="none"
      stroke-linejoin="round"
    />
  </svg>
  Print fleet
</Button>
