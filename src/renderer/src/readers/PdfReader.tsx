import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ReaderHandle, SearchHit, TocItem } from './types'
import { segment, Sentence, HARD_BREAK } from '../tts/segmenter'
import { BookMeta, ViewMode } from '../store'
import { ocrImage } from '../tts/ttsClient'
import { applyHighlights } from './highlightUtil'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  book: BookMeta
  viewMode: ViewMode
  onSentences: (s: Sentence[]) => void
  onReadFrom: (id: string) => void
}

interface PageItem {
  str: string
  start: number
  end: number
  transform: number[]
  width: number
  sentId?: string
}

interface PageData {
  sentences: Sentence[]
  items: PageItem[]
}

function pageOf(id: string): number {
  const m = id.match(/^pdf-(\d+)-/)
  return m ? Number(m[1]) : 1
}

export const PdfReader = forwardRef<ReaderHandle, Props>(function PdfReader(
  { book, viewMode, onSentences, onReadFrom },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const pageDataRef = useRef<Map<number, PageData>>(new Map())
  const renderedScaleRef = useRef<Map<number, number>>(new Map())
  const tocRef = useRef<TocItem[]>([])
  const activeRef = useRef<string | null>(null)
  const mergeMapRef = useRef<Map<string, string>>(new Map()) // per-page id -> merged id
  const mergedRef = useRef<Sentence[]>([]) // sentences merged across page boundaries
  const hlRef = useRef<{ locator: string; color?: string }[]>([]) // persistent highlights
  const ioRef = useRef<IntersectionObserver | null>(null)
  const numPagesRef = useRef(0)
  const viewModeRef = useRef(viewMode)
  const [cur, setCur] = useState(1)
  const curRef = useRef(1)
  curRef.current = cur
  viewModeRef.current = viewMode
  // zoom: 'fit' = fit width(scroll)/page(single,double); a number = absolute scale (1 = 100%)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const zoomRef = useRef<number | 'fit'>('fit')
  zoomRef.current = zoom
  const baseSizeRef = useRef<{ w: number; h: number }>({ w: 612, h: 792 })
  const wheelCdRef = useRef(0)

  function fitScale(vp: { width: number; height: number }, mode: ViewMode): number {
    const c = containerRef.current
    const cw = c?.clientWidth || 900
    const ch = c?.clientHeight || 700
    if (mode === 'scroll') return Math.min(2, (cw - 40) / vp.width)
    if (mode === 'single')
      return Math.min(3, Math.min((cw - 40) / vp.width, (ch - 40) / vp.height))
    return Math.min(3, Math.min((cw / 2 - 30) / vp.width, (ch - 40) / vp.height))
  }

  function effectiveScale(vp: { width: number; height: number }): number {
    const z = zoomRef.current
    return z === 'fit' ? fitScale(vp, viewModeRef.current) : z
  }

  function currentScale(): number {
    const z = zoomRef.current
    return z === 'fit'
      ? fitScale({ width: baseSizeRef.current.w, height: baseSizeRef.current.h }, viewModeRef.current)
      : z
  }

  function zoomBy(factor: number): void {
    setZoom(Math.min(5, Math.max(0.25, currentScale() * factor)))
  }

  // re-size placeholders + re-render after a scale/mode change
  function refresh(): void {
    if (!docRef.current || !containerRef.current) return
    renderedScaleRef.current.clear()
    const { w, h } = baseSizeRef.current
    const est = effectiveScale({ width: w, height: h })
    containerRef.current.querySelectorAll('.pdf-page').forEach((el) => {
      const e = el as HTMLElement
      e.innerHTML = ''
      e.style.width = `${w * est}px`
      e.style.height = `${h * est}px`
    })
    layout()
  }

  // extract + segment a page's text once; map each text item to its sentence id
  async function ensurePageData(p: number): Promise<PageData | null> {
    if (pageDataRef.current.has(p)) return pageDataRef.current.get(p)!
    const doc = docRef.current
    if (!doc) return null
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    let text = ''
    const items: PageItem[] = []
    let prevY: number | null = null
    let prevSize = 0
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const str = it.str
      const tr = it.transform as number[]
      const size = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 10
      const y = tr[5]
      // big vertical gap between text runs = paragraph/heading boundary -> hard
      // break (so a title isn't read straight into the body); small gap = line wrap
      if (prevY !== null) {
        const gap = Math.abs(prevY - y)
        text += gap > Math.max(size, prevSize) * 1.8 ? HARD_BREAK : ' '
      }
      const start = text.length
      text += str
      items.push({ str, start, end: text.length, transform: tr, width: it.width })
      prevY = y
      prevSize = size
    }
    const segs = segment(text, `pdf-${p}`).map((s, k) => ({ ...s, id: `pdf-${p}-${k}` }))
    for (const item of items) {
      const s = segs.find((sn) => item.start >= sn.start && item.start < sn.end)
      if (s) item.sentId = s.id
    }
    const data: PageData = { sentences: segs, items }
    pageDataRef.current.set(p, data)
    return data
  }

  // Merge sentence fragments that continue across page boundaries (a page often
  // ends mid-sentence — even mid-word) so each logical sentence is synthesized as
  // ONE clip and reads seamlessly across pages.
  function rebuildGlobal(): void {
    const pages = [...pageDataRef.current.keys()].sort((a, b) => a - b)
    const perPage = pages.flatMap((p) => pageDataRef.current.get(p)!.sentences)
    const cjk = /[一-鿿]/
    const merged: Sentence[] = []
    const map = new Map<string, string>()
    let i = 0
    while (i < perPage.length) {
      const head = perPage[i]
      let text = head.text
      let j = i
      map.set(head.id, head.id)
      while (perPage[j].softEnd && j + 1 < perPage.length) {
        j++
        const sep = cjk.test(text.slice(-1)) || cjk.test(perPage[j].text.slice(0, 1)) ? '' : ' '
        text += sep + perPage[j].text
        map.set(perPage[j].id, head.id)
      }
      merged.push({ ...head, text, softEnd: perPage[j].softEnd })
      i = j + 1
    }
    mergeMapRef.current = map
    mergedRef.current = merged
    // re-tag any already-rendered spans of merged continuations to the head id
    containerRef.current?.querySelectorAll('.pdf-textlayer span[data-id]').forEach((sp) => {
      const el = sp as HTMLElement
      const mid = map.get(el.dataset.id!)
      if (mid && mid !== el.dataset.id) el.dataset.id = mid
    })
    onSentences(merged)
  }

  async function renderPage(p: number, host: HTMLElement): Promise<void> {
    if (!docRef.current) return
    const page = await docRef.current.getPage(p)
    const scale = effectiveScale(page.getViewport({ scale: 1 }))
    if (renderedScaleRef.current.get(p) === scale && host.querySelector('canvas')) return
    renderedScaleRef.current.set(p, scale)
    host.innerHTML = ''
    const viewport = page.getViewport({ scale })
    // render at the display's physical resolution so it stays crisp on hi-DPI
    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    host.style.width = `${viewport.width}px`
    host.style.height = `${viewport.height}px`
    host.appendChild(canvas)
    await page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
    }).promise

    // selectable / highlightable text layer
    const data = await ensurePageData(p)
    if (!data) return
    const layer = document.createElement('div')
    layer.className = 'pdf-textlayer'
    for (const item of data.items) {
      if (!item.str.trim()) continue
      const t = pdfjsLib.Util.transform(viewport.transform, item.transform)
      const fh = Math.hypot(t[2], t[3])
      const span = document.createElement('span')
      span.textContent = item.str
      span.style.left = `${t[4]}px`
      span.style.top = `${t[5] - fh}px`
      span.style.fontSize = `${fh}px`
      span.style.fontFamily = 'sans-serif'
      if (item.sentId) {
        span.dataset.id = mergeMapRef.current.get(item.sentId) ?? item.sentId
        span.addEventListener('dblclick', () => {
          if (span.dataset.id) onReadFrom(span.dataset.id)
        })
      }
      layer.appendChild(span)
      const targetW = item.width * scale
      const natW = span.offsetWidth
      if (natW > 0 && targetW > 0) span.style.transform = `scaleX(${targetW / natW})`
    }
    host.appendChild(layer)
    if (hlRef.current.length) applyHighlights(containerRef.current, '.pdf-textlayer span', hlRef.current)
    if (activeRef.current && pageOf(activeRef.current) === p) applyActive(activeRef.current)
  }

  // render a page during main-thread idle time, so heavy canvas work never lands
  // right at an audio transition (which would audibly break playback)
  function idleRender(p: number): void {
    if (p < 1 || p > numPagesRef.current) return
    if (renderedScaleRef.current.has(p)) return
    const host = containerRef.current?.querySelector(`.pdf-page[data-page="${p}"]`) as HTMLElement | null
    if (!host) return
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback
    if (ric) ric(() => renderPage(p, host), { timeout: 1200 })
    else setTimeout(() => renderPage(p, host), 150)
  }

  // arrange pages for the current view mode (scroll / single / double)
  function layout(): void {
    const container = containerRef.current
    if (!container) return
    const mode = viewModeRef.current
    container.classList.remove('mode-scroll', 'mode-single', 'mode-double')
    container.classList.add(`mode-${mode}`)
    const pages = Array.from(container.querySelectorAll('.pdf-page')) as HTMLElement[]

    if (mode === 'scroll') {
      ioRef.current?.disconnect()
      pages.forEach((el) => (el.style.display = ''))
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) renderPage(Number((e.target as HTMLElement).dataset.page), e.target as HTMLElement)
        },
        { root: container, rootMargin: '600px' }
      )
      pages.forEach((el) => io.observe(el))
      ioRef.current = io
      return
    }

    // single / double: only show current page(s)
    ioRef.current?.disconnect()
    const c = curRef.current
    const visible = mode === 'double' ? [c, c + 1] : [c]
    // pre-render the next spread (hidden) so flipping/crossing a page is instant
    // and never stalls the audio at a page boundary
    const ahead = mode === 'double' ? [c + 2, c + 3] : [c + 1, c + 2]
    pages.forEach((el) => {
      const p = Number(el.dataset.page)
      if (visible.includes(p)) {
        el.style.display = ''
        renderPage(p, el)
      } else {
        el.style.display = 'none'
      }
    })
    // pre-render the next spread during idle time (not at the flip itself)
    ahead.forEach((p) => idleRender(p))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const buf = await window.api.readFile(book.path)
        if (cancelled) return
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
        docRef.current = doc
        numPagesRef.current = doc.numPages
        const container = containerRef.current!
        container.innerHTML = ''

        const first = await doc.getPage(1)
        const vp1 = first.getViewport({ scale: 1 })
        baseSizeRef.current = { w: vp1.width, h: vp1.height }
        const est = effectiveScale(vp1)
        for (let p = 1; p <= doc.numPages; p++) {
          const wrap = document.createElement('div')
          wrap.className = 'pdf-page'
          wrap.dataset.page = String(p)
          wrap.style.width = `${vp1.width * est}px`
          wrap.style.height = `${vp1.height * est}px`
          container.appendChild(wrap)
        }

        // restore saved reading position immediately (before the slow full-text
        // extraction), so reopening a book lands on the right page right away
        if (typeof book.progress === 'number') {
          const target = Math.min(book.progress as number, doc.numPages)
          if (viewModeRef.current === 'scroll') {
            layout()
            requestAnimationFrame(() =>
              container.querySelector(`.pdf-page[data-page="${target}"]`)?.scrollIntoView()
            )
          } else {
            setCur(target)
            layout()
          }
        } else {
          layout()
        }

        // TOC from outline
        try {
          const outline = await doc.getOutline()
          const items: TocItem[] = []
          const walk = async (nodes: any[], level: number): Promise<void> => {
            for (const node of nodes || []) {
              let pageNo = 1
              try {
                const dest =
                  typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest
                if (dest) pageNo = (await doc.getPageIndex(dest[0])) + 1
              } catch {
                /* keep default */
              }
              items.push({ label: node.title, locator: pageNo, level })
              if (node.items?.length) await walk(node.items, level + 1)
            }
          }
          if (outline) await walk(outline, 1)
          tocRef.current = items
        } catch {
          /* no outline */
        }

        // background text extraction (search + full playback)
        for (let p = 1; p <= doc.numPages; p++) {
          if (cancelled) return
          await ensurePageData(p)
          if (p % 5 === 0 || p === doc.numPages) rebuildGlobal()
        }
      } catch (err) {
        console.error('[PdfReader] failed to load PDF:', err)
        if (containerRef.current)
          containerRef.current.innerHTML = `<div style="padding:40px;color:#e88">PDF 加载失败: ${String(err)}</div>`
      }
    })()
    return () => {
      cancelled = true
      ioRef.current?.disconnect()
    }
  }, [book.path])

  // re-layout/re-render whenever the view mode or zoom changes (scale-dependent)
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, zoom])

  // re-fit the pages when the window/container is resized (e.g. maximized)
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    let t: ReturnType<typeof setTimeout>
    let lastW = c.clientWidth
    let lastH = c.clientHeight
    const ro = new ResizeObserver(() => {
      if (!docRef.current) return
      if (Math.abs(c.clientWidth - lastW) < 4 && Math.abs(c.clientHeight - lastH) < 4) return
      lastW = c.clientWidth
      lastH = c.clientHeight
      clearTimeout(t)
      t = setTimeout(() => refresh(), 200)
    })
    ro.observe(c)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (docRef.current && viewModeRef.current !== 'scroll') layout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur])

  // mouse wheel: ctrl+wheel = zoom; plain wheel flips pages in single/double
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) {
        e.preventDefault()
        zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
        return
      }
      if (viewModeRef.current === 'scroll') return
      const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 2
      const atTop = c.scrollTop <= 2
      const dir = e.deltaY > 0 ? 1 : -1
      if ((dir > 0 && !atBottom) || (dir < 0 && !atTop)) return // let the page scroll first
      e.preventDefault()
      const now = Date.now()
      if (now < wheelCdRef.current) return
      wheelCdRef.current = now + 300
      step(dir)
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // page navigation (single / double)
  function step(dir: number): void {
    const inc = viewModeRef.current === 'double' ? 2 : 1
    setCur((c) => Math.min(Math.max(1, c + dir * inc), numPagesRef.current))
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (viewModeRef.current === 'scroll') return
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.altKey)) {
        e.preventDefault()
        step(1)
      } else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.altKey)) {
        e.preventDefault()
        step(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearActive(): void {
    containerRef.current
      ?.querySelectorAll('.pdf-textlayer span.active')
      .forEach((s) => s.classList.remove('active'))
  }
  function isVisible(el: HTMLElement): boolean {
    const c = containerRef.current
    if (!c) return false
    const r = el.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    return r.bottom > cr.top + 16 && r.top < cr.bottom - 16
  }
  function applyActive(id: string): boolean {
    const spans = containerRef.current?.querySelectorAll(`.pdf-textlayer span[data-id="${id}"]`)
    if (spans && spans.length) {
      spans.forEach((s) => s.classList.add('active'))
      // only scroll if the sentence isn't already on screen (avoids yanking the
      // view, esp. for sentences that span a page boundary)
      if (![...spans].some((s) => isVisible(s as HTMLElement))) {
        ;(spans[0] as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      return true
    }
    return false
  }

  useImperativeHandle(ref, (): ReaderHandle => ({
    getSentences: () => mergedRef.current,
    highlight: (id) => {
      clearActive()
      activeRef.current = id
      if (!id) return
      const p = pageOf(id)
      // pre-render the next couple pages during idle time while this one is read,
      // so crossing a page boundary is just a display toggle (never stalls audio)
      idleRender(p + 1)
      idleRender(p + 2)
      if (viewModeRef.current === 'double') idleRender(p + 3)
      // count this sentence's rendered spans per page
      const spans = containerRef.current?.querySelectorAll(`.pdf-textlayer span[data-id="${id}"]`)
      const pageCount = new Map<number, number>()
      spans?.forEach((sp) => {
        const pe = (sp as HTMLElement).closest('.pdf-page') as HTMLElement | null
        if (pe) {
          const pg = Number(pe.dataset.page)
          pageCount.set(pg, (pageCount.get(pg) || 0) + 1)
        }
      })
      if (viewModeRef.current === 'scroll') {
        // scroll handled by applyActive (only when off-screen); if not rendered
        // yet, bring the start page into view so it renders
        if (!spans || spans.length === 0)
          (containerRef.current?.querySelector(`.pdf-page[data-page="${p}"]`) as HTMLElement)?.scrollIntoView({
            block: 'center',
            behavior: 'smooth'
          })
      } else {
        // flip to the page holding MOST of this sentence, so the view follows the
        // reading onto the next page (a sentence may span a page boundary)
        let domPage = p
        if (pageCount.size) domPage = [...pageCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
        const cur = curRef.current
        const visiblePages = viewModeRef.current === 'double' ? [cur, cur + 1] : [cur]
        if (!visiblePages.includes(domPage)) setCur(domPage)
      }
      let tries = 0
      const tick = (): void => {
        if (activeRef.current !== id) return
        if (applyActive(id)) return
        if (tries++ < 60) requestAnimationFrame(tick)
      }
      tick()
    },
    search: (query) => {
      const hits: SearchHit[] = []
      if (!query.trim()) return hits
      const q = query.toLowerCase()
      for (const s of mergedRef.current) {
        const idx = s.text.toLowerCase().indexOf(q)
        if (idx >= 0)
          hits.push({
            id: `hit-${s.id}`,
            sentenceId: s.id,
            label: `p.${pageOf(s.id)} …${s.text.slice(Math.max(0, idx - 12), idx + q.length + 18)}…`,
            locator: s.id
          })
      }
      return hits
    },
    goToHit: (hit) => {
      const p = pageOf(hit.locator as string)
      if (viewModeRef.current === 'scroll')
        containerRef.current
          ?.querySelector(`.pdf-page[data-page="${p}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      else setCur(p)
    },
    getToc: () => tocRef.current,
    goToToc: (item) => {
      const p = Number(item.locator)
      if (viewModeRef.current === 'scroll')
        containerRef.current?.querySelector(`.pdf-page[data-page="${p}"]`)?.scrollIntoView({ behavior: 'smooth' })
      else setCur(p)
    },
    getProgress: () => {
      if (viewModeRef.current !== 'scroll') return curRef.current
      const container = containerRef.current
      if (!container) return 1
      const pages = Array.from(container.querySelectorAll('.pdf-page')) as HTMLElement[]
      const mid = container.scrollTop + container.clientHeight / 2
      for (const el of pages) if (el.offsetTop + el.offsetHeight >= mid) return Number(el.dataset.page)
      return 1
    },
    exportText: () => mergedRef.current,
    applyHighlights: (hls) => {
      hlRef.current = hls
      applyHighlights(containerRef.current, '.pdf-textlayer span', hls)
    },
    goToSentence: (id) => {
      const p = pageOf(id)
      if (viewModeRef.current === 'scroll')
        containerRef.current
          ?.querySelector(`.pdf-page[data-page="${p}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      else setCur(p)
    }
  }))

  async function handleDblClick(e: React.MouseEvent): Promise<void> {
    if ((e.target as HTMLElement).closest('.pdf-textlayer span')) return
    const pageEl = (e.target as HTMLElement).closest('.pdf-page')
    const canvas = pageEl?.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) return
    const p = Number((pageEl as HTMLElement).dataset.page)
    const existing = pageDataRef.current.get(p)
    if (existing && existing.sentences.length > 0) return
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
    try {
      const text = await ocrImage(blob)
      if (text) {
        const segs = segment(text, `pdf-${p}`).map((s, k) => ({ ...s, id: `pdf-${p}-${k}` }))
        pageDataRef.current.set(p, { sentences: segs, items: [] })
        rebuildGlobal()
        if (segs[0]) onReadFrom(segs[0].id)
      }
    } catch {
      /* OCR not installed */
    }
  }

  const showNav = viewMode !== 'scroll'
  return (
    <div className="pdf-wrap">
      <div className="pdf-scroll" ref={containerRef} onDoubleClick={handleDblClick} />
      <div className="pdf-zoom" title="Ctrl+滚轮 缩放">
        <button onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button className="zlabel" onClick={() => setZoom((z) => (z === 'fit' ? 1 : 'fit'))}>
          {zoom === 'fit' ? '适合' : `${Math.round((zoom as number) * 100)}%`}
        </button>
        <button onClick={() => zoomBy(1.2)}>＋</button>
      </div>
      {showNav && (
        <div className="pdf-nav">
          <button onClick={() => step(-1)} disabled={cur <= 1}>
            ‹
          </button>
          <span>
            {cur}
            {viewMode === 'double' && cur + 1 <= numPagesRef.current ? `-${cur + 1}` : ''} / {numPagesRef.current}
          </span>
          <button onClick={() => step(1)} disabled={cur + (viewMode === 'double' ? 2 : 1) > numPagesRef.current}>
            ›
          </button>
        </div>
      )}
    </div>
  )
})
