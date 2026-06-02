/**
 * Walks the text nodes under an element and wraps each sentence in a
 * <span class="sent" data-id="…"> so the player can highlight + scroll to it.
 * Returns the sentences in document order. Used by the Markdown reader (and any
 * HTML-based view).
 */
import { segment, Sentence } from '../tts/segmenter'

export function wrapSentences(root: HTMLElement, idPrefix = 's'): Sentence[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const t = node.textContent ?? ''
      if (!t.trim()) return NodeFilter.FILTER_REJECT
      const p = node.parentElement
      if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) {
        return NodeFilter.FILTER_REJECT
      }
      if (p && p.closest('code, pre')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    }
  })

  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)

  const sentences: Sentence[] = []
  let counter = 0

  for (const tn of textNodes) {
    const text = tn.textContent ?? ''
    const segs = segment(text, idPrefix)
    if (segs.length === 0) continue
    const frag = document.createDocumentFragment()
    let pos = 0
    for (const s of segs) {
      // keep any leading whitespace/punctuation between sentences
      if (s.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, s.start)))
      const span = document.createElement('span')
      span.className = 'sent'
      const id = `${idPrefix}-${counter++}`
      span.dataset.id = id
      span.textContent = text.slice(s.start, s.end)
      frag.appendChild(span)
      sentences.push({ ...s, id })
      pos = s.end
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)))
    tn.parentNode?.replaceChild(frag, tn)
  }
  return sentences
}
