<script>
  /**
   * JournalSection — the per-ship Captain's Log narrative editor.
   *
   * Every ship carries a `sessionHistory` of `SessionEntry` records seeded
   * automatically on the first state change after a fresh session begins.
   * The auto-logger appends every commit() to the latest open entry; this
   * component layers a user-authored title and free-text narrative on top of
   * that mechanical history. The two views complement each other: the
   * workspace-wide Activity Log on the right rail shows the chronological
   * list of edits across every loaded ship, while this section gives the
   * player one place per ship to write the story they're trying to remember.
   *
   * Persistence: title and narrative ride along in `.shipsync.json` like the
   * rest of the ship file, so closing and reopening keeps the writing intact.
   *
   * Editing model:
   *  - Title and narrative on the latest entry are always editable, even if
   *    the entry is already closed (so the player can polish a chapter after
   *    the fact).
   *  - Past closed entries are also editable as of v0.6 (rendered through
   *    `PastSessionEditor`, which owns its own per-entry draft state). The
   *    visual treatment stays subordinate so the active session still reads
   *    as the primary chapter.
   *  - Title commits on blur, narrative commits on blur — keystrokes don't
   *    each push an Activity Log line. Local drafts re-sync from canonical
   *    state on blur so undo/redo from elsewhere stays consistent.
   *  - Closing the session is a single click; it stamps `endedAt` on the
   *    current entry, and the auto-logger seeds a fresh open one as soon as
   *    the next commit fires. There is no explicit "Reopen" affordance —
   *    accidental closes are reversible via undo, which preserves the same
   *    "at most one open session" invariant the auto-logger depends on.
   */

  import Button from '../../ui/Button.svelte'
  import Field from '../../ui/Field.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import PastSessionEditor from './PastSessionEditor.svelte'
  import {
    closeCurrentSession,
    setSessionEntryFields,
  } from '../../state/workspace.svelte.js'

  let { ship } = $props()

  // sessionHistory is seeded by addShip's auto-log, so the array is always
  // non-empty for any ship surfaced through this component. Defensive default
  // here keeps the editor renderable if something exotic happens.
  let history = $derived(ship.sessionHistory ?? [])
  let latest = $derived(history[history.length - 1] ?? null)
  let pastEntries = $derived(history.slice(0, -1))

  // Local drafts so typing doesn't fire a commit per keystroke. Re-sync to
  // the canonical entry whenever the latest entry's id changes (closing a
  // session causes a new entry to take its place, and we want the editor to
  // pick up the fresh blank state).
  let titleDraft = $state(latest?.title ?? 'Session')
  let narrativeDraft = $state(latest?.narrative ?? '')
  let sessionDateDraft = $state(latest?.sessionDate ?? '')
  let locationDraft = $state(latest?.location ?? '')
  let encounterDraft = $state(latest?.encounterName ?? '')
  let lastSeenEntryId = $state(latest?.id ?? null)

  $effect(() => {
    const id = latest?.id ?? null
    if (id !== lastSeenEntryId) {
      lastSeenEntryId = id
      titleDraft = latest?.title ?? 'Session'
      narrativeDraft = latest?.narrative ?? ''
      sessionDateDraft = latest?.sessionDate ?? ''
      locationDraft = latest?.location ?? ''
      encounterDraft = latest?.encounterName ?? ''
    }
  })

  function commitTitle() {
    if (!latest) return
    if (titleDraft === latest.title) {
      titleDraft = latest.title
      return
    }
    setSessionEntryFields(ship.id, latest.id, { title: titleDraft })
    titleDraft = latest.title
  }

  function commitNarrative() {
    if (!latest) return
    if (narrativeDraft === latest.narrative) {
      narrativeDraft = latest.narrative
      return
    }
    setSessionEntryFields(ship.id, latest.id, { narrative: narrativeDraft })
    narrativeDraft = latest.narrative
  }

  function commitSessionDate() {
    if (!latest) return
    if (sessionDateDraft === (latest.sessionDate ?? '')) {
      sessionDateDraft = latest.sessionDate ?? ''
      return
    }
    setSessionEntryFields(ship.id, latest.id, { sessionDate: sessionDateDraft })
    sessionDateDraft = latest.sessionDate ?? ''
  }

  function commitLocation() {
    if (!latest) return
    if (locationDraft === (latest.location ?? '')) {
      locationDraft = latest.location ?? ''
      return
    }
    setSessionEntryFields(ship.id, latest.id, { location: locationDraft })
    locationDraft = latest.location ?? ''
  }

  function commitEncounter() {
    if (!latest) return
    if (encounterDraft === (latest.encounterName ?? '')) {
      encounterDraft = latest.encounterName ?? ''
      return
    }
    setSessionEntryFields(ship.id, latest.id, { encounterName: encounterDraft })
    encounterDraft = latest.encounterName ?? ''
  }

  function closeSession() {
    if (!latest || latest.endedAt != null) return
    // Apply any pending edits first so the close commit reflects what the
    // user typed before clicking the button.
    /** @type {{ title?: string, narrative?: string, sessionDate?: string, location?: string, encounterName?: string }} */
    const pending = {}
    if (titleDraft !== latest.title) pending.title = titleDraft
    if (narrativeDraft !== latest.narrative) pending.narrative = narrativeDraft
    if (sessionDateDraft !== (latest.sessionDate ?? '')) pending.sessionDate = sessionDateDraft
    if (locationDraft !== (latest.location ?? '')) pending.location = locationDraft
    if (encounterDraft !== (latest.encounterName ?? '')) pending.encounterName = encounterDraft
    if (Object.keys(pending).length > 0) {
      setSessionEntryFields(ship.id, latest.id, pending)
    }
    closeCurrentSession(ship.id)
  }

  /**
   * @param {string} iso
   */
  function shortDate(iso) {
    return new Date(iso).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  let isLatestOpen = $derived(latest != null && latest.endedAt == null)
  let actionCount = $derived(latest?.actions.length ?? 0)

  const TITLE_HINT =
    "What you'll call this stretch of voyaging when you look it up later. Defaults back to \"Session\" if you clear it."
  const NARRATIVE_HINT =
    "Anything the table will care about next time. The mechanical log records what changed; this is for the *why*."
  const CLOSE_HINT =
    "Mark this stretch finished. The next edit on this ship starts a fresh entry — useful as a chapter break between sessions."
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between gap-2 flex-wrap">
    <div class="flex flex-col gap-0.5">
      <h3 class="display text-base text-ink-900 uppercase tracking-wider">Captain's Log</h3>
      <span class="text-[10px] uppercase tracking-wide text-ink-500">
        Per-ship narrative · saved with the ship file
      </span>
    </div>
    {#if latest}
      <span
        class="text-[10px] uppercase tracking-wide px-2 py-1 rounded font-mono {isLatestOpen
          ? 'bg-brass-100 text-brass-900'
          : 'bg-surface-200 text-ink-700'}"
        title={isLatestOpen
          ? `Open since ${shortDate(latest.startedAt)}.`
          : `Closed ${shortDate(latest.endedAt ?? latest.startedAt)}.`}
      >
        {isLatestOpen ? 'Open' : 'Closed'}
      </span>
    {/if}
  </header>

  {#if latest}
    <div class="flex flex-col gap-3">
      <RuleTooltip hint={TITLE_HINT} display="block">
        <Field
          label="Session title"
          htmlFor={`session-title-${ship.id}`}
          helpText={`Started ${shortDate(latest.startedAt)} · ${actionCount} action${actionCount === 1 ? '' : 's'} logged so far.`}
        >
          <input
            id={`session-title-${ship.id}`}
            type="text"
            class="w-full h-9 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
            bind:value={titleDraft}
            onblur={commitTitle}
            maxlength="80"
            placeholder="Session"
          />
        </Field>
      </RuleTooltip>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field
          label="Played"
          htmlFor={`session-date-${ship.id}`}
          helpText="Real-world date this came up at the table. Free text — write it however you'd say it."
        >
          <input
            id={`session-date-${ship.id}`}
            type="text"
            class="w-full h-9 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
            bind:value={sessionDateDraft}
            onblur={commitSessionDate}
            maxlength="60"
            placeholder="e.g. Saturday, March 14"
          />
        </Field>
        <Field
          label="Location"
          htmlFor={`session-location-${ship.id}`}
          helpText="Where the ship spent this stretch of voyaging."
        >
          <input
            id={`session-location-${ship.id}`}
            type="text"
            class="w-full h-9 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
            bind:value={locationDraft}
            onblur={commitLocation}
            maxlength="80"
            placeholder="e.g. Cracked Tooth Bay"
          />
        </Field>
        <Field
          label="Encounter"
          htmlFor={`session-encounter-${ship.id}`}
          helpText="Optional name for this session's main beat."
        >
          <input
            id={`session-encounter-${ship.id}`}
            type="text"
            class="w-full h-9 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
            bind:value={encounterDraft}
            onblur={commitEncounter}
            maxlength="80"
            placeholder="e.g. Raid on the Black Spear"
          />
        </Field>
      </div>

      <RuleTooltip hint={NARRATIVE_HINT} display="block">
        <Field
          label="Narrative"
          htmlFor={`session-narrative-${ship.id}`}
          helpText="Tell the next-you what happened, who matters, and what's looming."
        >
          <textarea
            id={`session-narrative-${ship.id}`}
            rows="6"
            class="w-full px-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900 resize-y leading-relaxed"
            bind:value={narrativeDraft}
            onblur={commitNarrative}
            placeholder="(empty)"
          ></textarea>
        </Field>
      </RuleTooltip>

      <div class="flex items-center justify-end gap-2 flex-wrap">
        {#if isLatestOpen}
          <RuleTooltip hint={CLOSE_HINT} display="inline-flex">
            <Button variant="secondary" size="sm" onclick={closeSession}>
              Close session
            </Button>
          </RuleTooltip>
        {:else}
          <span class="text-xs text-ink-500">
            This session closed at {shortDate(latest.endedAt ?? latest.startedAt)}.
            Edit anything on this ship to start the next one.
          </span>
        {/if}
      </div>
    </div>
  {/if}

  {#if pastEntries.length > 0}
    <details class="border-t border-surface-200 pt-3 group">
      <summary class="text-sm font-medium text-ink-700 cursor-pointer list-none flex items-center gap-2">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          class="transition-transform group-open:rotate-90 text-ink-500"
        >
          <path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        Past sessions
        <span class="text-[10px] uppercase tracking-wide text-ink-500 font-normal">
          {pastEntries.length} closed
        </span>
      </summary>
      <ol class="mt-3 flex flex-col gap-3">
        {#each [...pastEntries].reverse() as entry (entry.id)}
          <PastSessionEditor {ship} {entry} />
        {/each}
      </ol>
    </details>
  {/if}
</section>
