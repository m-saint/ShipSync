/**
 * Static constants from the Aetherial Expanse Core Book. No derivations live
 * here. Values that map to PDF tables cite the page so future audits can
 * verify them quickly without re-extracting the rulebook.
 */

/** @type {import('./types.js').ShipSize[]} */
export const SHIP_SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']

/**
 * Title-cased labels for the lowercase enum values. Selects render OS-native
 * popups that don't pick up Tailwind's `capitalize` class on the trigger, so
 * we route all visible strings through these tables to keep the popup and
 * the closed trigger text in sync (v0.4.1 audit fix F4.2).
 *
 * @type {Record<import('./types.js').ShipSize, string>}
 */
export const SHIP_SIZE_LABELS = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
}

/** @type {import('./types.js').Mobility[]} */
export const MOBILITY_OPTIONS = ['high', 'balanced', 'low']

/** @type {Record<import('./types.js').Mobility, string>} */
export const MOBILITY_LABELS = {
  high: 'High',
  balanced: 'Balanced',
  low: 'Low',
}

/** @type {import('./types.js').Cardinal[]} */
export const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** @type {import('./types.js').Disposition[]} */
export const DISPOSITIONS = ['hostile', 'neutral', 'allied', 'unknown']

/** @type {Record<import('./types.js').Disposition, string>} */
export const DISPOSITION_LABELS = {
  hostile: 'Hostile',
  neutral: 'Neutral',
  allied: 'Allied',
  unknown: 'Unknown',
}

/** @type {import('./types.js').Phase[]} */
export const PHASES = ['idle', 'movement', 'attack', 'status']

/** @type {Record<import('./types.js').Phase, string>} */
export const PHASE_LABELS = {
  idle: 'Idle',
  movement: 'Movement',
  attack: 'Attack',
  status: 'Status',
}

/** @type {import('./types.js').StationKey[]} */
export const STATIONS = [
  'captain',
  'firstMate',
  'quartermaster',
  'navigator',
  'helmsperson',
  'boatswain',
  'cook',
  'masterGunner',
  'shipwright',
  'surgeon',
]

/**
 * The five Key Officers per page 198. Their bonuses and casualty handling
 * matter most during a fight; the OfficerRoster surfaces them as a
 * separately-grouped block above the secondaries.
 *
 * @type {import('./types.js').StationKey[]}
 */
export const KEY_STATIONS = [
  'captain',
  'firstMate',
  'navigator',
  'helmsperson',
  'masterGunner',
]

/** @type {import('./types.js').StationKey[]} */
export const SECONDARY_STATIONS = STATIONS.filter((s) => !KEY_STATIONS.includes(s))

/**
 * Persistent ship conditions ride along in `.shipsync.json`: they describe
 * state that's still relevant the next time the player loads the ship.
 *
 * `surrendered` lines up with Strike Colors / Surrender on page 190 — the
 * ship has yielded the fight. Distinct from "no flag flown" (intentional
 * concealment with `flyingId === null`) because surrender is a public act
 * that signals into the next session.
 *
 * `listing` is a ShipSync convenience for "the hull's been hit hard enough
 * that it sits low and lopsided." The rulebook doesn't define a discrete
 * "listing" status; we keep it as a player-set flag for at-a-glance hull
 * condition since the chip is genuinely useful at the table.
 *
 * @type {import('./types.js').PersistentShipCondition[]}
 */
export const PERSISTENT_SHIP_CONDITIONS = ['listing', 'surrendered']

/** @type {Record<import('./types.js').PersistentShipCondition, string>} */
export const PERSISTENT_CONDITION_LABELS = {
  listing: 'Listing',
  surrendered: 'Surrendered',
}

/** @type {Record<import('./types.js').PersistentShipCondition, string>} */
export const PERSISTENT_CONDITION_HINTS = {
  listing:
    'Hull leaning low and lopsided. House-rule chip — flip it on after a heavy hit; clear it once the shipwright patches things up.',
  surrendered:
    'Colors struck (page 190). The ship has yielded the fight. Different from flying no flag (which can be intentional concealment); surrender is public and carries into the next session.',
}

