<script>
  /**
   * ConditionsSection — toggleable chips for the situational state a ship
   * can pick up during a fight.
   *
   * Two persistence classes:
   *  - **Persistent** (Listing, Stricken colors): live on `ship.conditions[]`
   *    and ride along in the saved ship file. They describe damage / surrender
   *    state the player will still want to remember next session.
   *  - **Scene-only** (Heeling, In Irons, Crossing the T, Becalmed): live on
   *    `workspace.scene.shipConditions[ship.id]` and ride along only in the
   *    autosave snapshot. Loading a fresh workspace resets them; that matches
   *    how a tactical positioning state evaporates as soon as the fight ends.
   *
   * The mixed model is opinionated on purpose. Heuristic 4 (consistency &
   * standards) says related affordances should look the same — so both rows
   * are rendered as identical chip controls. Heuristic 1 (visibility of
   * status) and 5 (error prevention) say the difference still has to be
   * legible, so each group carries its own subhead and persistence note.
   */

  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import {
    setShipPersistentCondition,
    setShipSceneCondition,
    workspace,
  } from '../../state/workspace.svelte.js'
  import {
    PERSISTENT_SHIP_CONDITIONS,
    PERSISTENT_CONDITION_LABELS,
    PERSISTENT_CONDITION_HINTS,
    SCENE_SHIP_CONDITIONS,
    SCENE_CONDITION_LABELS,
    SCENE_CONDITION_HINTS,
  } from '../../domain/rules.js'

  /** @type {{ ship: import('../../domain/types.js').Ship }} */
  let { ship } = $props()

  let persistentSet = $derived(new Set(ship.conditions ?? []))
  let sceneSet = $derived(
    new Set(workspace.scene.shipConditions[ship.id] ?? []),
  )

  /**
   * @param {import('../../domain/types.js').PersistentShipCondition} id
   */
  function togglePersistent(id) {
    setShipPersistentCondition(ship.id, id, !persistentSet.has(id))
  }

  /**
   * @param {import('../../domain/types.js').SceneShipCondition} id
   */
  function toggleScene(id) {
    setShipSceneCondition(ship.id, id, !sceneSet.has(id))
  }
</script>

<section class="surface-card p-4 sm:p-5 flex flex-col gap-4">
  <header class="flex items-center justify-between">
    <h3 class="display text-base text-ink-900 uppercase tracking-wider">Ship Conditions</h3>
    <span class="text-[10px] uppercase tracking-wide text-ink-500">Situational state</span>
  </header>

  <div class="flex flex-col gap-2">
    <div class="flex items-baseline gap-3 flex-wrap">
      <h4 class="text-sm font-medium text-ink-700">Persistent</h4>
      <span class="text-[10px] uppercase tracking-wide text-ink-500">
        Saved with the ship
      </span>
    </div>
    <p class="text-xs text-ink-500">
      Sticks until something changes it — damage repaired, colors raised back up.
      Travels with the ship file.
    </p>
    <ul class="flex flex-wrap gap-2">
      {#each PERSISTENT_SHIP_CONDITIONS as condition (condition)}
        {@const on = persistentSet.has(condition)}
        <li>
          <RuleTooltip hint={PERSISTENT_CONDITION_HINTS[condition]}>
            <button
              type="button"
              class={`px-3 h-8 rounded-full text-sm border transition-colors ${
                on
                  ? 'bg-amber-50 border-amber-400 text-amber-800 hover:bg-amber-100'
                  : 'bg-surface-50 border-surface-300 text-ink-700 hover:bg-surface-100'
              }`}
              aria-pressed={on}
              aria-label={`${PERSISTENT_CONDITION_LABELS[condition]} — ${on ? 'on' : 'off'}`}
              onclick={() => togglePersistent(condition)}
            >
              <span class="inline-flex items-center gap-1.5">
                <span
                  class={`inline-block w-1.5 h-1.5 rounded-full ${on ? 'bg-amber-600' : 'bg-surface-400'}`}
                  aria-hidden="true"
                ></span>
                {PERSISTENT_CONDITION_LABELS[condition]}
              </span>
            </button>
          </RuleTooltip>
        </li>
      {/each}
    </ul>
  </div>

  <div class="flex flex-col gap-2 pt-2 border-t border-surface-200">
    <div class="flex items-baseline gap-3 flex-wrap">
      <h4 class="text-sm font-medium text-ink-700">Scene-only</h4>
      <span class="text-[10px] uppercase tracking-wide text-ink-500">
        Resets when you reload the workspace
      </span>
    </div>
    <p class="text-xs text-ink-500">
      Tactical and wind state. These ride along in the autosave snapshot but
      never make it into the ship file — fresh load, fresh slate.
    </p>
    <ul class="flex flex-wrap gap-2">
      {#each SCENE_SHIP_CONDITIONS as condition (condition)}
        {@const on = sceneSet.has(condition)}
        <li>
          <RuleTooltip hint={SCENE_CONDITION_HINTS[condition]}>
            <button
              type="button"
              class={`px-3 h-8 rounded-full text-sm border transition-colors ${
                on
                  ? 'bg-brass-50 border-brass-400 text-brass-800 hover:bg-brass-100'
                  : 'bg-surface-50 border-surface-300 text-ink-700 hover:bg-surface-100'
              }`}
              aria-pressed={on}
              aria-label={`${SCENE_CONDITION_LABELS[condition]} — ${on ? 'on' : 'off'}`}
              onclick={() => toggleScene(condition)}
            >
              <span class="inline-flex items-center gap-1.5">
                <span
                  class={`inline-block w-1.5 h-1.5 rounded-full ${on ? 'bg-brass-600' : 'bg-surface-400'}`}
                  aria-hidden="true"
                ></span>
                {SCENE_CONDITION_LABELS[condition]}
              </span>
            </button>
          </RuleTooltip>
        </li>
      {/each}
    </ul>
  </div>
</section>
