# ShipSync

A small, local-first dashboard for keeping track of a ship (or a small fleet) during a tabletop ship-combat session. Built for the player at the table, not the GM running the room.

ShipSync remembers your ship's hull, crew, mettle, fires, officers, supplies, conditions, scene weather, an editable captain's log per ship, and a chronological activity log of every edit you've made. It does not roll dice, advance phases for you, or tell you what the rules say — your rulebook still does that. ShipSync just keeps the bookkeeping out of your way.

## Status

v1.0.3 — post-deploy usability pass. v1.0 lands the readiness + preferences slates; v1.0.1 closed the v1.0 UX-audit deferrals; v1.0.2 corrected rule-fidelity drift; v1.0.3 closes the nine usability defects a real-world session surfaced once the app went live on GitHub Pages ([docs/audits/v1.0-ux-audit.md § v1.0.3](./docs/audits/v1.0-ux-audit.md)).

What changed in v1.0.3:

- **Dark mode is a real palette, not a filter.** `tokens.css` overrides every color token under `html[data-color-scheme='dark']` (`--color-surface-*`, `--color-ink-*`, `--color-brass-*`, `--color-crimson-*`, `--color-amber-*`, plus a hand-tuned `dialog::backdrop`). Dialogs, popovers, segmented controls, and image art all follow the theme without inversion artifacts. The Preferences description no longer carries the old "small artifacts on heavy art are expected" caveat. Print views still drop the dark attribute (cream-on-ink is wasteful on paper).
- **Dashboard locks the body / html, rails scroll internally.** `Dashboard.svelte`'s root is `h-dvh overflow-hidden`; the FleetRail, ShipDetail, and Scene rail each carry their own `overflow-y-auto`. Cursor position no longer leaks scroll to the body, so the page never grows past one viewport once the first ship is loaded.
- **Tooltips render in a viewport-aware portal.** `Tooltip.svelte` rewritten end-to-end: `position: fixed` bubble, auto-flips top↔bottom or left↔right when the requested side would clip, clamps the primary axis 8px from the viewport edge, and caps `max-width` at `min(calc(100vw - 32px), 320px)`. Scroll/resize hides immediately so a stale-rect bubble can't float away from its anchor. Existing `<RuleTooltip>` callers didn't have to change.
- **Weapon slots are usable again.** The four slot inputs (Bow / Port / Starboard / Stern) render as a 2×2 grid with each `Field` stacking the label on top of the number stepper. Each slot now has its own ~180px column instead of a smushed ~80px sliver.
- **Officer status no longer scrolls the page.** `OfficerCard.svelte`'s segmented control switched from `<input type="radio">` + `<label>` to three `<button type="button" aria-pressed={active}>`s. The radio version had a hidden `<input>` that the browser auto-scrolled into view on `:checked` change; the button version has no hidden focus target, so the surface stays put when the user picks Stricken or Dead.
- **Status segmented control fits inside narrow officer cards.** Same control as the scroll fix; the layout is a vertical stack (Name → Rank → Status → Duties), not a Rank-beside-Status row, so all three options divide the form column and never overhang the card. Verified at production-test viewport widths.
- **ShipDetail is vertical-scroll only.** The center pane carries `overflow-y-auto overflow-x-hidden` (was `overflow-y-auto` only). A long input or wide control could previously leak a 1–2px horizontal scrollbar; that's gone.
- **Ship size autofills from the type field.** `AddShipDialog.svelte` now writes `form.size` from a recognized type's profile (Sloop, Schooner, Brigantine, Frigate, Galleon, Man o' War) the same way it already auto-filled mobility, HP, crew, and explosion DC. A `sizeIsCustom` flag flips when the captain hand-edits Size so the autofill backs off and never stomps a deliberate override. The `<datalist>` was also corrected to use canonical type names so suggestions match the profile lookup keys.
- **Background scrolling locks while a modal is open.** `tokens.css` now carries `html:has(dialog[open]), html:has(dialog[open]) body { overflow: hidden; }`. The selector matches any open native `<dialog>`, so every modal in the app — Charter, Settings, Confirm, Shore leave, Apply flag — locks the page underneath it without per-component plumbing. Both `<html>` and `<body>` are locked because Chrome/Edge attribute the document scroll to `<html>` on some viewports and Firefox/Safari to `<body>`.

