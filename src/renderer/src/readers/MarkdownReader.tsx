import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { ReaderHandle, SearchHit, TocItem } from './types'
import { wrapSentences } from './textWrap'
import { applyHighlights } from './highlightUtil'
import { Sentence } from '../tts/segmenter'
import { BookMeta } from '../store'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

interface Props {
  book: BookMeta
  onSentences: (s: Sentence[]) => void
  onReadFrom: (id: string) => void
}

export const MarkdownReader = forwardRef<ReaderHandle, Props>(function MarkdownReader(
  { book, onSentences, onReadFrom },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const sentencesRef = useRef<Sentence[]>([])
  const activeRef = useRef<string | null>(null)
  const [, setReady] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const buf = await window.api.readFile(book.path)
      if (cancelled) return
      const text = new TextDecoder('utf-8').decode(buf)
      const html = md.render(text)
      if (!contentRef.current) return
      contentRef.current.innerHTML = html
      const sentences = wrapSentences(contentRef.current, 'md')
      sentencesRef.current = sentences
      onSentences(sentences)
      // assign heading ids for TOC navigation
      contentRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
        ;(h as HTMLElement).id = `h-${i}`
      })
      // click a sentence to read from there
      contentRef.current.querySelectorAll('span.sent').forEach((sp) => {
        sp.addEventListener('dblclick', () => {
          const id = (sp as HTMLElement).dataset.id
          if (id) onReadFrom(id)
        })
      })
      // restore progress (scroll ratio)
      if (typeof book.progress === 'number' && containerRef.current) {
        requestAnimationFrame(() => {
          const c = containerRef.current!
          c.scrollTop = (book.progress as number) * (c.scrollHeight - c.clientHeight)
        })
      }
      setReady((v) => v + 1)
    })()
    return () => {
      cancelled = true
    }
  }, [book.path])

  useImperativeHandle(ref, (): ReaderHandle => ({
    getSentences: () => sentencesRef.current,
    highlight: (id) => {
      const root = contentRef.current
      if (!root) return
      if (activeRef.current) {
        root.querySelector(`span.sent[data-id="${activeRef.current}"]`)?.classList.remove('active')
      }
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
          const start = Math.max(0, idx - 20)
          hits.push({
            id: `hit-${s.id}`,
            sentenceId: s.id,
            label: '…' + s.text.slice(start, idx + q.length + 20) + '…',
            locator: s.id
          })
        }
      })
      return hits
    },
    goToHit: (hit) => {
      const el = contentRef.current?.querySelector(`span.sent[data-id="${hit.locator}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1500)
    },
    getToc: () => {
      const items: TocItem[] = []
      contentRef.current?.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
        items.push({
          label: h.textContent ?? '',
          locator: (h as HTMLElement).id,
          level: Number(h.tagName[1])
        })
      })
      return items
    },
    goToToc: (item) => {
      document.getElementById(item.locator as string)?.scrollIntoView({ behavior: 'smooth' })
    },
    getProgress: () => {
      const c = containerRef.current
      if (!c) return 0
      return c.scrollTop / Math.max(1, c.scrollHeight - c.clientHeight)
    },
    exportText: () => sentencesRef.current,
    applyHighlights: (hls) => applyHighlights(contentRef.current, 'span.sent', hls),
    goToSentence: (id) => {
      const el = contentRef.current?.querySelector(`span.sent[data-id="${CSS.escape(id)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.classList.add('flash')
      setTimeout(() => el?.classList.remove('flash'), 1500)
    }
  }))

  return (
    <div className="md-scroll" ref={containerRef}>
      <div className="md-body" ref={contentRef} />
    </div>
  )
})
