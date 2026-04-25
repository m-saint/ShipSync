/**
 * Tiny platform helpers for surfacing the right modifier glyph in tooltips.
 * Detection happens once at module load; SSR-safe falls back to the Ctrl spelling.
 */

const isApple = (() => {
  if (typeof navigator === 'undefined') return false
  const platform = navigator.platform ?? ''
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return true
  return /Mac/i.test(navigator.userAgent ?? '')
})()

/** "⌘" on Apple OSes, "Ctrl+" elsewhere. */
export const cmdGlyph = isApple ? '⌘' : 'Ctrl+'

/** "⇧" on Apple OSes, "Shift+" elsewhere. */
export const shiftGlyph = isApple ? '⇧' : 'Shift+'

/** "⌥" on Apple OSes, "Alt+" elsewhere. */
export const altGlyph = isApple ? '⌥' : 'Alt+'

/**
 * Render a key name in the platform's tooltip style.
 *
 * - Single letters are uppercased on both platforms ("L" → "L").
 * - Arrow keys are rendered as glyphs on Apple ("ArrowUp" → "↑") and as
 *   short words elsewhere ("ArrowUp" → "Up") so the result fits both the
 *   ⌥↑ shape and the Alt+Up shape without further plumbing.
 * - Anything else is passed through unchanged so callers can spell out
 *   special keys ("Tab", "Enter", "Escape") if/when we wire shortcuts to
 *   them.
 *
 * @param {string} key
 */
function renderKey(key) {
  if (key.length === 1) return key.toUpperCase()
  if (key === 'ArrowUp') return isApple ? '↑' : 'Up'
  if (key === 'ArrowDown') return isApple ? '↓' : 'Down'
  if (key === 'ArrowLeft') return isApple ? '←' : 'Left'
  if (key === 'ArrowRight') return isApple ? '→' : 'Right'
  return key
}

/**
 * Compose a shortcut hint, e.g. "⌘S" / "Ctrl+S" / "⌘⇧Z" / "Ctrl+Shift+Z" /
 * "⌥↑" / "Alt+Up".
 *
 * Modifier keys stack in a fixed order — Cmd → Alt → Shift — so two
 * matching shortcuts always render with the same glyph sequence. When `cmd`
 * is omitted the shortcut renders as a plain modifier+key pair (e.g.
 * `Alt+Up`) for keyboard combos that don't involve the meta key.
 *
 * @param {string} key Letter, symbol, or special key name.
 * @param {{ shift?: boolean, alt?: boolean, cmd?: boolean }} [opts]
 *        `cmd` defaults to `true` to preserve the existing Cmd/Ctrl-led
 *        usage at every prior call site (Save, Save all, Print fleet,
 *        Undo, Redo). Pass `cmd: false` for non-meta shortcuts (Alt+Up,
 *        Alt+Down) so the leading ⌘/Ctrl is omitted.
 */
export function shortcutHint(key, opts = {}) {
  const cmd = opts.cmd ?? true
  const parts = []
  if (cmd) parts.push(cmdGlyph)
  if (opts.alt) parts.push(altGlyph)
  if (opts.shift) parts.push(shiftGlyph)
  parts.push(renderKey(key))
  return parts.join('')
}