v1.0.2 — rules-fidelity pass. v1.0 lands the readiness + preferences slates; v1.0.1 closed the v1.0 UX-audit deferrals; v1.0.2 closes the rules-fidelity audit ([docs/audits/v1.0-rules-audit.md](./docs/audits/v1.0-rules-audit.md)). Cross-referenced every defaulted number, derived display, and condition vocab item against the *Aetherial Expanse Core Book* and corrected the drift. No surface UX changes — same buttons, same shortcuts, same files — but the numbers behind them now match the rulebook on the table.

What changed in v1.0.2:

- **Per-size HP, explosion DC, mobility, and crew defaults match the canonical tables (PDF p. 169 / 189 / 198).** The Hull (max) and Crew max steppers walk in increments of 1 instead of 5 so the canonical odd values (15 HP for a Brigantine, 25 HP for a Man o' War) are reachable without manual typing. Pre-v1.0.2 a chartered Frigate seeded at 35/35 HP and explosion DC 14; both are now 15/15 HP and DC 16, respectively.
- **Canonical ship type profiles (Sloop, Schooner, Brigantine, Frigate, Galleon, Man o' War).** Typing a canonical type into the Charter dialog's Type field (case-insensitive; backed by a `<datalist>`) auto-fills size, mobility, HP, speed, crew, weapon slots, supply caps, and heavy-weapons eligibility from PDF p. 198. Free-text types still work — they fall back to the size-keyed defaults so an ad-hoc "Caravel" gets sensible seeds without being treated as a known hull.
- **Reputation is now four axes (Good / Evil / Lawful / Chaotic).** PDF p. 200 tracks reputation along four alignment axes; ShipSync was using a single signed integer. Each flag now exposes four independent steppers; total reputation (the sum of the four) is what feeds Mettle and conflict resolution. **Old saves migrate automatically** on load — a single-integer reputation lands on the Good axis with the other three at 0, no data loss. The conflict-resolution dialog and bundle parser handle the new shape transparently.
- **Faction flag toggle.** A new "Faction flag" checkbox on each FlagCard marks a flag as belonging to a faction (e.g. the Royal Navy, a guild, a privateer charter) rather than the captain's own colors. Faction flags suppress reputation editing on the card and contribute 0 to the captain's baseline Mettle — a faction's reputation belongs to the faction, not whoever's flying its banner.
- **Mettle baseline now uses only the currently flying flag's reputation.** PDF p. 199 — Beginning Mettle uses *the flag the ship is flying*, not the locker total. The pre-v1.0.2 calc summed every flag in the locker, which could overstate Mettle by 5+ on a multi-flag ship.
- **Officer roster is split Captain / Key (4) / Secondary (5).** PDF p. 198 separates the five Key Officers (Captain, First Mate, Navigator, Helmsperson, Master Gunner) — whose ranks bonus the actions you take most in a fight and who get checked first on casualty rolls — from the five Secondary Stations (Quartermaster, Boatswain, Cook, Shipwright, Surgeon). The roster now renders as three tiers with a divider + tooltip on each so the rulebook's groupings show up on screen.
- **Pursuit gets an explicit Escape Timer (default 6 rounds, PDF p. 181)** alongside the existing Gap counter (default opened to 6, was 5). Both are full participants in pursuit tracking — the pursuer pulls the Gap to 0, the runner pushes the Escape Timer past 0. Old autosaves without the timer field default cleanly on load.
- **Boarding now zeros speed (PDF p. 192).** When `Boarded by` is set on a ship, `speed.squares = 0` and `sceneFlags.speedZero = true` are forced in the same commit, with a hint on the boarded-by row that explains the rule. A boarded ship can't make way; pre-v1.0.2 the captain could edit speed on a boarded ship without ShipSync flagging the contradiction.
- **Condition vocabulary aligned with the rulebook.** `stricken-colors` (an invented name) renamed to `surrendered` (PDF p. 190). `becalmed` (no PDF basis as a scene condition — it's a weather state) dropped from the scene-condition list. Old saves migrate automatically (`stricken-colors` → `surrendered`). The remaining persistent condition `listing` is kept as a deliberate ShipSync convenience for "hull's hit hard, sitting low" with the chip's tooltip explicitly calling that out.
- **Per-ship-type supply caps.** Stepper maxes for Grub / Grog / Gear now derive from the type's canonical caps when known, falling back to size-keyed defaults otherwise. PDF p. 173, Stores & Provisions table.
- **Skeleton crew is now `floor(crewMax / 2)`** (PDF p. 198 — Short-Staffed kicks in *at or below* half max). Pre-v1.0.2 used `floor(crewMax / 4)`, which suppressed the Short-Staffed warning until the crew was already non-functional. The crew hint copy now says "at or below" (was "below") and surfaces the +1 speed bonus rule for full crew.
- **Copy fixes.** False-flag hint no longer claims an inverted-reputation mechanic that doesn't exist. Mettle hint no longer references a "drift toward baseline at start of round" rule that doesn't exist. The example fixture (`v1.example.shipsync.json`) is now a canonical Sloop matching the page-198 profile end-to-end.

v1.0.1 — readiness + preferences polish bundle. v1.0 lands the readiness + preferences slates (centralized Escape, focus trap, `aria-live` toasts, dirty-aware ship remove, undo cap, image cap, settings + dark / density / autosave cadence / carry-forward, `.shipsync.bundle.json` archive format). v1.0.1 closes the three deferred items the v1.0 UX audit flagged:

- **`Cmd+Shift+B` keyboard shortcut for `Save bundle`.** Mirrors v0.4.1's `Cmd+Shift+S` (Save all), v0.8.1's `Cmd+Shift+P` (Print fleet), and v0.9.1's `Cmd+Shift+L` (Shore leave) — same modifier shape, same toast on an empty workspace ("No ships aboard. Load at least one ship before saving a bundle."), same gating so the shortcut won't write an empty archive. The `Save bundle` toolbar button surfaces the shortcut glyph in its tooltip via the existing `shortcutHint` helper. The bundle write is inlined in the keydown handler (rather than calling into the toolbar button's handler) so the shortcut works even when the toolbar button is offscreen or unmounted, matching how `Cmd+S` already works.
- **`Cmd+,` keyboard shortcut for `Preferences`.** The conventional macOS / VSCode preferences shortcut; no browser action sits on it, so no Shift modifier is needed for collision avoidance. Opens the Settings dialog directly — no toast, no preconditions, since preferences are workspace-independent. The Preferences gear-icon button surfaces the shortcut glyph in its tooltip.
- **SettingsDialog carry-forward helpText alignment.** The `Carry forward on Charter` description now enumerates `portraits` alongside `officer names, ranks, statuses, notes` — matching the AddShipDialog hint that runs at the moment of action. Single-line copy fix; brings the two surfaces into agreement and removes a small surprise for users who read only the Preferences panel.

What ships in v1.0:

- **Preferences (gear icon in the workspace top bar).** A single dialog with four cross-cutting choices, persisted to `localStorage` at `shipsync.settings.v1` so they follow you between sessions on this device:
  - **Color scheme** — `Auto` (follow OS `prefers-color-scheme`), `Light`, or `Dark`. Dark mode is implemented as a CSS filter-inversion pass on `<body>` with counter-inversion on `img` / `video` / `canvas` and any element marked `data-counter-invert="true"` so portraits and flag art keep their original colors. Small artifacts on heavy art are expected; the SettingsDialog calls out that limitation inline.
  - **Density** — `Comfortable` (the original spacing) or `Compact` (~25% tighter ship/officer card padding + stepper heights). Routed through `<html data-density>` so any surface can opt into Tailwind's `data-[density=compact]:` variants without per-component plumbing.
  - **Autosave cadence** — Live (3/4s, the v0.9 default), Brisk (2s), Steady (10s), or Relaxed (30s). The setting is read on every `schedule()` call rather than at autosaver construction, so changing the cadence here applies on the next mutation, no reload required.
  - **Carry forward on Charter** — when on, the Charter dialog offers a `Carry forward {donor}'s bridge crew & supplies` checkbox that pre-fills the new ship's officer roster (names, ranks, statuses, notes, portraits) and current Grub/Grog/Gear from the focused ship (or the most recently chartered one if no ship is focused). Per-charter override stays in the dialog, so you can opt out for any individual charter without flipping the global toggle.
  - A `Restore defaults` button in the dialog footer always lands you back on the v1.0 baseline (Auto / Comfortable / 750ms / carry-forward off).
- **`.shipsync.bundle.json` archive format.** A new `Save bundle` toolbar button (next to `Save All`) writes the whole workspace — every ship, the ship order, the active scene, every referenced image — to a single timestamped file (`shipsync-fleet--<iso>.shipsync.bundle.json`). The file is plain JSON: `schema: "shipsync.bundle/v1"`, `savedAt`, `appVersion`, `shipOrder`, `ships`, `scene`, `images`. The existing `Open file` button now sniffs payload contents and routes `.shipsync.bundle.json` files through a parser that returns structured `issues[]` (severity `'error' | 'warn'`) so partial loads surface a follow-up "Bundle had a few quirks" toast instead of failing silently. Loading a bundle into a non-empty workspace requires a `ConfirmDialog`; the replace itself lands as a single undoable commit, so even a confirmed replace can be reversed with `⌘Z`.
- **Dialog hardening.** `Escape` now reliably closes every dialog through a centralized window-level keydown listener in `Dialog.svelte` (the native `<dialog>` `cancel` event still fires; the listener is a defensive backup that catches automation harnesses and custom input handlers that swallow it). A new `focus-trap.js` utility keeps Tab inside open dialogs, re-querying focusable descendants on every tab so dynamically-rendered controls (the two-click confirm/cancel swaps, the Restore-defaults state) keep cycling through the currently-rendered set.
- **`prefers-reduced-motion` honored globally.** A single rule in `tokens.css` collapses animations, transitions, and scroll-behavior to `0.01ms` (rather than `0`) for users with the OS-level motion-reduction preference, so transitions still snap to their final state without per-component plumbing.
- **Toast announcements (`aria-live`).** The toast container is now rendered unconditionally with `role="region"` + `aria-live="polite"` so screen readers reliably announce the very first toast — toasts only get announced when the live region was *already present* at the time of the announcement, so gating the container on `ui.toasts.length > 0` would have caused the first save / undo / shore-leave toast to land silently.
- **Dirty-aware ship remove.** `Remove from workspace` now opens a `ConfirmDialog` instead of `window.confirm`. If the ship has unsaved edits, the body warns explicitly ("This isn't covered by Undo.") and the confirm label changes to `Discard changes & remove` so a captain can choose to save first and then come back. Clean ships still confirm, just with shorter copy.
- **Undo-stack cap (200 entries) with a soft hint.** The undo stack is bounded to keep long sessions from growing the autosave snapshot unboundedly. When older actions are pruned, the Activity Log appends a small italic line at the bottom of the visible feed — "{N} earlier actions pruned to keep history light — those steps can't be undone." — so a user who runs into the cap learns *why* the oldest action just stopped being undoable.
- **Image-store size cap (10 MB) with a warning toast.** Image setters (`setShipPortrait`, `setOfficerPortrait`, `setPlayerCharacterPortrait`, `setShipFlagArt`) now project the would-be byte total *before* commit, accounting for the bytes pruning will free, and reject oversized uploads with a toast that names the file, the projected size, and the cap ("ship.png is too big — workspace would hold 11.4 MB, cap is 10.0 MB. Trim or replace existing portraits/flag art first."). Replacement uploads — the common case — still work even when the new image is large, because pruning the old one's bytes counts toward the projection.

v0.9.1 — fleet-maneuvers polish bundle. v0.9 lands shore leave / sail order / flag templates; v0.9.1 closes the three deferred efficiency items the v0.9 audit flagged on H7:

- **`Cmd+Shift+L` keyboard shortcut for `Shore leave`.** Mirrors v0.4.1's `Cmd+Shift+S` (Save all) and v0.8.1's `Cmd+Shift+P` (Print fleet) — same modifier shape, same toast on an empty workspace ("No ships aboard. Load at least one ship before calling shore leave."), same gating so the shortcut won't open a useless dialog. The `Shore leave` toolbar button surfaces the shortcut glyph in its tooltip via the existing `shortcutHint` helper.
- **`ApplyFlagDialog` autofocus.** Opening the dialog now drops focus on the first non-disabled target row's checkbox — a keyboard-only user no longer has to tab past the dialog close button and the legend before reaching an interactive control. Mirrors `ShoreLeaveDialog`'s autofocus on its first NumberStepper. If every other ship clashes (the empty-eligible case), focus stays on the dialog default and the existing amber caption tells the user what to do.
- **`Alt+Up` / `Alt+Down` shortcut on focused ship cards.** A power user with keyboard focus on a ship's fleet-rail card can press `Alt+↑` / `Alt+↓` to run the same move-up / move-down action the chevron buttons fire. Edge-aware: a no-op at the head or tail of the line, never a clamp surprise. Tooltips on the visible Move-up / Move-down buttons advertise the shortcut so it's discoverable from the mouse-driven path.

v0.9 base scope:

- **Shore leave.** A `Shore leave` button in the workspace top bar (between the autosave indicator and `Save All`) opens a fleet-level refit dialog. Pre-selects every loaded ship (the common case is a port stop), exposes Hull / Grub / Grog / Gear steppers, an optional `Clear scene conditions` checkbox (drops `Heeling` / `In Irons` / `Crossing the T` chips on each selected ship — persistent ship conditions stay put), and a free-text `Source` field that lands in the log entries (e.g. "Tortuga", "Port Royal"). Live preview shows both a workspace summary line ("Shore leave on Lassie, Black Pearl, Interceptor (Tortuga).") and a per-ship breakdown computed from the same `composeShoreLeaveSummary` helper that writes the actual log lines. Hull is clamped at each ship's headroom (`hp.max - hp.current`); supplies are added with no upper bound. Two-click confirm. The whole batch lands as **one atomic commit on the undo stack** with per-ship Captain's-Log entries appended for narrative detail.
- **Sail order.** Each card in the fleet rail now carries Move-up / Move-down chevron buttons on its right edge; one click swaps the ship one slot earlier or later in `workspace.shipOrder`, with a directed Activity-Log line ("Sailed Lassie ahead of Black Pearl."). Disabled at the head/tail of the line, with position-aware tooltips ("Already at the head of the line." / "Sail Lassie ahead one slot · ⌥↑."). One swap = one click = one undo step. The fleet print view (v0.8) renders ships in this order, so a captain can sequence the printed packet without touching JSON. The `setShipOrder(newOrder)` permutation primitive is exposed for a future drag-and-drop UI to land without a state-shape rewrite.
- **Flag templates.** Every flag card in the `Colors Aloft` section now has an `Apply to other ships…` button that opens a target-picker dialog. Multi-select target ships, optional `Hoist this banner after copying` checkbox (raises the new copy as the flying flag on every target), live preview ("Will copy 'The Black Spear' from Lassie to 2 ships."), two-click confirm. Each copy gets a fresh flag id — independent of the source — so future reputation changes on either flag won't propagate back to the other (a deliberate divergence from v0.5's "raise existing flag id on a new hull" path, called out in the dialog description). Name-based dedup (case- and whitespace-insensitive) skips any target already flying a banner with the same name; clashing rows are disabled in the picker AND re-checked at the state layer, with an amber caption when every other ship clashes ("Every other ship already flies a banner with this name. Strike or rename one to clear a slot."). Toast feedback covers all three outcomes — pure success, mixed (some applied, some skipped), and warning (nothing applied because everyone clashed).

v0.8 carryovers still in effect:

- **Damage composer / Repair flow.** `Take damage` / `Repair` buttons in the Combat Readiness footer open inline panels for one-commit multi-resource events with live previews and two-click confirm.
- **Fleet print.** `Print fleet` toolbar button opens `?print=fleet` in a fresh tab — one `ShipPrintSheet` per loaded ship with hard page breaks. Single-ship `?print=<shipId>` route still in place.
- **`Cmd+Shift+P` keyboard shortcut for `Print fleet`** + composer first-input auto-focus (v0.8.1 polish).

v0.7 carryovers still in effect:

- **End scene.** A footer affordance in the right-rail Scene panel resets every ephemeral scene field — round, phase, wind, weather gage, pursuit, sighted ships, scene-only conditions — *and* clears `Boarded by` on every player ship in one undoable commit. Two-click confirm with a live "Resetting: …" preview. Persistent ship state (HP, crew, fires, supplies, journal, persistent conditions) is left alone.
- **Activity Log filters.** Per-ship chip group + Combat / Crew / Refit / Journal segmented control above the workspace activity feed. Filters AND together. Counts in the header show "{matching} / {scanned}". Filters are session ergonomics, not persisted; the undo stack is untouched. The new `ship.damage` and `ship.repair` log lines bucket under Combat.
- **Officer "Duties & quirks".** Free-text textarea on every officer station, capped at 600 characters, persisted with the ship file, surfaced inline on the print sheet under each station's name.
- **Flag locker memory.** The "Show all flags" disclosure remembers its open/closed state per ship in `localStorage`.
- **Session metadata.** Each session entry has Played / Location / Encounter free-text fields (active and past), surfaced as a concatenated subhead on the print sheet.
- **Print sheet (single ship).** Every ship has a "Print sheet" header action that opens `?print=<shipId>` in a fresh tab — read-only, hydrates from autosave, single-column print-friendly layout.

v0.6 carryovers still in effect:

- **Past sessions are editable.** Closed entries in the per-ship Captain's Log keep their title and narrative inputs, so you can polish a chapter after the fact — useful when the table remembers a beat hours after the session closed. There's no Reopen button by design: undo handles accidental closes, and a manual Reopen would have to fight the auto-logger's "at most one open session" rule.
- **Flag locker collapse.** When a ship carries more than three flags, the non-flying entries tuck behind a "Show all flags · {N} more in the locker" disclosure. The currently-flying flag is always promoted into the visible group, even if its array position would otherwise hide it, so "what colors am I flying right now?" is always answerable without expanding the locker.
- **Officer casualty rollup.** The Bridge Crew header carries an inline pill that summarizes ship-level officer state — `1 STRICKEN` in amber the moment any station is wounded, `1 DEAD` (or `1 stricken · 1 dead`) in crimson the moment any station is recorded dead. A clean bridge shows nothing, just the existing `9 of 10 on station` count.
- **Ship conditions** with a deliberate **mixed-persistence model**: persistent chips (`Listing`, `Surrendered`) ride along in `.shipsync.json` because they describe damage / surrender state that survives the next session; scene-only chips (`Heeling`, `In Irons`, `Crossing the T`) ride along in autosave only and reset on a fresh workspace load because they describe tactical positioning that only matters while a fight is on. Each row tells you which side of that line it's on right above the chips ("Saved with the ship" vs "Resets when you reload the workspace"). Each chip carries a one-line sailor's gloss tooltip from the rules.

v0.5 carryovers still in effect:

- **Combat Readiness**: Mettle (current + a free-text notes scratchpad), Crew (current with skeleton-mark watchdog; tone goes crimson at zero crew), and Fires steppers, each colored to its situation. Crew max and the skeleton mark live in a collapsed "refit / recruitment" sub-section so refit-time controls don't crowd mid-fight controls.
- **Colors Aloft**: per-ship flag roster with art uploads, "False flag" / "Pirate flag" toggles, a Reputation stepper that's **shared across every workspace ship flying the same flag id**, and three named controls — *Hoist this one* (set this flag flying), *Lower colors* (stop flying anything; the flag stays in the locker), and *Strike this flag* (remove the flag from this ship's locker entirely; undo restores). When two loaded saves disagree on a flag's reputation, an amber conflict banner names the disagreement and offers a one-click "Match this ship" resolution.
- **Captain's Log (per-ship narrative)**: an editable Session title and Narrative textarea on the latest open session plus a "Close session" button that stamps `endedAt` on the current entry. The workspace-wide **Activity Log** on the right rail still tracks every commit chronologically for undo / redo, so the two surfaces own different jobs and no longer share a name.

Captain's-Log coalescing: rapid-fire combat-resource clicks within the same scene round (Mettle, Crew, Fires) collapse into a single undo step and a single log line that grows from the chain's start value to its current one (`Mettle 1 → 3` rather than three separate entries). Crossing a round boundary or switching to a different stat breaks the chain so the next edit reads as a fresh entry. Notes / max / skeleton edits stay un-coalesced so prose and refit decisions show up individually.

Scene state — round, phase, wind, weather gage, pursuit, sighted ships, and the scene-only ship conditions — remains ephemeral as in v0.4: it rides along in the autosave snapshot so a refresh won't lose your place, but it's never written into the per-ship `.shipsync.json` files. Save those when you want to capture the ship itself. v0.7's End-scene action is the explicit reset for the same surface — clears all of the above plus boarding pointers in one undoable commit.

## Run

```bash
npm install
npm run dev          # vite dev server on http://localhost:5173
npm run build        # production bundle to dist/
npm run preview      # preview the production bundle locally
npm test             # run the vitest unit suite
npm run lint         # eslint
npm run format       # prettier --write
```

Node ≥ 22 is required (we lean on the standard `localStorage` shape that newer Node versions also expose).

## Deploy to GitHub Pages

Push to `main` and the workspace is live at `https://<user>.github.io/<repo>/` — no manual build, no branch wrangling. The wiring is two files:

- `.github/workflows/deploy.yml` runs `npm ci && npm run build` on every push to `main`, uploads `dist/` as a Pages artifact, and publishes through `actions/deploy-pages`. It auto-detects the deployed URL shape: a project repo gets `BASE_PATH=/<repo>/`; a `<user>.github.io` user-page repo gets `BASE_PATH=/`. Forks don't have to edit anything.
- `vite.config.js` reads `BASE_PATH` (default `/`) so every asset URL in the built `index.html` is repo-scoped. Without this, the deployed page silently 404s its JS / CSS bundles and renders blank.

One-time setup on a new repo:

1. Push the project to GitHub.
2. Repo Settings → Pages → **Source: GitHub Actions**.
3. Trigger the first run by pushing to `main` (or running the workflow manually from the Actions tab).

That's the whole loop. Local `npm run dev` and `npm run build` are unaffected — both default to `BASE_PATH=/` and behave exactly as they did pre-deploy.

## How saves work

Two save formats. Pick the one that matches the moment.

- **Per-ship file** (`<ship name>.shipsync.json`). One ship per file, one file per ship — the format we've used since v0.1. A four-captain party can split four files between four players, or load all of them into one workspace at once. The double `.shipsync.json` extension keeps it openable in any text editor while still pairing nicely with macOS / Windows file dialogs. `Cmd/Ctrl+S` writes the focused ship; `Cmd/Ctrl+Shift+S` writes every ship that has unsaved edits.
- **Workspace bundle** (`shipsync-fleet--<iso>.shipsync.bundle.json`, **new in v1.0**). One file per workspace — every loaded ship, the ship order, the active scene, every referenced image. Useful when you want to hand a full session over to another captain, snapshot a campaign between sessions, or back up the lot. Click `Save bundle` in the workspace top bar (next to `Save All`). Loading a bundle into a non-empty workspace prompts a `ConfirmDialog` before discarding what's currently loaded; the load itself is undoable.
- **Bundled images**. Portrait and flag art is stored as base64 data URLs *inside* the save file (per-ship or bundle), so files are portable and self-contained. There's a per-image hard cap (8 MB) and a per-workspace soft cap (10 MB, **new in v1.0**) that rejects oversized uploads with a warning toast naming the file, the projected size, and the cap.
- **Non-player ships are not persisted to per-ship files.** They live as lightweight notes in the workspace and ride along in autosave + workspace bundles only; close the tab without saving a bundle and they're gone.

There's also a separate browser-local autosave (in `localStorage`) that snapshots your *whole workspace* on every edit. That's strictly for crash recovery — it shows up as a "Welcome back" banner on next load. Saving to file is always explicit. Preferences (color scheme, density, autosave cadence, carry-forward) are persisted separately at `shipsync.settings.v1` so they follow you between sessions on this device.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
|--------|-------|------------------|
| Save the focused ship to a file | ⌘S | Ctrl+S |
| Save every changed ship | ⌘⇧S | Ctrl+Shift+S |
| Save the workspace as a bundle | ⌘⇧B | Ctrl+Shift+B |
| Open the fleet print sheet in a new tab | ⌘⇧P | Ctrl+Shift+P |
| Open the Shore leave dialog | ⌘⇧L | Ctrl+Shift+L |
| Open the Preferences dialog | ⌘, | Ctrl+, |
| Reorder the focused ship card up / down | ⌥↑ / ⌥↓ | Alt+Up / Alt+Down |
| Undo last edit | ⌘Z | Ctrl+Z |
| Redo | ⌘⇧Z or ⌘Y | Ctrl+Shift+Z or Ctrl+Y |

Buttons that have a shortcut also surface the glyph in their tooltip.

## Project layout

```
src/
  routes/
    Dashboard.svelte         # top-level shell; mounts the three columns
  lib/
    domain/                  # types, rules constants, pure derivations, validators
    state/                   # svelte 5 $state stores (workspace + transient UI)
    persistence/             # save-file format, load-file parser, autosave, migrations
    features/
      workspace/             # top bar, autosave indicator, load button
      fleet/                 # rail, ship card, add-ship dialog, save button
      ship/                  # ship detail view
      scene/                 # phase / round / wind panel
      activityLog/           # workspace activity feed + undo/redo controls
    ui/                      # primitives: Button, Dialog, Field, Toast, etc.
docs/
  audits/                    # heuristic audits per release (v0.1 lives here)
```

## Design references

- `docs/audits/v0.1-ux-audit.md` — Nielsen-heuristic self-audit of the v0.1 shell, with code citations and the recommendations we acted on before cutting v0.1.
- `docs/audits/v0.2-ux-audit.md` — delta audit of the v0.2 inline ship editor (Particulars / Captain / Player character) on top of the v0.1 baseline.
- `docs/audits/v0.3-ux-audit.md` — delta audit of the v0.3 Bridge Crew + Stores + Save All + autosave-retry surface, with the v0.2 deferred items confirmed closed.
- `docs/audits/v0.4-ux-audit.md` — delta audit of the v0.4 Scene panel + boarding field, plus how the v0.3 deferred items folded in.
- `docs/audits/v0.5-ux-audit.md` — delta audit of the v0.5 Combat readiness + Colors Aloft + per-ship Captain's Log, including the coalescing-summary reactivity fix.
- `docs/audits/v0.6-ux-audit.md` — delta audit of the v0.6 past-session edits + flag locker collapse + officer casualty rollup + ship conditions section, with the deferred F7.1 disclosure-memory recommendation called out.
- `docs/audits/v0.7-ux-audit.md` — delta audit of the v0.7 scene lifecycle + Activity Log filters + officer notes + flag-locker memory + session metadata + print sheet. The v0.6 F7.1 finding is closed (locker memory shipped); a label-table inconsistency surfaced by PrintView (raw enum strings in the dashboard ship-header subtitle) was folded in during the audit pass.
- `docs/audits/v0.8-ux-audit.md` — delta audit of the v0.8 damage composer + repair flow + fleet print, with the v0.8.1 polish bundle closing both H7 findings (F7.1 `Cmd+Shift+P` shortcut for `Print fleet` + tooltip glyph; F7.2 composer first-input auto-focus via the new `NumberStepper.autofocus` prop). Final verdict: PASS on all ten heuristics. Also notes a v0.7 print-sheet bug (`officerCasualtyTally` arity mismatch) that the `ShipPrintSheet` extraction silently fixed.
- `docs/audits/v0.9-ux-audit.md` — delta audit of the v0.9 Shore Leave + Sail Order + Flag Templates surface, with the v0.9.1 polish bundle closing all three H7 findings (F7.1 `Cmd+Shift+L` shortcut for `Shore leave` + tooltip glyph; F7.2 first-eligible-target autofocus on `ApplyFlagDialog`; F7.3 `Alt+Up` / `Alt+Down` reorder shortcuts on focused fleet-rail cards + tooltip glyphs). Final verdict: PASS on all ten heuristics. The slate's stated value lands in full — fleet-wide refit / reorder / banner-copy each go from N visits to N ships down to one undoable apply.
- `docs/audits/v1.0-ux-audit.md` — delta audit of the v1.0 readiness + preferences surface (centralized Escape, focus trap, `aria-live` toasts, `prefers-reduced-motion`, dirty-aware ship remove, undo cap with pruned-history hint, image-store cap, SettingsDialog with color scheme / density / autosave cadence / carry-forward, dark mode via filter inversion, `.shipsync.bundle.json` archive format). H1–H6, H8, H9, H10 PASS; H7 PARTIAL pending three minor fold-ins for a future v1.0.1 polish bundle (F7.1 `Cmd+Shift+B` shortcut for `Save bundle`; F7.2 `Cmd+,` shortcut for Preferences; F10.1 align Preferences carry-forward helpText with the AddShipDialog hint).
- The `/ship-combat-rules` skill is the authoritative source for game mechanics. ShipSync renders derivations *of* those rules but does not reproduce or replace them.
- The `/ux-heuristic-audit` skill is the rubric the audits were scored against.
