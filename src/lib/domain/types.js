/**
 * Domain types for ShipSync. JSDoc only; no runtime behavior.
 * Every shape traces back to a section of /ship-combat-rules.
 */

/**
 * @typedef {'tiny'|'small'|'medium'|'large'|'huge'|'gargantuan'} ShipSize  // §1
 * @typedef {'high'|'balanced'|'low'} Mobility                              // §1
 * @typedef {'N'|'NE'|'E'|'SE'|'S'|'SW'|'W'|'NW'} Cardinal                  // §6.0
 * @typedef {'captain'|'firstMate'|'quartermaster'|'navigator'|'helmsperson'
 *          |'boatswain'|'cook'|'masterGunner'|'shipwright'|'surgeon'} StationKey   // §4
 * @typedef {1|2|3|4|5} OfficerRank                                         // §4
 * @typedef {'active'|'stricken'|'dead'} OfficerStatus                      // §4
 * @typedef {'idle'|'combat'|'pursuit'} SceneMode
 * @typedef {'idle'|'movement'|'attack'|'status'} Phase                     // §6
 * @typedef {'hostile'|'neutral'|'allied'|'unknown'} Disposition
 * @typedef {'adjacent'|'short'|'standard'|'long'|'far'|'unknown'} RangeBand // §6.2
 *
 * Ship conditions split by persistence class:
 *  - Persistent conditions live on the Ship and ride along in `.shipsync.json`.
 *    They describe state that's still meaningful next session — surrender, etc.
 *  - Scene conditions live in workspace.scene.shipConditions, in the autosave
 *    snapshot only. They reset every time the player loads a fresh workspace.
 *    These describe tactical positioning / wind state that only matters
 *    while a fight is on.
 *
 * @typedef {'surrendered'} PersistentShipCondition
 * @typedef {'heeling'|'in-irons'|'crossing-t'} SceneShipCondition
 */

/**
 * @typedef {Object} Officer
 * @property {string|null} name
 * @property {OfficerRank} rank
 * @property {OfficerStatus} status
 * @property {string|null} portraitImageId
 * @property {string} notes        // §4 v0.7 — free-text duties / quirks. Empty string when absent. Persisted with the ship.
 */

/**
 * @typedef {Object} Officers
 * @property {Officer} captain
 * @property {Officer} firstMate
 * @property {Officer} quartermaster
 * @property {Officer} navigator
 * @property {Officer} helmsperson
 * @property {Officer} boatswain
 * @property {Officer} cook
 * @property {Officer} masterGunner
 * @property {Officer} shipwright
 * @property {Officer} surgeon
 */

/**
 * @typedef {Object} Crew
 * @property {number} current
 * @property {number} max
 * @property {number} skeleton
 */

/**
 * @typedef {Object} Mettle
 * @property {number} current
 * @property {string} notes
 */

/**
 * Reputation axes per the Reputation Types table (PDF p. 200). Each is a
 * non-negative running tally; the rulebook says reputation can never go
 * negative and that the four axes are tracked independently. The
 * `total` reputation surfaced in mettle / fame calculations is the sum
 * across all four axes.
 *
 * @typedef {'good'|'evil'|'lawful'|'chaotic'} ReputationAxis
 */

/**
 * @typedef {Object} Reputation
 * @property {number} good       // ≥ 0 — heroism, mercy, charity
 * @property {number} evil       // ≥ 0 — cruelty, ruthlessness
 * @property {number} lawful     // ≥ 0 — order, oaths, chartered service
 * @property {number} chaotic    // ≥ 0 — piracy, freelancing, broken oaths
 */

/**
 * @typedef {Object} Flag
 * @property {string} id           // canonical id, shared across ship files (e.g. "the-black-spear")
 * @property {string} name
 * @property {boolean} isFalse     // §3 false flag - rep gains/losses go to disguised flag
 * @property {boolean} isPirate    // §3 black/red flag
 * @property {boolean} isFaction   // §3 — faction flags (a chartered nation, the Black Banner, a navy) don't accrue ship-level reputation; the suite of axis steppers is suppressed in the UI when this is on.
 * @property {string|null} artImageId
 * @property {Reputation} reputation
 */

/**
 * @typedef {Object} FlagState
 * @property {Flag[]} flown        // all flags currently on this ship
 * @property {Flag[]} known        // historical flags this ship has rep with
 * @property {string|null} flyingId  // id of active flag among `flown`
 */