/**
 * Scene-only ship conditions live in `workspace.scene.shipConditions` and ride
 * along in autosave only — they reset every fresh workspace load. They
 * describe tactical positioning / wind state that only matters while a fight
 * is unfolding.
 *
 * Each condition lines up with a defined PDF rule on page 187:
 *   - heeling   — leaning hard from the wind or a tight turn
 *   - in-irons  — caught with the bow into the wind
 *   - crossing-t — lined up across an enemy's bow or stern
 *
 * @type {import('./types.js').SceneShipCondition[]}
 */
export const SCENE_SHIP_CONDITIONS = ['heeling', 'in-irons', 'crossing-t']

/** @type {Record<import('./types.js').SceneShipCondition, string>} */
export const SCENE_CONDITION_LABELS = {
  heeling: 'Heeling',
  'in-irons': 'In Irons',
  'crossing-t': 'Crossing the T',
}

/** @type {Record<import('./types.js').SceneShipCondition, string>} */
export const SCENE_CONDITION_HINTS = {
  heeling:
    'Leaning hard from the wind or a tight turn. Gunnery suffers this round.',
  'in-irons':
    "Caught with the bow into the wind — no way on. The helmsperson has to fall off before you'll move again.",
  'crossing-t':
    "Lined up across an enemy's bow or stern. A full broadside answers nothing in return.",
}

/** @type {Record<import('./types.js').StationKey, string>} */
export const STATION_LABELS = {
  captain: 'Captain',
  firstMate: 'First Mate',
  quartermaster: 'Quartermaster',
  navigator: 'Navigator',
  helmsperson: 'Helmsperson',
  boatswain: 'Boatswain',
  cook: 'Cook',
  masterGunner: 'Master Gunner',
  shipwright: 'Shipwright',
  surgeon: 'Surgeon',
}

/** Damage threshold per size (PDF p. 170). */
export const DAMAGE_THRESHOLD_BY_SIZE = {
  tiny: 15,
  small: 15,
  medium: 20,
  large: 20,
  huge: 20,
  gargantuan: 25,
}

/**
 * Hit-points-by-size starting defaults, straight from the Ship Hit Points and
 * Mobility table on page 169. Gargantuan vessels are tagged as "unique" in
 * the rulebook — there's no canonical seed value, but we have to start the
 * stepper somewhere; 30 puts the gargantuan slightly past the Huge cap and
 * the captain can dial it in for the specific hull they're chartering.
 */
export const DEFAULT_HP_MAX_BY_SIZE = {
  tiny: 9,
  small: 12,
  medium: 15,
  large: 20,
  huge: 25,
  gargantuan: 30,
}

/**
 * Default mobility per size. Page 169's Ship Hit Points and Mobility table
 * binds size to mobility — Tiny/Small handle high, Medium/Large handle
 * balanced, Huge/Gargantuan handle low. Captains can still override on the
 * profile form for ships that intentionally break the pattern.
 *
 * @type {Record<import('./types.js').ShipSize, import('./types.js').Mobility>}
 */
export const DEFAULT_MOBILITY_BY_SIZE = {
  tiny: 'high',
  small: 'high',
  medium: 'balanced',
  large: 'balanced',
  huge: 'low',
  gargantuan: 'low',
}

/**
 * Explosion DC per size — Explosion DCs table on page 189. Smaller hulls go
 * up faster: a fire that would take rounds to threaten a Huge powder magazine
 * can level a Tiny boat in a single round.
 */
export const DEFAULT_EXPLOSION_DC_BY_SIZE = {
  tiny: 12,
  small: 14,
  medium: 16,
  large: 18,
  huge: 20,
  gargantuan: 22,
}

