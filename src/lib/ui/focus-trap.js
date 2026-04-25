/**
 * Trap keyboard focus inside a container element.
 *
 * Used by `Dialog.svelte` (and any future modal surface) so that Tab and
 * Shift+Tab cycle through the modal's interactive descendants instead of
 * leaking out to the document below. Native `<dialog>` in modal mode
 * already filters most pointer interaction with elements behind it, but
 * keyboard tab order still reaches them in some browsers — this trap
 * closes that gap.
 *
 * The trap re-queries focusables on every Tab so that dialogs whose
 * controls appear or disappear (e.g. ShoreLeaveDialog's Confirm/Cancel
 * swap during the two-click commit) keep cycling through the
 * currently-rendered set without needing to reattach the trap.
 *
 * Skipped automatically when the user prefers reduced motion AND
 * has no need for the trap (irrelevant — focus trap isn't motion;
 * left intentionally always-on so a11y stays consistent).
 *
 * @param {HTMLElement} container Root element to trap focus inside.
 * @returns {() => void} Cleanup function that detaches the listener.
 */
export function trapFocus(container) {
  if (!container || typeof container.addEventListener !== 'function') {
    return () => {}
  }

  function handleKeydown(event) {
    if (event.key !== 'Tab') return
    const focusables = collectFocusables(container)
    if (focusables.length === 0) {
      event.preventDefault()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = /** @type {HTMLElement | null} */ (
      container.ownerDocument?.activeElement ?? null
    )

    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !container.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  container.addEventListener('keydown', handleKeydown)
  return () => {
    container.removeEventListener('keydown', handleKeydown)
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  'audio[controls]',
  'video[controls]',
  'details > summary:first-of-type',
].join(',')

/**
 * Collect focusable descendants of `root`, in DOM order, filtering out
 * elements that are visually hidden or have `tabindex="-1"`.
 *
 * Results are explicitly sorted by document position because some
 * implementations (notably jsdom) return matches grouped by the
 * comma-separated selector position rather than by DOM order — that
 * would corrupt Tab cycling. We use `compareDocumentPosition` so the
 * sort is stable and standards-compliant.
 *
 * Exported for tests; the trap above is the primary consumer.
 *
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
export function collectFocusables(root) {
  if (!root) return []
  const nodes = /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll(FOCUSABLE_SELECTOR)
  )
  /** @type {HTMLElement[]} */
  const out = []
  for (const node of nodes) {
    if (isHidden(node)) continue
    if (node.getAttribute('tabindex') === '-1') continue
    out.push(node)
  }
  out.sort((a, b) => {
    const position = a.compareDocumentPosition(b)
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    return 0
  })
  return out
}

/**
 * @param {HTMLElement} node
 *
 * Conservative visibility check. We only filter on the explicit `hidden`
 * attribute and `aria-hidden`; computing layout-derived visibility
 * (`offsetParent`, `getClientRects`) isn't reliable in jsdom and isn't
 * critical here — a focusable element inside a CSS-hidden ancestor would
 * just be a no-op .focus() in real browsers, so the trap still does the
 * right thing visually. Dialog-scope authors should hide unreachable
 * branches with the `hidden` attribute or `aria-hidden`.
 */
function isHidden(node) {
  if (node.hidden) return true
  if (node.getAttribute('aria-hidden') === 'true') return true
  return false
}
