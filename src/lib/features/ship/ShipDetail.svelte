<script>
  /**
   * ShipDetail — the main editor surface for a single ship.
   *
   * v0.1 was view-only KPI cards plus a dev-only roadmap stub. v0.2 added the
   * Particulars, Captain, and PC sections. v0.3 fills out the picture: all ten
   * officer stations plus the three supply tracks live here too.
   */

  import EmptyState from '../../ui/EmptyState.svelte'
  import Button from '../../ui/Button.svelte'
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte'
  import RuleTooltip from '../../ui/RuleTooltip.svelte'
  import SaveShipButton from '../fleet/SaveShipButton.svelte'
  import ProfileSection from './ProfileSection.svelte'
  import CombatReadinessSection from './CombatReadinessSection.svelte'
  import ConditionsSection from './ConditionsSection.svelte'
  import OfficerRoster from './OfficerRoster.svelte'
  import SuppliesSection from './SuppliesSection.svelte'
  import FlagsSection from './FlagsSection.svelte'
  import { workspace, removeShip, setShipBoardedBy } from '../../state/workspace.svelte.js'
  import { openDialog } from '../../state/ui.svelte.js'
  import {
    NauticalCopy,
    baselineMettle,
    damageThresholdFor,
    actionsAllowedThisTurn,
    isSkeletonStaffed,
    isShipDirty,
  } from '../../domain/derivations.js'
  import { SHIP_SIZE_LABELS, MOBILITY_LABELS } from '../../domain/rules.js'

  let ship = $derived(workspace.focusedShipId ? workspace.ships[workspace.focusedShipId] : null)
  let shipIsDirty = $derived(
    ship ? isShipDirty(ship, workspace.lastSavedAtByShipId[ship.id] ?? null) : false,
  )

  let removeDialogOpen = $state(false)
  let removeDialogShipName = $state('')
  let removeDialogShipId = $state(/** @type {string | null} */ (null))
  let removeDialogIsDirty = $state(false)

  let baseline = $derived(ship ? baselineMettle(ship) : 0)
  let threshold = $derived(ship ? damageThresholdFor(ship.size) : 0)
  let actionAllowance = $derived(ship ? actionsAllowedThisTurn(ship) : 0)
  let skeleton = $derived(ship ? isSkeletonStaffed(ship) : false)
  let savedAt = $derived(ship ? workspace.lastSavedAtByShipId[ship.id] ?? null : null)
  let portraitDataUrl = $derived(
    ship?.portraitImageId ? workspace.images[ship.portraitImageId] ?? null : null,
  )

  // Local writable draft for the "Boarded by" free-text field. Tracks the
  // canonical state by default and re-syncs after every commit so a no-op
  // blur (e.g. the user typed whitespace and then left the field) snaps
  // back to whatever the workspace actually holds.
  let boardedByDraft = $derived(ship?.boardedBy ?? '')

  function commitBoardedBy() {
    if (!ship) return
    const trimmed = boardedByDraft.trim()
    const next = trimmed.length > 0 ? trimmed : null
    if (next !== ship.boardedBy) {
      setShipBoardedBy(ship.id, next)
    }
    boardedByDraft = ship.boardedBy ?? ''
  }

  const BOARDED_BY_HINT =
    "Free-text reminder of who's locked alongside you in a boarding action — pirate flag, customs cutter, that big black ship from the prologue. Leave blank when nobody is. While the field is set, the ship is locked at speed 0 and can't make way (PDF p. 196)."

  const HULL_HINT =
    "Hull is total damage she can soak before she founders. Hits that meet or beat the damage threshold can stagger crew or break stations."
  const METTLE_HINT =
    "Mettle is the captain's nerve — your dice for moves, saves, and standing your ground. Spend it for stunts and grit; reset to baseline (4 + captain rank + flying flag's total reputation) at refit."
  let crewHint = $derived(
    skeleton
      ? "At or below the skeleton mark she's running short-handed; the bridge can take only one of Movement / Attack / Status this round. Wounds, swims, and boarding all draw from this pool."
      : "Crew runs the stations. Skeleton mark is the line at or below which she's short-handed; full crew gets all three action phases this turn (and +1 speed when every station's filled).",
  )
  const EXPLOSION_HINT =
    "When fires get loose, every fire on board makes the magazine roll harder. Failing this DC means a very bad day."

  /** Friendlier last-saved phrasing — exact ISO is on the <time> tag for accessibility. */
  function describeSavedAt(/** @type {string|null} */ iso) {
    if (!iso) return null
    const t = new Date(iso)
    const now = new Date()
    const sameDay =
      t.getFullYear() === now.getFullYear() &&
      t.getMonth() === now.getMonth() &&
      t.getDate() === now.getDate()
    if (sameDay) {
      return `Last file save today at ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    }
    return `Last file save ${t.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`
  }

  /**
   * Snapshot the ship's identity, name, and dirty state into local
   * dialog props before opening, so the body text stays stable even
   * if the user navigates focus or autosave finishes mid-confirm.
   * The actual remove fires from `handleRemoveConfirmed` below.
   */
  function openRemoveDialog() {
    if (!ship) return
    removeDialogShipId = ship.id
    removeDialogShipName = ship.name
    removeDialogIsDirty = shipIsDirty
    removeDialogOpen = true
  }

  function handleRemoveConfirmed() {
    if (!removeDialogShipId) return
    removeShip(removeDialogShipId)
    removeDialogShipId = null
  }

  // Open the print sheet in a fresh tab. The PrintView reads the local
  // autosave, so the focused ship needs to have flushed at least once before
  // this works — every mutation queues an autosave, so in practice the
  // moment the user has touched the ship the print URL is loadable.
  function openPrintSheet() {
    if (!ship || typeof window === 'undefined') return
    const url = `${window.location.origin}${window.location.pathname}?print=${encodeURIComponent(ship.id)}`
    window.open(url, '_blank', 'noopener')
  }
</script>

<section
  class="flex-1 min-w-[22rem] overflow-y-auto overflow-x-hidden overscroll-contain"
  aria-label="Ship detail"
>
  {#if !ship}
    <div class="h-full flex items-center justify-center">
      {#snippet icon()}
        <svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 18l9 3 9-3M5 13l7-2 7 2M12 3v8m-4-3h8"
            stroke="currentColor"
            stroke-width="1.25"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      {/snippet}
      {#snippet action()}
        <Button variant="primary" onclick={() => openDialog('add-ship')}>
          Charter a vessel
        </Button>
      {/snippet}
      <EmptyState
        title={NauticalCopy.emptyDetailTitle}
        body={NauticalCopy.emptyDetailBody}
        icon={icon}
        action={action}
      />
    </div>
  {:else}
    <div class="p-6 max-w-3xl mx-auto flex flex-col gap-6">
      <header class="flex flex-col gap-3">
        <div class="flex items-start gap-4 min-w-0">
          {#if portraitDataUrl}
            <img
              src={portraitDataUrl}
              alt={`${ship.name} portrait`}
              class="w-16 h-16 sm:w-20 sm:h-20 rounded-md object-cover border border-surface-300 bg-surface-100 shrink-0"
            />
          {/if}
          <div class="min-w-0 flex-1">
            <h2 class="display text-3xl text-ink-900 leading-tight break-words">{ship.name}</h2>
            <p class="text-sm text-ink-500 mt-0.5 break-words">
              {ship.type || 'Unknown type'} · {SHIP_SIZE_LABELS[ship.size] ?? ship.size} · {MOBILITY_LABELS[ship.mobility] ?? ship.mobility} mobility
            </p>
            {#if ship.officers.captain.name}
              <p class="text-sm text-brass-700 mt-1 break-words">
                Captained by <span class="font-medium">{ship.officers.captain.name}</span>
              </p>
            {/if}
            {#if savedAt}
              <p class="text-xs text-ink-500 mt-1">
                <time datetime={savedAt}>{describeSavedAt(savedAt)}</time>
              </p>
            {:else}
              <p class="text-xs text-amber-700 mt-1">Not yet written to a file.</p>
            {/if}
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap justify-end">
          <SaveShipButton {ship} />
          <Button
            variant="ghost"
            size="md"
            onclick={openPrintSheet}
            title="Open a clean, print-friendly sheet for this ship in a new tab. Pulls from the local autosave."
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3.5 5V2h7v3M3.5 9h-1V5h9v4h-1M3.5 8h7v4h-7z"
                stroke="currentColor"
                stroke-width="1.25"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Print sheet
          </Button>
          <Button
            variant="danger"
            size="md"
            onclick={openRemoveDialog}
            title="Remove this ship from the workspace. Saved files are not deleted."
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2.5 4h9M5 4V2.5h4V4M3.5 4l.75 8h5.5l.75-8"
                stroke="currentColor"
                stroke-width="1.25"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Remove from workspace
          </Button>
        </div>
      </header>

      <RuleTooltip hint={BOARDED_BY_HINT} display="block">
        {@const isBoarded = ship.boardedBy != null}
        <div
          class={`flex items-center gap-3 px-3 py-2 rounded-md border text-sm ${
            isBoarded
              ? 'bg-amber-50 border-amber-400 text-amber-700'
              : 'bg-surface-50 border-surface-300 text-ink-500'
          }`}
        >
          <span class="text-[10px] uppercase tracking-wide whitespace-nowrap">
            {isBoarded ? '⚓ Boarded by' : 'Boarded by'}
          </span>
          <input
            id={`boarded-by-${ship.id}`}
            type="text"
            class={`flex-1 min-w-0 h-8 px-2 rounded border bg-surface-50 text-sm text-ink-900 ${
              isBoarded ? 'border-amber-400' : 'border-surface-300'
            }`}
            bind:value={boardedByDraft}
            onblur={commitBoardedBy}
            maxlength="80"
            placeholder="(not engaged in a boarding action)"
            aria-label="Boarded by"
          />
          {#if isBoarded}
            <button
              type="button"
              class="text-xs text-amber-700 hover:text-crimson-700 px-2 h-7 rounded hover:bg-amber-100"
              onclick={() => {
                boardedByDraft = ''
                commitBoardedBy()
              }}
              title="Clear the boarded-by label."
            >
              Clear
            </button>
          {/if}
        </div>
      </RuleTooltip>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <RuleTooltip hint={HULL_HINT} display="block">
          <div class="surface-card p-3 h-full">
            <div class="text-xs uppercase text-ink-500 tracking-wide">Hull</div>
            <div class="text-2xl font-semibold mt-1">
              {ship.hp.current}<span class="text-base text-ink-500">/{ship.hp.max}</span>
            </div>
            <div class="text-xs text-ink-500">Damage threshold {threshold}</div>
          </div>
        </RuleTooltip>
        <RuleTooltip hint={METTLE_HINT} display="block">
          <div class="surface-card p-3 h-full">
            <div class="text-xs uppercase text-ink-500 tracking-wide">Mettle</div>
            <div class="text-2xl font-semibold mt-1">{ship.mettle.current}</div>
            <div class="text-xs text-ink-500">Baseline {baseline}</div>
          </div>
        </RuleTooltip>
        <RuleTooltip hint={crewHint} display="block">
          <div class="surface-card p-3 h-full">
            <div class="text-xs uppercase text-ink-500 tracking-wide">Crew</div>
            <div class="text-2xl font-semibold mt-1">
              {ship.crew.current}<span class="text-base text-ink-500">/{ship.crew.max}</span>
            </div>
            <div class="text-xs {skeleton ? 'text-amber-700 font-medium' : 'text-ink-500'}">
              Skeleton {ship.crew.skeleton} · {actionAllowance} action{actionAllowance === 1 ? '' : 's'}/turn
            </div>
          </div>
        </RuleTooltip>
        <RuleTooltip hint={EXPLOSION_HINT} display="block">
          <div class="surface-card p-3 h-full">
            <div class="text-xs uppercase text-ink-500 tracking-wide">Explosion DC</div>
            <div class="text-2xl font-semibold mt-1">{ship.explosionDC}</div>
            <div class="text-xs text-ink-500">{ship.fires} fire{ship.fires === 1 ? '' : 's'} burning</div>
          </div>
        </RuleTooltip>
      </div>

      <CombatReadinessSection {ship} />

      <ConditionsSection {ship} />

      <ProfileSection {ship} />

      <SuppliesSection {ship} />

      <OfficerRoster {ship} />

      <FlagsSection {ship} />
    </div>
  {/if}
</section>

<ConfirmDialog
  bind:open={removeDialogOpen}
  title={`Remove ${removeDialogShipName} from the workspace?`}
  body={removeDialogIsDirty
    ? `${removeDialogShipName} has unsaved edits since the last file save. Removing now drops those changes from the workspace, and the file on disk stays at its previous save. This isn't covered by Undo.`
    : `${removeDialogShipName} will leave the workspace. Any saved .shipsync.json file on disk is not deleted — you can re-load it later.`}
  confirmLabel={removeDialogIsDirty ? 'Discard changes & remove' : 'Remove'}
  cancelLabel="Cancel"
  confirmVariant="danger"
  onConfirm={handleRemoveConfirmed}
/>