/**
 * Default crew max per size when a canonical ship type isn't selected. Pulled
 * from the type table on page 198 by mapping each size to its smallest
 * canonical type (e.g. Small → Sloop, Medium → Brigantine), since that's the
 * gentler starting seed for an ad-hoc ship. Selecting a specific Type in the
 * charter form overrides this with the type-exact crew size.
 *
 * Tiny isn't in the page-198 table (no canonical Tiny ship); 8 is a
 * reasonable seed for a Longboat and the captain can dial it in.
 *
 * Gargantuan isn't in the table either; we seed beyond Huge so the stepper
 * doesn't open below the Man o' War's 99 cap.
 */
export const DEFAULT_CREW_MAX_BY_SIZE = {
  tiny: 8,
  small: 24,
  medium: 40,
  large: 64,
  huge: 99,
  gargantuan: 120,
}

/**
 * Per-type ship profiles from the canonical tables on pages 169, 173,
 * and 198. When a captain types one of these into the Type field on the
 * charter form (case-insensitive), the seeds light up so HP, speed, crew,
 * weapon slots, supply caps, and heavy-weapons eligibility all line up
 * with the rulebook. Free-text types still work — they just fall back to
 * the size-keyed defaults above.
 *
 * @typedef {Object} ShipTypeProfile
 * @property {import('./types.js').ShipSize} size
 * @property {import('./types.js').Mobility} mobility
 * @property {number} hpMax
 * @property {number} speedKnots
 * @property {number} crewMax
 * @property {number} crewSkeleton
 * @property {{ bow: number, port: number, starboard: number, stern: number }} weapons
 * @property {{ grub: number, grog: number, gear: number }} supplyCaps
 * @property {boolean} heavyEligible
 *
 * @type {Record<string, ShipTypeProfile>}
 */
export const SHIP_TYPE_PROFILES = {
  Sloop: {
    size: 'small',
    mobility: 'high',
    hpMax: 12,
    speedKnots: 3,
    crewMax: 24,
    crewSkeleton: 12,
    weapons: { bow: 0, port: 4, starboard: 4, stern: 0 },
    supplyCaps: { grub: 10, grog: 6, gear: 10 },
    heavyEligible: false,
  },
  Schooner: {
    size: 'small',
    mobility: 'high',
    hpMax: 12,
    speedKnots: 4,
    crewMax: 32,
    crewSkeleton: 16,
    weapons: { bow: 0, port: 5, starboard: 5, stern: 0 },
    supplyCaps: { grub: 15, grog: 8, gear: 12 },
    heavyEligible: false,
  },
  Brigantine: {
    size: 'medium',
    mobility: 'balanced',
    hpMax: 15,
    speedKnots: 5,
    crewMax: 40,
    crewSkeleton: 20,
    weapons: { bow: 0, port: 6, starboard: 6, stern: 0 },
    supplyCaps: { grub: 20, grog: 10, gear: 14 },
    heavyEligible: false,
  },
  Frigate: {
    size: 'medium',
    mobility: 'balanced',
    hpMax: 15,
    speedKnots: 6,
    crewMax: 52,
    crewSkeleton: 26,
    weapons: { bow: 0, port: 8, starboard: 8, stern: 1 },
    supplyCaps: { grub: 25, grog: 12, gear: 16 },
    heavyEligible: true,
  },
  Galleon: {
    size: 'large',
    mobility: 'balanced',
    hpMax: 20,
    speedKnots: 8,
    crewMax: 64,
    crewSkeleton: 32,
    weapons: { bow: 2, port: 10, starboard: 10, stern: 2 },
    supplyCaps: { grub: 30, grog: 14, gear: 18 },
    heavyEligible: true,
  },
  "Man o' War": {
    size: 'huge',
    mobility: 'low',
    hpMax: 25,
    speedKnots: 9,
    crewMax: 99,
    crewSkeleton: 49,
    weapons: { bow: 2, port: 12, starboard: 12, stern: 3 },
    supplyCaps: { grub: 35, grog: 16, gear: 20 },
    heavyEligible: true,
  },
}

