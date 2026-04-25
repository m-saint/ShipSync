<script>
  /**
   * PlayerCharacterSection — the optional character extension for a ship.
   * The ship can be NPC-captained (no PC) or PC-captained (with character name,
   * traits, and an optional portrait separate from the captain officer's).
   *
   * The toggle at the top adds or removes the extension; once removed, the PC
   * portrait is pruned from the workspace image store via the mutator.
   */

  import Field from '../../ui/Field.svelte'
  import Button from '../../ui/Button.svelte'
  import ImageUpload from '../../ui/ImageUpload.svelte'
  import {
    setPlayerCharacterEnabled,
    setPlayerCharacterFields,
    setPlayerCharacterPortrait,
    workspace,
  } from '../../state/workspace.svelte.js'
  import { sumImageBytes } from '../../domain/derivations.js'

  let { ship } = $props()

  let pcEnabled = $derived(ship.playerCharacter != null)

  // Writable $derived: defaults to the canonical PC fields, accepts user typing
  // until commit, and re-syncs automatically when the toggle flips, undo/redo
  // runs, or a file is loaded.
  let nameDraft = $derived(ship.playerCharacter?.characterName ?? '')
  let traitsDraft = $derived(ship.playerCharacter?.traits ?? '')

  function commitName() {
    if (!ship.playerCharacter) return
    if (nameDraft !== ship.playerCharacter.characterName) {
      setPlayerCharacterFields(ship.id, { characterName: nameDraft })
    }
    // Re-anchor: the mutator falls back to ship.name on a blank, so this
    // surfaces the auto-filled value to the user instead of leaving the
    // input empty.
    nameDraft = ship.playerCharacter?.characterName ?? ''
  }

  function commitTraits() {
    if (!ship.playerCharacter) return
    if (traitsDraft !== ship.playerCharacter.traits) {
      setPlayerCharacterFields(ship.id, { traits: traitsDraft })
    }
    traitsDraft = ship.playerCharacter?.traits ?? ''
  }

  let pcPortraitDataUrl = $derived(
    ship.playerCharacter?.portraitImageId
      ? workspace.images[ship.playerCharacter.portraitImageId] ?? null
      : null,
  )

  /**
   * Toggle handler. Disabling the PC clears character name, traits, and
   * portrait — the action is undoable, but if those fields hold meaningful
   * data we ask first, since "I unchecked the wrong box" shouldn't quietly
   * dump a paragraph of bio.
   */
  function onTogglePc(/** @type {Event} */ event) {
    const target = /** @type {HTMLInputElement} */ (event.currentTarget)
    const next = target.checked
    if (!next && ship.playerCharacter) {
      const pc = ship.playerCharacter
      const populated =
        (pc.characterName?.trim().length ?? 0) > 0 ||
        (pc.traits?.trim().length ?? 0) > 0 ||
        pc.portraitImageId != null
      if (populated && typeof window !== 'undefined') {
        const ok = window.confirm(
          'Disabling this clears the character name, traits, and portrait. Undo will restore them. Continue?',
        )
        if (!ok) {
          target.checked = true
          return
        }
      }
    }
    setPlayerCharacterEnabled(ship.id, next)
  }
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between gap-2">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">Player character</h3>
    <label class="inline-flex items-center gap-2 text-sm text-ink-700">
      <input
        type="checkbox"
        class="h-4 w-4 rounded border-surface-400"
        checked={pcEnabled}
        onchange={onTogglePc}
      />
      <span>This ship is captained by my character</span>
    </label>
  </header>

  {#if !pcEnabled}
    <p class="text-sm text-ink-500">
      Toggle on to mark this vessel as your character's and surface character name, traits, and a
      separate PC portrait. NPC-captained ships keep things light — the captain officer card above
      still works for crewing the bridge. If you toggle off later, undo restores the prior data.
    </p>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
      <div class="flex flex-col items-start gap-2">
        {#if pcPortraitDataUrl}
          <img
            src={pcPortraitDataUrl}
            alt={`${ship.playerCharacter.characterName} portrait`}
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
            label={pcPortraitDataUrl ? 'Replace' : 'Upload'}
            existingTotalBytes={sumImageBytes(workspace.images)}
            onchange={(payload) => setPlayerCharacterPortrait(ship.id, payload.dataUrl)}
          />
          {#if pcPortraitDataUrl}
            <Button variant="ghost" size="sm" onclick={() => setPlayerCharacterPortrait(ship.id, null)}>
              Remove portrait
            </Button>
          {/if}
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <Field label="Character name" htmlFor="pc-name" helpText="Defaults to the ship name if left blank.">
          <input
            id="pc-name"
            type="text"
            class="w-full h-10 px-3 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900"
            bind:value={nameDraft}
            onblur={commitName}
            autocomplete="off"
            maxlength="80"
            placeholder="Eira Thorne"
          />
        </Field>

        <Field label="Traits" htmlFor="pc-traits" helpText="Bio, mannerisms, scars, oaths — whatever you want at hand.">
          <textarea
            id="pc-traits"
            rows="4"
            class="w-full px-3 py-2 rounded-md border border-surface-300 bg-surface-50 text-sm text-ink-900 resize-y"
            bind:value={traitsDraft}
            onblur={commitTraits}
          ></textarea>
        </Field>
      </div>
    </div>
  {/if}
</section>