/**
 * @typedef {Object} WeaponSlots
 * @property {number} bow
 * @property {number} port
 * @property {number} starboard
 * @property {number} stern
 * @property {boolean} heavyEligible   // §1 only Frigates/Galleons/Man o' Wars
 */

/**
 * One weapon mount in a side's slot bank. v1.0.4 — tracks *what* is sitting
 * in each slot, not just the count. The `slotsOccupied` field lets a single
 * heavy piece (e.g. a large cannon) eat multiple slots without forcing a
 * separate row per slot.
 *
 * The slot-count stepper in `WeaponSlots` is auto-derived from the sum of
 * `slotsOccupied` across each side's mounts; the user only edits the list.
 *
 * @typedef {Object} WeaponMount
 * @property {string} id                    // stable id; assigned at creation
 * @property {string} name                  // free-text (e.g. "Ballista", "Falconet", "Large cannon")
 * @property {number} slotsOccupied         // ≥ 1 — how many of this side's slots this piece eats
 */

/**
 * Per-side inventory of mounts. Sides match `WeaponSlots`. Missing or
 * malformed sides default to an empty array on load — see
 * `loadFile.js#repairShip`. Mounts are user-ordered (no fixed sort) so a
 * captain can reflect physical placement (e.g. "forward starboard ballista,
 * aft starboard falconet").
 *
 * @typedef {Object} WeaponInventory
 * @property {WeaponMount[]} bow
 * @property {WeaponMount[]} port
 * @property {WeaponMount[]} starboard
 * @property {WeaponMount[]} stern
 */

/**
 * @typedef {Object} Supplies
 * @property {number} grub        // §2 food/water
 * @property {number} grog        // §2 alcohol
 * @property {number} gear        // §2 ship components for repair
 */

/**
 * @typedef {Object} Resources
 * @property {number} fuel
 * @property {Record<string, number>} ammoByType   // §6.2 e.g. { chainshot: 4, hullbusters: 2 }
 */

/**
 * @typedef {Object} SceneFlags
 * @property {boolean} inIrons             // §6.1
 * @property {boolean} hasWeatherGage      // §6.0
 * @property {string[]} adjacentToShipIds  // ids of loaded or other ships
 * @property {Cardinal|null} facing
 * @property {boolean} speedZero           // ship at 0 speed (boarding precondition §6.2)
 */

/**
 * @typedef {Object} PlayerCharacter
 * @property {string} characterName
 * @property {string} traits
 * @property {string|null} portraitImageId
 */

/**
 * @typedef {Object} Ship
 * @property {string} id
 * @property {string} name
 * @property {ShipSize} size
 * @property {string} type                 // free text e.g. "Sloop", "Frigate"
 * @property {Mobility} mobility
 * @property {{ knots: number, squares: number }} speed
 * @property {{ current: number, max: number }} hp
 * @property {number} explosionDC
 * @property {WeaponSlots} weapons
 * @property {WeaponInventory} weaponInventory
 * @property {Supplies} supplies
 * @property {Resources} resources
 * @property {Crew} crew
 * @property {Officers} officers
 * @property {Mettle} mettle
 * @property {FlagState} flags
 * @property {SceneFlags} sceneFlags
 * @property {number} fires
 * @property {string|null} boardedBy        // §6.2 free-text name of a boarding partner; null when not locked together
 * @property {string|null} portraitImageId
 * @property {PlayerCharacter|null} [playerCharacter]   // legacy v1.0 field — folded into officers.captain by `migrateLegacyPlayerCharacter` on load. Optional so new ships don't carry it.
 * @property {string|null} lastModifiedAt              // v1.0.4 — ISO of the most recent in-workspace mutation. Drives the "unsaved" indicator. Replaces the per-ship `sessionHistory` field.
 * @property {PersistentShipCondition[]} conditions     // §6 persistent state: surrendered. Rides along in saved ship file.
 */

/**
 * Ephemeral non-player ship tracked in the current scene only — never persisted to disk
 * (per the v0.1 product rule that non-player vessels don't need to survive a workspace
 * close). Lighter-weight than `Ship`: just the things a player wants to glance at while
 * the fight is happening.
 *
 * @typedef {Object} SceneShip
 * @property {string} id
 * @property {string} name
 * @property {ShipSize} size
 * @property {Mobility} mobility
 * @property {Disposition} disposition
 * @property {{ current: number, max: number }} hp
 * @property {number} explosionDC
 * @property {number} fires
 * @property {string} threat                  // free-text note (e.g. "carrying mortars; close range only")
 */