/**
 * Per-size fallback supply caps when the type isn't canonical. Mirrors the
 * smallest canonical type at each size so a free-text "Caravel" hand-typed
 * for a medium hull gets a sensible Brigantine-ish cap. The SuppliesSection
 * uses this as the stepper max when the type doesn't match a profile.
 *
 * Tiny / Gargantuan aren't in the page-173 table; the values below are
 * generous starting seeds — the user can override each track on the form.
 *
 * @type {Record<import('./types.js').ShipSize, { grub: number, grog: number, gear: number }>}
 */
export const DEFAULT_SUPPLY_CAPS_BY_SIZE = {
  tiny: { grub: 8, grog: 4, gear: 8 },
  small: { grub: 10, grog: 6, gear: 10 },
  medium: { grub: 20, grog: 10, gear: 14 },
  large: { grub: 30, grog: 14, gear: 18 },
  huge: { grub: 35, grog: 16, gear: 20 },
  gargantuan: { grub: 40, grog: 18, gear: 22 },
}

/** Range cones (squares from ship). 'far' = offscreen (PDF p. 187). */
export const RANGE_CONE_SQUARES = {
  short: 3,
  standard: 7,
  long: 10,
}

/** Heavy weapons eligibility — Frigate / Galleon / Man o' War (PDF p. 170). */
export const HEAVY_WEAPON_ELIGIBLE_TYPES = ['Frigate', 'Galleon', "Man o' War"]

/** Common ammo types — open list; user can add more on the resources panel. */
export const DEFAULT_AMMO_TYPES = ['standard', 'chainshot', 'hullbusters']

/**
 * Mettle baseline floor (PDF p. 199 — "Beginning Mettle"). A ship begins
 * with 4d4 plus the captain's rank in its mettle pool, growing further
 * with the flying flag's total reputation.
 */
export const MIN_BASELINE_METTLE = 4

/**
 * Skeleton-crew action allowance (PDF p. 198 — "Short Staffed"). At or
 * below the skeleton mark the ship can take only one of Movement / Attack
 * / Status this round; the captain picks which.
 */
export const SHORT_STAFFED_ACTIONS_PER_TURN = 1
export const FULL_STAFFED_ACTIONS_PER_TURN = 3

/**
 * The four reputation axes used to track a flag's renown. Each is a
 * non-negative running tally; total reputation is the sum across all four
 * (PDF p. 200 — "Reputation Types" + "Total Reputation").
 *
 * @type {import('./types.js').ReputationAxis[]}
 */
export const REPUTATION_AXES = ['good', 'evil', 'lawful', 'chaotic']

/** @type {Record<import('./types.js').ReputationAxis, string>} */
export const REPUTATION_AXIS_LABELS = {
  good: 'Good',
  evil: 'Evil',
  lawful: 'Lawful',
  chaotic: 'Chaotic',
}

/**
 * The Gap counter starts at 6 by default — "the gap line usually starts
 * with six counters" on PDF p. 181. The pursuing ship wants to pull it
 * down to 0; the fleeing ship wants to push it past 10 to escape.
 */
export const PURSUIT_DEFAULT_GAP = 6

/**
 * Default escape-timer die. Page 181 calls 6 rounds "a reasonable number"
 * but the GM can shorten (d4) or lengthen (d8) based on how close the
 * fleeing ship is to its safe haven.
 */
export const PURSUIT_DEFAULT_ESCAPE_TIMER = 6

/** Initial hp:max ratio when seeding a new ship — full health. */
export const INITIAL_HP_RATIO = 1.0

/** Save file extension and content type. */
export const SHIP_FILE_EXTENSION = '.shipsync.json'
export const SHIP_FILE_MIME = 'application/json'

/** Max image bundle size before we warn the user (per ship file). */
export const IMAGE_WARN_BYTES = 2 * 1024 * 1024
export const IMAGE_HARD_CAP_BYTES = 8 * 1024 * 1024

/**
 * Soft warning threshold for the *cumulative* size of all images in the workspace.
 * localStorage caps vary (typically 5–10 MB), and our autosave fallback strips images
 * once the quota is hit. We surface a warning at upload time so the user knows to
 * write the ship to disk before relying on autosave.
 */
export const IMAGE_WORKSPACE_WARN_BYTES = 6 * 1024 * 1024
