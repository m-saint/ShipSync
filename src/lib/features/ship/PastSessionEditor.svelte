<script>
  /**
   * PastSessionEditor — editable card for a closed SessionEntry.
   *
   * Closed sessions stay visually subordinate to the active one (smaller
   * controls, muted card background) so the "current chapter" still reads
   * as the primary surface, but the title and narrative are now editable so
   * the player can polish past sessions long after the fact. v0.5 rendered
   * these read-only; v0.6 closes that gap (the JournalSection doc comment's
   * "v0.6 task" promise).
   *
   * Each instance owns its own `titleDraft` / `narrativeDraft` state — the
   * parent JournalSection doesn't try to track per-entry drafts. When the
   * underlying entry changes id (rare but possible — e.g. when undo redoes
   * a closed session edit), the local drafts re-sync via $effect.
   *
   * Commits go through the same `setSessionEntryFields` mutator used by the
   * active editor; the mutator already accepts any entry id.
   */

  import { setSessionEntryFields } from '../../state/workspace.svelte.js'

  /**
   * @typedef {import('../../domain/types.js').SessionEntry} SessionEntry
   * @typedef {{ ship: import('../../domain/types.js').Ship, entry: SessionEntry }} Props
   */

  /** @type {Props} */
  let { ship, entry } = $props()

  let titleDraft = $state(entry.title)
  let narrativeDraft = $state(entry.narrative)
  let sessionDateDraft = $state(entry.sessionDate ?? '')
  let locationDraft = $state(entry.location ?? '')
  let encounterDraft = $state(entry.encounterName ?? '')
  let lastSeenEntryId = $state(entry.id)

  $effect(() => {
    if (entry.id !== lastSeenEntryId) {
      lastSeenEntryId = entry.id
      titleDraft = entry.title
      narrativeDraft = entry.narrative
      sessionDateDraft = entry.sessionDate ?? ''
      locationDraft = entry.location ?? ''
      encounterDraft = entry.encounterName ?? ''
    }
  })

  function commitTitle() {
    if (titleDraft === entry.title) {
      titleDraft = entry.title
      return
    }
    setSessionEntryFields(ship.id, entry.id, { title: titleDraft })
    titleDraft = entry.title
  }

  function commitNarrative() {
    if (narrativeDraft === entry.narrative) {
      narrativeDraft = entry.narrative
      return
    }
    setSessionEntryFields(ship.id, entry.id, { narrative: narrativeDraft })
    narrativeDraft = entry.narrative
  }

  function commitSessionDate() {
    if (sessionDateDraft === (entry.sessionDate ?? '')) {
      sessionDateDraft = entry.sessionDate ?? ''
      return
    }
    setSessionEntryFields(ship.id, entry.id, { sessionDate: sessionDateDraft })
    sessionDateDraft = entry.sessionDate ?? ''
  }

  function commitLocation() {
    if (locationDraft === (entry.location ?? '')) {
      locationDraft = entry.location ?? ''
      return
    }
    setSessionEntryFields(ship.id, entry.id, { location: locationDraft })
    locationDraft = entry.location ?? ''
  }

  function commitEncounter() {
    if (encounterDraft === (entry.encounterName ?? '')) {
      encounterDraft = entry.encounterName ?? ''
      return
    }
    setSessionEntryFields(ship.id, entry.id, { encounterName: encounterDraft })
    encounterDraft = entry.encounterName ?? ''
  }

  /** @param {string} iso */
  function shortDate(iso) {
    return new Date(iso).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }
</script>

<li class="border border-surface-200 rounded-lg p-3 bg-surface-50/60 flex flex-col gap-2">
  <div class="flex items-start justify-between gap-2 flex-wrap">
    <input
      type="text"
      class="min-w-0 flex-1 h-8 px-2 rounded border border-surface-300 bg-surface-50 text-sm font-semibold text-ink-900"
      bind:value={titleDraft}
      onblur={commitTitle}
      maxlength="80"
      placeholder="Session"
      aria-label={`Title for session started ${shortDate(entry.startedAt)}`}
    />
    <span class="text-[10px] uppercase tracking-wide text-ink-500 shrink-0 font-mono pt-1.5">
      {entry.actions.length} action{entry.actions.length === 1 ? '' : 's'}
    </span>
  </div>

  <p class="text-[10px] uppercase tracking-wide text-ink-500 font-mono">
    {shortDate(entry.startedAt)}
    {#if entry.endedAt}
      → {shortDate(entry.endedAt)}
    {/if}
  </p>

  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
    <input
      type="text"
      class="w-full h-8 px-2 rounded border border-surface-300 bg-surface-50 text-xs text-ink-800"
      bind:value={sessionDateDraft}
      onblur={commitSessionDate}
      maxlength="60"
      placeholder="Played"
      aria-label={`Played-on date for session "${entry.title}"`}
    />
    <input
      type="text"
      class="w-full h-8 px-2 rounded border border-surface-300 bg-surface-50 text-xs text-ink-800"
      bind:value={locationDraft}
      onblur={commitLocation}
      maxlength="80"
      placeholder="Location"
      aria-label={`Location for session "${entry.title}"`}
    />
    <input
      type="text"
      class="w-full h-8 px-2 rounded border border-surface-300 bg-surface-50 text-xs text-ink-800"
      bind:value={encounterDraft}
      onblur={commitEncounter}
      maxlength="80"
      placeholder="Encounter"
      aria-label={`Encounter for session "${entry.title}"`}
    />
  </div>

  <textarea
    rows="3"
    class="w-full px-2 py-1.5 rounded border border-surface-300 bg-surface-50 text-sm text-ink-800 resize-y leading-relaxed"
    bind:value={narrativeDraft}
    onblur={commitNarrative}
    placeholder="No narrative recorded."
    aria-label={`Narrative for session "${entry.title}"`}
  ></textarea>
</li>