/**
 * Pursuit / chase tracker (§7) — lite shape per v0.4 product decision: Gap counter,
 * pursuer/quarry pointers (each may reference a player ship id OR a scene ship id),
 * and a free-text escape condition. The `escapeTimer` countdown matches the PDF's
 * "n rounds of free running" affordance on p. 181: when it ticks to 0, the chase
 * either resolves or the GM rolls fresh consequences. Existing files default to
 * `PURSUIT_DEFAULT_ESCAPE_TIMER` rounds when the field is missing.
 *
 * @typedef {Object} Pursuit
 * @property {boolean} active                 // toggle for whether the tracker is open
 * @property {string|null} pursuerId          // ship id (player or scene)
 * @property {string|null} quarryId
 * @property {number} gap                     // §7 — 0 catches, 10+ escapes (default 6)
 * @property {number} escapeTimer             // §7 — rounds of free running until the chase resolves (default 6)
 * @property {string} escapeCondition         // free-text (e.g. "reach Port Skerry", "the storm hits")
 */

/**
 * @typedef {Object} Scene
 * @property {SceneMode} mode
 * @property {Cardinal} windDirection
 * @property {string|null} weatherGageHolderId   // refs a player ship id OR a scene ship id
 * @property {number} round
 * @property {Phase} phase
 * @property {Record<string, SceneShip>} sceneShips
 * @property {string[]} sceneShipOrder           // deterministic display order
 * @property {Pursuit|null} pursuit
 * @property {Record<string, SceneShipCondition[]>} shipConditions   // per-ship scene conditions; ephemeral (autosave only).
 */

/**
 * @typedef {Object} LogAction
 * @property {string} id
 * @property {string} timestamp                       // ISO
 * @property {string} kind
 * @property {string} summary
 * @property {object} before
 * @property {object} after
 * @property {string|null} shipId                     // null for scene-level events fanned out
 */

/*
 * The v0.5–v1.0.3 `SessionEntry` typedef lived here. v1.0.4 retired the
 * Captain's-Log-as-narrative feature: the global Activity Log is now the
 * single chronological surface, renamed to "Captain's Log" in the right
 * rail. Per-ship "unsaved" state is tracked by `Ship.lastModifiedAt`.
 *
 * Loading a save written by v1.0.3 or earlier still works — see
 * `migrateLegacySessionHistory` in loadFile.js, which folds the max action
 * timestamp into `lastModifiedAt` and drops the rest of the entry.
 */

/**
 * Map of imageId -> data URL. Lives at the workspace level.
 * When saving a ship file, only the images referenced by that ship are bundled.
 * @typedef {Record<string, string>} ImageStore
 */

/**
 * On-disk format. One ShipFile per .shipsync.json file.
 * @typedef {Object} ShipFile
 * @property {1} schemaVersion
 * @property {string} createdAt
 * @property {string|null} lastSavedBy   // optional human-set name (Heuristic 9 mitigation)
 * @property {Ship} ship
 * @property {ImageStore} images
 */

/**
 * Runtime workspace shape (never persisted to disk; only in localStorage for crash recovery).
 * @typedef {Object} Workspace
 * @property {Record<string, Ship>} ships
 * @property {string[]} shipOrder              // deterministic display order in left rail
 * @property {Scene} scene
 * @property {ImageStore} images
 * @property {string|null} focusedShipId
 * @property {Record<string, string>} lastSavedAtByShipId   // ISO timestamps per ship id
 */

/**
 * Result of detectFlagConflicts. Each entry carries the full Reputation object
 * for the flag on that ship; the conflict UI displays the four-axis tally and
 * the total. Reputation can never be negative on any axis, but ships can still
 * disagree if one was saved after a raid that bumped the rep on a single axis
 * for one ship while the other ship's file was untouched.
 *
 * @typedef {Object} FlagConflict
 * @property {string} flagId
 * @property {string} flagName
 * @property {Array<{ shipId: string, shipName: string, reputation: Reputation }>} entries
 */

export {} // marker so this is treated as a module by checkJs
