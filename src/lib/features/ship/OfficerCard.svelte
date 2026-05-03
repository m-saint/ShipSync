<script>
  /**
   * OfficerCard — editor for a single officer station on a ship.
   *
   * Used in v0.2 for the captain only; designed to slot into the v0.3 ten-station
   * grid without changes by accepting `{ ship, station }`. Status uses a small
   * segmented control rather than a select so the (rare) Stricken / Dead states
   * are recognizable at a glance per Heuristic 6.
   */

  import Field from '../../ui/Field.svelte'
  import NumberStepper from '../../ui/NumberStepper.svelte'
  import ImageUpload from '../../ui/ImageUpload.svelte'
  import Button from '../../ui/Button.svelte'
  import {
    setOfficer,
    setOfficerNotes,
    setOfficerPortrait,
    workspace,
  } from '../../state/workspace.svelte.js'
  import { STATION_LABELS } from '../../domain/rules.js'
  import { sumImageBytes } from '../../domain/derivations.js'

  let { ship, station = /** @type {import('../../domain/types.js').StationKey} */ ('captain') } = $props()

  let officer = $derived(ship.officers[station])

  // Writable $derived: each input reads from the canonical officer field by
  // default so undo/redo/file-load/station-rebind flows in automatically. The
  // input writes back into the local override on every keystroke; `commitName`
  // / `commitNotes` then push the override into workspace state on blur and
  // re-anchor to the canonical value (so a no-op blur or a rejected edit
  // snaps the input back instead of leaving stale text on screen).
  let nameDraft = $derived(officer.name ?? '')
  let notesDraft = $derived(officer.notes ?? '')

  function commitName() {
    const trimmed = nameDraft.trim()
    const target = trimmed.length === 0 ? null : trimmed
    if (target !== officer.name) {
      setOfficer(ship.id, station, { name: target })
    } else {
      nameDraft = officer.name ?? ''
    }
  }

  function commitNotes() {
    if (notesDraft !== (officer.notes ?? '')) {
      setOfficerNotes(ship.id, station, notesDraft)
    } else {
      notesDraft = officer.notes ?? ''
    }
  }

  let portraitDataUrl = $derived(
    officer.portraitImageId ? workspace.images[officer.portraitImageId] ?? null : null,
  )

  /** @type {Array<{ value: import('../../domain/types.js').OfficerStatus, label: string, hint: string }>} */
  const STATUS_OPTIONS = [
    { value: 'active', label: 'Active', hint: 'On station, fit for duty.' },
    { value: 'stricken', label: 'Stricken', hint: 'Wounded; the station runs short until they recover.' },
    { value: 'dead', label: 'Dead', hint: 'Lost. Replace before the next voyage.' },
  ]
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">{STATION_LABELS[station]}</h3>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Officer</span>
  </header>

  <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
    <div class="flex flex-col items-start gap-2">
      {#if portraitDataUrl}
        <img
          src={portraitDataUrl}
          alt={officer.name ? `${officer.name} portrait` : `${STATION_LABELS[station]} portrait`}
          class="w-24 h-24 rounded-md object-cover border border-surface-300 bg-surface-100"
        />
      {:else}
        <div
          aria-hidden="true"
          class="w-24 h-24 rounded-md border border-dashed border-surface-300 bg-surface-100 flex items-center justify-center text-ink-500"
        >
          <svg width="32" height="32" viewBox="0 0 24 24">
            <path
              d="M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0"
              stroke="currentColor"
              stroke-width="1.25"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      {/if}
      <div class="flex flex-col gap-1.5 w-full">
        <ImageUpload
          label={portraitDataUrl ? 'Replace' : 'Upload'}
          existingTotalBytes={sumImageBytes(workspace.images)}
          onchange={(payload) => setOfficerPortrait(ship.id, station, payload.dataUrl)}
        />
        {#if portraitDataUrl}
          <Button variant="ghost" size="sm" onclick={() => setOfficerPortrait(ship.id, station, null)}>
            Remove portrait
          </Button>
        {/if}
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <Field label="Name" htmlFor={`officer-${station}-name`} helpText="Leave blank if the post is vacant.">
        <input
          id={`officer-${station}-name`}
          type="text"
          class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
          bind:value={nameDraft}
          onblur={commitName}
          autocomplete="off"
          maxlength="80"
          placeholder={station === 'captain' ? 'Officer name' : 'Officer name'}
        />
      </Field>

      <Field label="Rank" helpText="1–5. Captain rank feeds Mettle baseline.">
        <NumberStepper
          ariaLabel="Rank"
          value={officer.rank}
          min={1}
          max={5}
          step={1}
          onchange={(v) => setOfficer(ship.id, station, { rank: /** @type {any} */ (v) })}
        />
      </Field>

      <Field label="Status" helpText="Stricken or Dead means the station runs short.">
        <div
          role="group"
          aria-label={`${STATION_LABELS[station]} status`}
          class="flex w-full rounded-md border border-surface-300 overflow-hidden"
        >
          {#each STATUS_OPTIONS as opt (opt.value)}
            {@const active = officer.status === opt.value}
            {@const activeClass =
              opt.value === 'active'
                ? 'bg-brass-100 text-brass-700'
                : opt.value === 'stricken'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-crimson-50 text-crimson-700'}
            <button
              type="button"
              title={opt.hint}
              aria-pressed={active}
              class={`flex-1 px-2 h-10 inline-flex items-center justify-center text-sm font-medium border-r border-surface-300 last:border-r-0 ${
                active ? activeClass : 'bg-surface-50 text-ink-700 hover:bg-surface-100 cursor-pointer'
              }`}
              onclick={() => setOfficer(ship.id, station, { status: opt.value })}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </Field>

      <Field
        label="Duties & quirks"
        htmlFor={`officer-${station}-notes`}
        helpText="Free text — anything you want to remember about this officer between sessions."
      >
        <textarea
          id={`officer-${station}-notes`}
          rows="2"
          class="w-full px-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900 leading-snug resize-y"
          bind:value={notesDraft}
          onblur={commitNotes}
          maxlength="600"
          placeholder={station === 'captain'
            ? 'Notes for this station.'
            : 'Notes for this station.'}
        ></textarea>
      </Field>
    </div>
  </div>
</section>
