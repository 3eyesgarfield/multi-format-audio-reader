/** Shared persistent-highlight helpers used by all readers.
 *  Highlights are anchored to a sentence id (stable across reopens) and rendered
 *  via a `data-hl` attribute so CSS drives the colour and the active-reading
 *  highlight can still override it. */

export type HlColor = 'yellow' | 'green' | 'pink'

export interface StoredHighlight {
  locator: string // sentence id
  color?: string
}

/** (Re)apply the full set of highlights under `root` for spans matching `selector`. */
export function applyHighlights(
  root: HTMLElement | null,
  selector: string,
  hls: StoredHighlight[]
): void {
  if (!root) return
  root.querySelectorAll(`${selector}[data-hl]`).forEach((e) => {
    delete (e as HTMLElement).dataset.hl
  })
  for (const h of hls) {
    if (!h.locator) continue
    root.querySelectorAll(`${selector}[data-id="${CSS.escape(h.locator)}"]`).forEach((e) => {
      ;(e as HTMLElement).dataset.hl = h.color || 'yellow'
    })
  }
}
