import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
// epubjs ships loose types; treat as any to avoid friction
// @ts-ignore
import ePub from 'epubjs'
import { ReaderHandle, SearchHit, TocItem } from './types'
import { wrapSentences } from './textWrap'
import { applyHighlights } from './highlightUtil'
import { Sentence } from '../tts/segmenter'
import { BookMeta } from '../store'

interface Props {
  book: BookMeta
  onSentences: (s: Sentence[]) => void
  onReadFrom: (id: string) => void
}

/**
 * Renders the whole EPUB as ONE continuous scroll inside our own DOM (not
 * epub.js iframes). This lets us reuse the Markdown pipeline verbatim: every
 * sentence is wrapped in a <span class="sent"> so we get in-text highlight,
 * auto-scroll, double-click "read from here" and full-text search — across the
 * entire book, not just one chapter.
 */
export const EpubReader = forwardRef<ReaderHandle, Props>(function EpubReader(
  { book, onSentences, onReadFrom },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const sentencesRef = useRef<Sentence[]>([])
  const activeRef = useRef<string | null>(null)
  const tocRef = useRef<TocItem[]>([])
  const hrefToSectionRef = useRef<Map<string, string>>(new Map()) // file href -> #sec id

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const buf = await window.api.readFile(book.path)
        if (cancelled) return
        const epubBook = ePub(buf)
        await epubBook.ready

        const host = bodyRef.current!
        host.innerHTML = ''

        const spineItems = (epubBook.spine as any)?.spineItems ?? []
        for (let si = 0; si < spineItems.length; si++) {
          const item = spineItems[si]
          const sec = document.createElement('section')
          sec.id = `sec-${si}`
          sec.dataset.href = item.href
          try {
            // render() returns the section's serialised HTML with images/CSS
            // already rewritten to blob URLs
            const html: string = await item.render(epubBook.load.bind(epubBook))
            const parsed = new DOMParser().parseFromString(html, 'text/html')
            sec.innerHTML = parsed.body ? parsed.body.innerHTML : html
          } catch {
            try {
              await item.load(epubBook.load.bind(epubBook))
              sec.innerHTML = item.document?.body?.innerHTML ?? ''
              item.unload()
            } catch {
              /* skip unreadable section */
            }
          }
          host.appendChild(sec)
          // map this file href (without anchor) to its section id
          const base = String(item.href).split('#')[0]
          hrefToSectionRef.current.set(base, `sec-${si}`)
        }
        if (cancelled) return

        // wrap every sentence (same as Markdown) -> highlight + click + search
        const sentences = wrapSentences(host, 'epub')
        sentencesRef.current = sentences
        onSentences(sentences)

        host.querySelectorAll('span.sent').forEach((sp) => {
          sp.addEventListener('dblclick', () => {
            const id = (sp as HTMLElement).dataset.id
            if (id) onReadFrom(id)
          })
        })

        // table of contents
        const nav = await epubBook.loaded.navigation
        tocRef.current = (nav.toc || []).map((tocItem: any) => ({
          label: (tocItem.label || '').trim(),
          locator: tocItem.href,
          level: 1
        }))

        // restore progress (scroll ratio)
        if (typeof book.progress === 'number' && hostRef.current) {
          requestAnimationFrame(() => {
            const c = hostRef.current!
            c.scrollTop = (book.progress as number) * (c.scrollHeight - c.clientHeight)
          })
        }
        // NOTE: don't destroy() the book — image src use blob URLs owned by it
      } catch (err) {
        console.error('[EpubReader] failed to load EPUB:', err)
        if (bodyRef.current)
          bodyRef.current.innerHTML = `<div style="padding:40px;color:#e88">EPUB 加载失败: ${String(err)}</div>`
      }
    })()
    return () => {
      cancelled = true
    }
  }, [book.path])

  useImperativeHandle(ref, (): ReaderHandle => ({
    getSentences: () => sentencesRef.current,
    highlight: (id) => {
      const root = bodyRef.current
      if (!root) return
      if (activeRef.current)
        root.querySelector(`span.sent[data-id="${activeRef.current}"]`)?.classList.remove('active')
      activeRef.current = id
      if (id) {
        const el = root.querySelector(`span.sent[data-id="${id}"]`)
        if (el) {
          el.classList.add('active')
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      }
    },
    search: (query) => {
      const hits: SearchHit[] = []
      if (!query.trim()) return hits
      const q = query.toLowerCase()
      sentencesRef.current.forEach((s) => {
        const idx = s.text.toLowerCase().indexOf(q)
        if (idx >= 0) {
          hits.push({
            id: `hit-${s.id}`,
            sentenceId: s.id,
            label: '…' + s.text.slice(Math.max(0, idx - 15), idx + q.length + 20) + '…',
            locator: s.id
          })
        }
      })
      return hits
    },
    goToHit: (hit) => {
      const el = bodyRef.current?.querySelector(`span.sent[data-id="${hit.locator}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1500)
    },
    getToc: () => tocRef.current,
    goToToc: (item) => {
      const href = String(item.locator)
      const [file, anchor] = href.split('#')
      // try an in-document anchor first, else the section wrapper
      let target: Element | null = null
      if (anchor) target = bodyRef.current?.querySelector(`#${CSS.escape(anchor)}`) ?? null
      if (!target) {
        const secId = hrefToSectionRef.current.get(file)
        if (secId) target = document.getElementById(secId)
      }
      target?.scrollIntoView({ behavior: 'smooth' })
    },
    getProgress: () => {
      const c = hostRef.current
      if (!c) return 0
      return c.scrollTop / Math.max(1, c.scrollHeight - c.clientHeight)
    },
    exportText: () => sentencesRef.current,
    applyHighlights: (hls) => applyHighlights(bodyRef.current, 'span.sent', hls),
    goToSentence: (id) => {
      const el = bodyRef.current?.querySelector(`span.sent[data-id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1500)
    }
  }))

  return (
    <div className="epub-host" ref={hostRef}>
      <div className="epub-body" ref={bodyRef} />
    </div>
  )
})
