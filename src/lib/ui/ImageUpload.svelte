<script module>
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(/** @type {string} */ (reader.result))
      reader.onerror = () => reject(new Error('Could not read image file.'))
      reader.readAsDataURL(file)
    })
  }
</script>

<script>
  /**
   * Read a user-uploaded image file as a data URL. The Dashboard wires the resulting id+url
   * into the workspace image store; this component itself does not own state.
   */

  import {
    IMAGE_HARD_CAP_BYTES,
    IMAGE_WARN_BYTES,
    IMAGE_WORKSPACE_WARN_BYTES,
  } from '../domain/rules.js'
  import { pushToast } from '../state/ui.svelte.js'

  let {
    label = 'Upload image',
    accept = 'image/*',
    onchange,
    disabled = false,
    /**
     * Bytes already committed in the workspace image store. Used to surface a warning
     * when the new upload would push the workspace past the autosave-friendly soft cap.
     */
    existingTotalBytes = 0,
  } = $props()

  let inputEl = $state(null)

  async function handleFile(event) {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    if (file.size > IMAGE_HARD_CAP_BYTES) {
      pushToast({
        kind: 'error',
        title: 'Image too large',
        body: `${file.name} is over the ${(IMAGE_HARD_CAP_BYTES / (1024 * 1024)).toFixed(0)} MB hard limit. Resize and try again.`,
      })
      event.currentTarget.value = ''
      return
    }
    if (file.size > IMAGE_WARN_BYTES) {
      pushToast({
        kind: 'warning',
        title: 'Large image bundled',
        body: 'Save files with big images may be slow to share. Consider resizing.',
      })
    }

    if (existingTotalBytes + file.size > IMAGE_WORKSPACE_WARN_BYTES) {
      const totalMb = ((existingTotalBytes + file.size) / (1024 * 1024)).toFixed(1)
      pushToast({
        kind: 'warning',
        title: 'Workspace images getting heavy',
        body: `About ${totalMb} MB of images across the workspace. Save your ship files now — autosave drops images when the browser bucket fills up.`,
      })
    }

    try {
      const dataUrl = await readAsDataURL(file)
      onchange?.({ dataUrl, name: file.name, size: file.size, type: file.type })
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Could not read image',
        body: e instanceof Error ? e.message : String(e),
      })
    } finally {
      event.currentTarget.value = ''
    }
  }

  function trigger() {
    inputEl?.click()
  }
</script>

<button
  type="button"
  class="inline-flex items-center gap-2 rounded-md border border-dashed border-surface-300 bg-surface-50 hover:bg-surface-100 px-3 py-2 text-sm text-ink-700 disabled:opacity-60 disabled:cursor-not-allowed"
  onclick={trigger}
  {disabled}
>
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1v8m0 0L4 6m3 3l3-3M2 11h10v2H2z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  {label}
</button>
<input
  bind:this={inputEl}
  type="file"
  {accept}
  class="sr-only"
  onchange={handleFile}
/>
