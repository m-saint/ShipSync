<script>
  /**
   * WeatherGageControl — wind direction (which never changes mid-round in our
   * tracker, but the user sets it at the start of a fight) plus an explicit
   * holder pointer. The holder list is the union of player ships and scene
   * ships, with a sentinel "Drifting / in irons" choice that maps to null.
   *
   * Why a select instead of a segmented control? Because the holder list is
   * unbounded — it depends on how many ships are in the workspace and scene
   * right now — and a select stays compact as the list grows.
   */

  import { workspace, setSceneWind, setWeatherGageHolder } from '../../state/workspace.svelte.js'
  import { CARDINALS } from '../../domain/rules.js'
  import { allShipsForReference } from '../../domain/derivations.js'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'

  let candidates = $derived(allShipsForReference(workspace))

  const NULL_HOLDER_VALUE = '__none'

  let selectedHolder = $derived(workspace.scene.weatherGageHolderId ?? NULL_HOLDER_VALUE)

  const WIND_HINT =
    "Cardinal direction the wind is blowing toward. Nautically: a ship furthest upwind tends to hold the gage."
  const HOLDER_HINT =
    "Who's currently holding the Weather Gage. It can shift as ships maneuver. Use 'Drifting' when nobody clearly has it (e.g. everyone's in irons)."

  function onHolderChange(event) {
    const value = event.currentTarget.value
    setWeatherGageHolder(value === NULL_HOLDER_VALUE ? null : value)
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3 border-b border-surface-200">
  <h3 class="text-[10px] uppercase tracking-wide text-ink-500">Weather Gage</h3>

  <div class="grid grid-cols-2 gap-2">
    <RuleTooltip hint={WIND_HINT} display="block">
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-ink-500">Wind</span>
        <select
          class="h-9 px-2 rounded border border-surface-300 bg-surface-50 text-sm text-ink-900"
          value={workspace.scene.windDirection}
          onchange={(e) =>
            setSceneWind(
              /** @type {import('../../domain/types.js').Cardinal} */ (e.currentTarget.value),
            )}
          aria-label="Wind direction"
        >
          {#each CARDINALS as dir (dir)}
            <option value={dir}>{dir}</option>
          {/each}
        </select>
      </label>
    </RuleTooltip>

    <RuleTooltip hint={HOLDER_HINT} display="block">
      <label class="flex flex-col gap-1">
        <span class="text-[10px] uppercase tracking-wide text-ink-500">Held by</span>
        <select
          class="h-9 px-2 rounded border border-surface-300 bg-surface-50 text-sm text-ink-900"
          value={selectedHolder}
          onchange={onHolderChange}
          aria-label="Weather gage holder"
        >
          <option value={NULL_HOLDER_VALUE}>Drifting / in irons</option>
          {#if candidates.length > 0}
            <optgroup label="Your fleet">
              {#each candidates.filter((c) => c.kind === 'player') as ship (ship.id)}
                <option value={ship.id}>{ship.name}</option>
              {/each}
            </optgroup>
            <optgroup label="In the scene">
              {#each candidates.filter((c) => c.kind === 'scene') as ship (ship.id)}
                <option value={ship.id}>{ship.name}</option>
              {/each}
            </optgroup>
          {/if}
        </select>
      </label>
    </RuleTooltip>
  </div>
</div>
