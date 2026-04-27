<script>
  // Tiny URL-driven router. Print routes hydrate the workspace from the local
  // autosave so they can be opened in a fresh tab. Everything else falls
  // through to the dashboard.
  //
  //   ?print=fleet      → FleetPrintView (one sheet per loaded ship, v0.8)
  //   ?print=<shipId>   → PrintView (single-ship sheet, v0.7)
  //   (none)            → Dashboard

  import Dashboard from './routes/Dashboard.svelte'
  import PrintView from './routes/PrintView.svelte'
  import FleetPrintView from './routes/FleetPrintView.svelte'
  import { settings, effectiveColorScheme } from './lib/state/settings.svelte.js'

  let printTarget = $state(/** @type {string|null} */ (null))

  $effect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const id = params.get('print')
    printTarget = id && id.length > 0 ? id : null
  })

  /**
   * Apply the user's preferences to the document root so any descendant
   * surface can react via CSS (`html[data-color-scheme="dark"]`, etc.).
   *
   * Color scheme: re-runs whenever the user flips the SettingsDialog
   * choice OR (in 'auto' mode) whenever the OS preference changes via the
   * `prefers-color-scheme` media query.
   *
   * Density: a simple data attribute that Tailwind's
   * `data-[density=compact]:` variants consume — no global stylesheet
   * change required.
   *
   * Print views drop the dark attribute. The dark palette would render
   * cream-on-ink on paper too — fine on a screen, wasteful on a printer.
   * Printed sheets stay black-on-white regardless of the user's chosen
   * dashboard scheme.
   */
  $effect(() => {
    if (typeof document === 'undefined') return
    const mql =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    function apply() {
      const scheme = printTarget ? 'light' : effectiveColorScheme()
      document.documentElement.dataset.colorScheme = scheme
    }
    apply()
    // Also re-apply when the OS preference changes while the user is in
    // 'auto' — we read `settings.colorScheme` in `effectiveColorScheme`,
    // so this handler cooperates with the reactive read above.
    mql?.addEventListener?.('change', apply)
    return () => mql?.removeEventListener?.('change', apply)
  })

  $effect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.density = settings.density
  })

  /*
   * Tag the document root with the active route so global CSS can
   * conditionally lock the body scroll. The dashboard is a fixed
   * viewport-tall surface (rails own their own scroll containers),
   * so the document itself should never scroll. Print routes are
   * intentionally tall and need the document to scroll for review
   * before Cmd+P, so they get a different tag and skip the lock.
   * See the `html[data-route='dashboard']` rules in tokens.css.
   */
  $effect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.route = printTarget ? 'print' : 'dashboard'
  })
</script>

{#if printTarget === 'fleet'}
  <FleetPrintView />
{:else if printTarget}
  <PrintView shipId={printTarget} />
{:else}
  <Dashboard />
{/if}
