<script>
  /**
   * SettingsDialog — v1.0 preferences panel.
   *
   * Lives in the WorkspaceTopBar (gear icon) and surfaces the three
   * cross-cutting controls that make up the v1.0 preferences slate:
   *   1. Color scheme — Auto / Light / Dark, with live preview through the
   *      `data-color-scheme` attribute on `<html>` (see App.svelte's
   *      effect). "Auto" follows OS `prefers-color-scheme`.
   *   2. Density — Comfortable (the original spacing) or Compact (tighter
   *      ship/officer card padding + stepper heights). Routed through a
   *      single `data-density` attribute on the body so any surface can
   *      opt into Tailwind's `data-[density=compact]:` variants.
   *   3. Autosave cadence — picks one of the AUTOSAVE_PRESETS values that
   *      drives the existing debounce in Dashboard.svelte. The setting is
   *      read on every `schedule()` call (not at autosaver construction)
   *      so changing it here applies on the next mutation.
   *
   * No commit/undo plumbing — these settings live in localStorage, not in
   * the workspace, so they're not part of the per-session history. A
   * "Restore defaults" button (right-aligned in the footer) provides an
   * explicit reset path so a user can always get back to the v1.0 baseline.
   */

  import Dialog from '../../ui/Dialog.svelte'
  import Button from '../../ui/Button.svelte'
  import Field from '../../ui/Field.svelte'
  import { ui, closeDialog } from '../../state/ui.svelte.js'
  import {
    settings,
    setColorScheme,
    setDensity,
    setAutosaveDebounceMs,
    setCarryOverOnCharter,
    resetSettings,
    AUTOSAVE_PRESETS,
  } from '../../state/settings.svelte.js'

  let open = $derived(ui.openDialog === 'settings')

  function handleClose() {
    if (ui.openDialog === 'settings') closeDialog()
  }

  /**
   * The three color-scheme choices. The "Auto" label is qualified so the
   * user knows what "Auto" means without needing a separate tooltip; the
   * dialog itself is sparse so cramming the explanation here is fine.
   */
  const COLOR_SCHEMES = /** @type {const} */ ([
    { value: 'auto', label: 'Auto', sub: 'Follow OS' },
    { value: 'light', label: 'Light', sub: 'Always' },
    { value: 'dark', label: 'Dark', sub: 'Always' },
  ])

  /** Density presets. */
  const DENSITIES = /** @type {const} */ ([
    { value: 'comfortable', label: 'Comfortable', sub: 'Default spacing' },
    { value: 'compact', label: 'Compact', sub: 'Tighter cards' },
  ])
</script>

<Dialog
  bind:open
  title="Preferences"
  description="Settings that persist across sessions on this device. Saved automatically."
  size="md"
  onClose={handleClose}
>
  <div class="flex flex-col gap-5">
    <Field label="Color scheme" helpText="Dark mode swaps to a hand-tuned dark palette so dialogs, popovers, and portraits all follow along.">
      <div
        class="inline-flex rounded-md border border-surface-300 bg-surface-50 p-0.5"
        role="radiogroup"
        aria-label="Color scheme"
      >
        {#each COLOR_SCHEMES as option (option.value)}
          <button
            type="button"
            role="radio"
            aria-checked={settings.colorScheme === option.value}
            class="px-3 h-9 rounded text-xs font-medium transition-colors flex flex-col items-center justify-center {settings.colorScheme === option.value
              ? 'bg-ink-900 text-ink-50'
              : 'text-ink-700 hover:bg-surface-100'}"
            onclick={() => setColorScheme(option.value)}
          >
            <span class="leading-none">{option.label}</span>
            <span class="text-[10px] opacity-70 leading-none mt-0.5">{option.sub}</span>
          </button>
        {/each}
      </div>
    </Field>

    <Field label="Density" helpText="Compact tightens ship and officer cards by ~25%. Useful on smaller screens or once a fleet exceeds half a dozen ships.">
      <div
        class="inline-flex rounded-md border border-surface-300 bg-surface-50 p-0.5"
        role="radiogroup"
        aria-label="Density"
      >
        {#each DENSITIES as option (option.value)}
          <button
            type="button"
            role="radio"
            aria-checked={settings.density === option.value}
            class="px-3 h-9 rounded text-xs font-medium transition-colors flex flex-col items-center justify-center {settings.density === option.value
              ? 'bg-ink-900 text-ink-50'
              : 'text-ink-700 hover:bg-surface-100'}"
            onclick={() => setDensity(option.value)}
          >
            <span class="leading-none">{option.label}</span>
            <span class="text-[10px] opacity-70 leading-none mt-0.5">{option.sub}</span>
          </button>
        {/each}
      </div>
    </Field>

    <Field
      label="Autosave cadence"
      helpText="How long to wait after the last edit before writing a fresh autosave snapshot. A longer cadence reduces localStorage churn; a shorter one minimizes data loss on crash."
    >
      <div
        class="inline-flex flex-wrap rounded-md border border-surface-300 bg-surface-50 p-0.5"
        role="radiogroup"
        aria-label="Autosave cadence"
      >
        {#each AUTOSAVE_PRESETS as preset (preset.value)}
          <button
            type="button"
            role="radio"
            aria-checked={settings.autosaveDebounceMs === preset.value}
            class="px-3 h-9 rounded text-xs font-medium transition-colors {settings.autosaveDebounceMs === preset.value
              ? 'bg-ink-900 text-ink-50'
              : 'text-ink-700 hover:bg-surface-100'}"
            onclick={() => setAutosaveDebounceMs(preset.value)}
          >
            {preset.label}
          </button>
        {/each}
      </div>
    </Field>

    <Field
      label="Carry forward on Charter"
      helpText="When chartering a fresh vessel, offer to copy the focused ship's bridge crew (officer names, ranks, statuses, notes, portraits) and current supplies onto the new ship. The Charter dialog still lets you opt out per-charter."
    >
      <label class="inline-flex items-center gap-2 text-sm font-medium text-ink-700">
        <input
          type="checkbox"
          class="h-4 w-4 rounded border-surface-400"
          checked={settings.carryOverOnCharter}
          onchange={(event) => setCarryOverOnCharter(event.currentTarget.checked)}
        />
        Show carry-forward checkbox in the Charter dialog
      </label>
    </Field>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={resetSettings}>Restore defaults</Button>
    <span class="flex-1"></span>
    <Button variant="primary" onclick={handleClose}>Done</Button>
  {/snippet}
</Dialog>
