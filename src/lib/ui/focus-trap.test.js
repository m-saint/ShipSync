import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { trapFocus, collectFocusables } from './focus-trap.js'

/**
 * @param {string} html
 */
function setupContainer(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)
  return container
}

/**
 * Create a synthetic Tab keydown that the trap listener can observe.
 * jsdom doesn't dispatch the browser's intrinsic Tab navigation, so the
 * trap's preventDefault doesn't conflict with native behavior in tests —
 * we just check that the trap calls focus() on the right element.
 *
 * @param {HTMLElement} target
 * @param {boolean} [shift]
 */
function pressTab(target, shift = false) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

describe('collectFocusables', () => {
  let container = /** @type {HTMLElement} */ (/** @type {unknown} */ (null))

  beforeEach(() => {
    container = setupContainer(`
      <button id="b1">One</button>
      <button id="b2" disabled>Two</button>
      <input id="i1" />
      <input id="i2" type="hidden" />
      <a id="a1" href="#">Link</a>
      <a id="a2">No href</a>
      <span tabindex="0" id="s1">Span focusable</span>
      <span tabindex="-1" id="s2">Span unfocusable</span>
      <textarea id="t1"></textarea>
      <select id="sel1"><option>x</option></select>
    `)
  })

  afterEach(() => {
    container.remove()
  })

  it('collects buttons, inputs, links, textareas, selects, and tabindex 0 spans in DOM order', () => {
    const ids = collectFocusables(container).map((el) => el.id)
    expect(ids).toEqual(['b1', 'i1', 'a1', 's1', 't1', 'sel1'])
  })

  it('skips disabled buttons', () => {
    const ids = collectFocusables(container).map((el) => el.id)
    expect(ids).not.toContain('b2')
  })

  it('skips hidden inputs and bare anchors without href', () => {
    const ids = collectFocusables(container).map((el) => el.id)
    expect(ids).not.toContain('i2')
    expect(ids).not.toContain('a2')
  })

  it('skips elements with tabindex="-1"', () => {
    const ids = collectFocusables(container).map((el) => el.id)
    expect(ids).not.toContain('s2')
  })

  it('returns an empty array for null', () => {
    expect(
      collectFocusables(/** @type {HTMLElement} */ (/** @type {unknown} */ (null))),
    ).toEqual([])
  })
})

describe('trapFocus', () => {
  let container = /** @type {HTMLElement} */ (/** @type {unknown} */ (null))
  let cleanup = /** @type {() => void} */ (() => {})

  beforeEach(() => {
    container = setupContainer(`
      <button id="first">First</button>
      <input id="middle" />
      <button id="last">Last</button>
    `)
    cleanup = trapFocus(container)
  })

  afterEach(() => {
    cleanup()
    container.remove()
  })

  it('cycles Tab from the last focusable back to the first', () => {
    const last = /** @type {HTMLElement} */ (container.querySelector('#last'))
    const first = /** @type {HTMLElement} */ (container.querySelector('#first'))
    last.focus()
    expect(document.activeElement).toBe(last)

    const event = pressTab(last)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('cycles Shift+Tab from the first focusable back to the last', () => {
    const first = /** @type {HTMLElement} */ (container.querySelector('#first'))
    const last = /** @type {HTMLElement} */ (container.querySelector('#last'))
    first.focus()
    expect(document.activeElement).toBe(first)

    const event = pressTab(first, true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it('lets Tab pass through when focus is in the middle of the cycle', () => {
    const middle = /** @type {HTMLElement} */ (container.querySelector('#middle'))
    middle.focus()

    const event = pressTab(middle)
    expect(event.defaultPrevented).toBe(false)
  })

  it('preventDefaults Tab and parks focus on the first element when active focus is outside', () => {
    const outsideButton = document.createElement('button')
    outsideButton.id = 'outside'
    document.body.appendChild(outsideButton)
    outsideButton.focus()
    expect(document.activeElement).toBe(outsideButton)

    const event = pressTab(container)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(container.querySelector('#first'))

    outsideButton.remove()
  })

  it('preventDefaults Tab when there are no focusables inside', () => {
    container.innerHTML = '<p>nothing focusable here</p>'
    const event = pressTab(container)
    expect(event.defaultPrevented).toBe(true)
  })

  it('returns a cleanup function that detaches the listener', () => {
    cleanup()
    const last = /** @type {HTMLElement} */ (container.querySelector('#last'))
    last.focus()
    const event = pressTab(last)
    expect(event.defaultPrevented).toBe(false)
  })

  it('re-queries focusables on each Tab (handles dynamically rendered controls)', () => {
    const last = /** @type {HTMLElement} */ (container.querySelector('#last'))
    last.focus()

    const newButton = document.createElement('button')
    newButton.id = 'appended'
    container.appendChild(newButton)

    const passthroughEvent = pressTab(last)
    expect(passthroughEvent.defaultPrevented).toBe(false)

    const appended = /** @type {HTMLElement} */ (container.querySelector('#appended'))
    appended.focus()
    pressTab(appended)
    expect(document.activeElement).toBe(container.querySelector('#first'))
  })

  it('returns a no-op cleanup when given a null container', () => {
    const noopCleanup = trapFocus(/** @type {HTMLElement} */ (/** @type {unknown} */ (null)))
    expect(typeof noopCleanup).toBe('function')
    expect(() => noopCleanup()).not.toThrow()
  })
})
