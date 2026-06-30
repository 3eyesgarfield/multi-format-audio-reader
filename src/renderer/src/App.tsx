import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, BookMeta } from './store'
import { TtsPlayer } from './tts/player'
import {
  initTtsBase,
  getHealth,
  getVoices,
  exportAudio,
  ExportSegment
} from './tts/ttsClient'
import { Sentence } from './tts/segmenter'
import { ReaderHandle, TocItem, SearchHit } from './readers/types'
import { MarkdownReader } from './readers/MarkdownReader'
import { PdfReader } from './readers/PdfReader'
import { EpubReader } from './readers/EpubReader'
import { Library } from './components/Library'
import { TocPanel } from './components/TocPanel'
import { SearchPanel } from './components/SearchPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { VocabPanel } from './components/VocabPanel'
import { NotesPanel, Highlight } from './components/NotesPanel'
import { HoverDict, HoverInfo } from './components/HoverDict'

export default function App(): JSX.Element {
  const { t } = useTranslation()
  const s = useStore()
  const readerRef = useRef<ReaderHandle>(null)
  const playerRef = useRef<TtsPlayer | null>(null)
  const loadedRef = useRef(false) // don't persist settings until saved ones are loaded
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [noteBtn, setNoteBtn] = useState<{ text: string; sentenceId?: string; x: number; y: number } | null>(null)
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ---- one-time init ----
  useEffect(() => {
    // (re)load engine health + voice list from the sidecar. Safe to call again:
    // the first attempt at launch can land before the Python sidecar is up, so we
    // also re-run this when main signals `tts:ready` (and bail quietly until then).
    const loadEngines = async (): Promise<void> => {
      const st = useStore.getState()
      const health = await getHealth()
      if (health) st.setHealth(health)
      const voices = await getVoices()
      if (!voices.length) return // sidecar not ready yet — tts:ready will retrigger
      st.setVoices(voices)
      const ids = new Set(voices.map((v) => v.id))
      const zh = voices.find((v) => v.lang === 'zh')
      const en = voices.find((v) => v.lang === 'en')
      const cur = useStore.getState().tts
      const patch: Record<string, string> = {}
      if (!ids.has(cur.voiceZh) && zh) patch.voiceZh = zh.id
      if (!ids.has(cur.voiceEn) && en) patch.voiceEn = en.id
      if (!ids.has(cur.voiceSingle) && zh) patch.voiceSingle = zh.id
      if (Object.keys(patch).length) st.setTts(patch as never)
    }

    ;(async () => {
      await initTtsBase()
      const saved = (await window.api.store.getSettings()) as Record<string, unknown>
      if (saved.tts) {
        // migrate old single `speed` -> separate zh/en speeds
        const t = saved.tts as Record<string, unknown>
        if (t.speed != null && t.speedZh == null) {
          t.speedZh = t.speed
          t.speedEn = t.speed
        }
        s.setTts(t as never)
      }
      if (saved.theme) s.setTheme(saved.theme as never)
      if (saved.viewMode) s.setViewMode(saved.viewMode as never)
      if (saved.pdfPageGap !== undefined) s.setPdfPageGap(saved.pdfPageGap as number)
      if (saved.dictZhToEn !== undefined) s.setDictZhToEn(saved.dictZhToEn as boolean)
      if (saved.showCaption !== undefined) s.setShowCaption(saved.showCaption as boolean)
      if (saved.enableKokoro !== undefined) s.setEnableKokoro(saved.enableKokoro as boolean)
      await loadEngines()
      loadedRef.current = true // saved settings now applied -> safe to persist changes
      // pre-warm the TTS engine/model so the first click starts instantly
      // (delay lets the player pick up the loaded voice settings first)
      setTimeout(() => playerRef.current?.warmup(), 1200)
    })()

    window.api.onMediaKey((action) => {
      const p = playerRef.current
      if (!p) return
      if (action === 'playpause') p.toggle()
      else if (action === 'next') p.next()
      else if (action === 'prev') p.prev()
    })
    window.api.onOpenPath((meta) => {
      if (meta) openBook(meta as BookMeta)
    })
    // sidecar finished booting -> (re)load voices now that /voices will answer
    window.api.onTtsReady((ok) => {
      if (ok) loadEngines()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- create / update player ----
  useEffect(() => {
    if (!playerRef.current) {
      playerRef.current = new TtsPlayer(s.tts)
      playerRef.current.onState = (st) => s.setPlayState(st)
    } else {
      playerRef.current.updateSettings(s.tts)
    }
    // persist settings — but only after the saved ones have been loaded, otherwise
    // the initial default state would overwrite the user's saved settings on launch
    if (loadedRef.current) {
      window.api.store.setSettings({
        tts: s.tts,
        theme: s.theme,
        viewMode: s.viewMode,
        pdfPageGap: s.pdfPageGap,
        dictZhToEn: s.dictZhToEn,
        showCaption: s.showCaption,
        enableKokoro: s.enableKokoro
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tts, s.theme, s.viewMode, s.pdfPageGap, s.dictZhToEn, s.showCaption, s.enableKokoro])

  // ---- bind sentences to player ----
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    p.setSource({
      sentences,
      onActive: (id) => {
        s.setActive(id)
        readerRef.current?.highlight(id)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences])

  // ---- load highlights when the book changes ----
  useEffect(() => {
    if (s.book) window.api.store.getHighlights(s.book.id).then(setHighlights)
    else setHighlights([])
  }, [s.book])

  // ---- (re)apply highlights to the reader when they or the content change ----
  useEffect(() => {
    readerRef.current?.applyHighlights(highlights.map((h) => ({ locator: h.locator, color: h.color })))
  }, [highlights, sentences])

  // ---- sleep timer ----
  useEffect(() => {
    if (!s.sleepMinutes) return
    const handle = setTimeout(() => {
      playerRef.current?.fadeOutStop()
      s.setSleep(null)
    }, s.sleepMinutes * 60 * 1000)
    return () => clearTimeout(handle)
  }, [s.sleepMinutes])

  // ---- periodic progress save ----
  useEffect(() => {
    if (!s.book) return
    const save = (): void => {
      const prog = readerRef.current?.getProgress()
      if (prog !== undefined && s.book) window.api.store.setProgress(s.book.id, prog)
    }
    const h = setInterval(save, 5000)
    window.addEventListener('beforeunload', save)
    return () => {
      clearInterval(h)
      save()
      window.removeEventListener('beforeunload', save)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.book])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const p = playerRef.current
      if (!p) return
      if (e.code === 'Space') {
        e.preventDefault()
        p.toggle()
      } else if (e.code === 'ArrowRight' && e.altKey) p.next()
      else if (e.code === 'ArrowLeft' && e.altKey) p.prev()
      else if (e.key === 'f' && e.ctrlKey) s.setPanel('search')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- fullscreen (immersive reading) ----
  useEffect(() => {
    const onFs = (): void => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  function toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen()
  }

  function openBook(meta: BookMeta): void {
    // re-opening the already-open book: just close the panel, keep state/playback
    if (s.book?.id === meta.id) {
      s.setPanel(null)
      return
    }
    playerRef.current?.stop()
    setSentences([])
    s.setBook(meta)
    s.setPanel(null)
  }

  async function openDialog(): Promise<void> {
    const meta = await window.api.openBookDialog()
    if (meta && !(meta as { error?: string }).error) openBook(meta as BookMeta)
  }

  function readFrom(id: string): void {
    playerRef.current?.playFrom(id)
  }

  function onSentences(list: Sentence[]): void {
    setSentences(list)
  }

  async function deleteHighlight(h: Highlight): Promise<void> {
    await window.api.store.removeHighlight(h.id)
    if (s.book) setHighlights(await window.api.store.getHighlights(s.book.id))
  }

  async function clearNotes(): Promise<void> {
    if (!s.book) return
    await window.api.store.clearHighlights(s.book.id)
    setHighlights([])
  }

  // selecting a passage (not just a word) -> offer a "save to notes" button
  function onReaderMouseUp(e: React.MouseEvent): void {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (text.length >= 8) {
      const node = sel?.anchorNode
      const el = node && node.nodeType === 3 ? node.parentElement : (node as Element | null)
      const sentenceId = el?.closest('[data-id]')?.getAttribute('data-id') ?? undefined
      setNoteBtn({ text, sentenceId, x: e.clientX, y: e.clientY })
    } else {
      setNoteBtn(null)
    }
  }

  async function saveNote(): Promise<void> {
    if (!s.book || !noteBtn) return
    const h: Highlight = {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2),
      bookId: s.book.id,
      locator: noteBtn.sentenceId ?? '',
      text: noteBtn.text.replace(/\s+/g, ' ').trim(),
      color: 'yellow',
      createdAt: Date.now()
    }
    await window.api.store.addHighlight(h)
    setHighlights(await window.api.store.getHighlights(s.book.id))
    setNoteBtn(null)
    window.getSelection()?.removeAllRanges()
  }

  // ---- hover dictionary ----
  function wordAtPoint(x: number, y: number): { word: string; lang: 'en' | 'zh' } | null {
    const doc = document as unknown as {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    let range: Range | null = null
    if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y)
    else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y)
      if (pos) {
        range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
      }
    }
    const node = range?.startContainer
    if (!node || node.nodeType !== 3) return null
    const text = node.textContent || ''
    const off = range!.startOffset
    const around = text[off] || text[off - 1] || ''
    if (/[A-Za-z]/.test(around)) {
      let st = off
      let en = off
      while (st > 0 && /[A-Za-z'-]/.test(text[st - 1])) st--
      while (en < text.length && /[A-Za-z'-]/.test(text[en])) en++
      const word = text.slice(st, en).replace(/^[-']+|[-']+$/g, '')
      if (word.length >= 1) return { word, lang: 'en' }
    }
    if (/[一-鿿]/.test(around)) {
      const start = /[一-鿿]/.test(text[off] || '') ? off : Math.max(0, off - 1)
      return { word: text.slice(start, start + 4), lang: 'zh' }
    }
    return null
  }

  function scheduleHoverDismiss(): void {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setHover(null), 450)
  }
  function keepHover(): void {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }

  function onReaderMove(e: React.MouseEvent): void {
    const x = e.clientX
    const y = e.clientY
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(async () => {
      const w = wordAtPoint(x, y)
      if (!w) {
        scheduleHoverDismiss() // empty area — give time to reach the popup, then hide
        return
      }
      if (w.lang === 'en') {
        const e2 = await window.api.dict.lookupEn(w.word)
        if (e2) {
          if (dismissTimer.current) clearTimeout(dismissTimer.current)
          setHover({ word: e2.word, phonetic: e2.phonetic, meaning: e2.translation, lang: 'en', x, y })
        } else scheduleHoverDismiss()
      } else if (w.lang === 'zh' && s.dictZhToEn) {
        const r = await window.api.dict.lookup(w.word)
        if (r && r.length) {
          if (dismissTimer.current) clearTimeout(dismissTimer.current)
          setHover({ word: r[0].word, phonetic: r[0].pinyin, meaning: r[0].defs.join('; '), lang: 'zh', x, y })
        } else scheduleHoverDismiss()
      } else scheduleHoverDismiss()
    }, 250)
  }

  function onReaderLeave(): void {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    scheduleHoverDismiss()
  }

  function addVocabFromHover(): void {
    if (!hover) return
    window.api.store.addVocab({
      word: hover.word,
      lang: hover.lang,
      definition: hover.meaning,
      phonetic: hover.phonetic,
      createdAt: Date.now()
    })
    s.bumpVocab()
    setHover(null)
  }

  // ---- export audiobook ----
  async function doExport(): Promise<void> {
    const all = readerRef.current?.exportText() ?? []
    if (all.length === 0) return
    const name = (s.book?.title ?? 'audiobook').replace(/\.[^.]+$/, '') + '.mp3'
    const out = await window.api.saveAudioDialog(name)
    if (!out) return
    const segs: ExportSegment[] = all.map((sent) => {
      const voice = s.tts.autoSwitch
        ? sent.lang === 'zh'
          ? s.tts.voiceZh
          : s.tts.voiceEn
        : s.tts.voiceSingle
      return { text: sent.text, engine: voice.split(':')[0], voice, rate: 1.0 }
    })
    setExporting({ done: 0, total: segs.length })
    try {
      await exportAudio(segs, out, out.endsWith('.wav') ? 'wav' : 'mp3', (p) =>
        setExporting({ done: p.done, total: p.total })
      )
    } finally {
      setTimeout(() => setExporting(null), 1500)
    }
  }

  const activeText = useMemo(
    () => sentences.find((x) => x.id === s.activeSentence)?.text ?? '',
    [sentences, s.activeSentence]
  )

  const rootClass =
    (s.theme.dark ? 'app dark' : 'app light') + (isFullscreen ? ' immersive' : '')
  const readerStyle = {
    ['--reader-font-size' as string]: `${s.theme.fontSize}px`,
    ['--reader-line-height' as string]: String(s.theme.lineHeight),
    ['--reader-font' as string]: s.theme.fontFamily
  } as React.CSSProperties

  const p = playerRef.current

  return (
    <div className={rootClass} onMouseDown={() => setNoteBtn(null)}>
      {/* left rail */}
      <div className="rail">
        <button className={s.panel === 'library' ? 'on' : ''} title={t('library')} onClick={() => s.setPanel(s.panel === 'library' ? null : 'library')}>📚</button>
        <button className={s.panel === 'toc' ? 'on' : ''} title={t('toc')} onClick={() => s.setPanel(s.panel === 'toc' ? null : 'toc')}>📑</button>
        <button className={s.panel === 'search' ? 'on' : ''} title={t('search')} onClick={() => s.setPanel(s.panel === 'search' ? null : 'search')}>🔍</button>
        <button className={s.panel === 'notes' ? 'on' : ''} title={t('notes')} onClick={() => s.setPanel(s.panel === 'notes' ? null : 'notes')}>🖍️</button>
        <button className={s.panel === 'vocab' ? 'on' : ''} title={t('vocab')} onClick={() => s.setPanel(s.panel === 'vocab' ? null : 'vocab')}>📒</button>
        <button className={s.panel === 'settings' ? 'on' : ''} title={t('settings')} onClick={() => s.setPanel(s.panel === 'settings' ? null : 'settings')}>⚙️</button>
      </div>

      {/* side panel */}
      {s.panel && (
        <div className="side">
          {s.panel === 'library' && <Library onOpen={openBook} onOpenDialog={openDialog} />}
          {s.panel === 'toc' && (
            <TocPanel items={readerRef.current?.getToc() ?? []} onGo={(it: TocItem) => readerRef.current?.goToToc(it)} />
          )}
          {s.panel === 'search' && (
            <SearchPanel
              onSearch={(q) => readerRef.current?.search(q) ?? []}
              onGo={(h: SearchHit) => readerRef.current?.goToHit(h)}
              onReadFrom={readFrom}
            />
          )}
          {s.panel === 'notes' && (
            <NotesPanel
              highlights={highlights}
              onGo={(h) => readerRef.current?.goToSentence(h.locator)}
              onDelete={deleteHighlight}
              onClear={clearNotes}
            />
          )}
          {s.panel === 'vocab' && <VocabPanel />}
          {s.panel === 'settings' && <SettingsPanel onExport={doExport} />}
        </div>
      )}

      {/* main reading area */}
      <div className="main">
        <div className="topbar">
          <button onClick={openDialog}>📂 {t('open')}</button>
          <div className="title" title={s.book?.title}>
            {s.book?.title ?? 'Polyglot Reader'}
          </div>
          {s.book?.format === 'pdf' && (
            <div className="viewmode">
              {(['scroll', 'single', 'double'] as const).map((m) => (
                <button
                  key={m}
                  className={s.viewMode === m ? 'on' : ''}
                  onClick={() => s.setViewMode(m)}
                  title={m === 'scroll' ? '滚动' : m === 'single' ? '单页' : '双页'}
                >
                  {m === 'scroll' ? '滚动' : m === 'single' ? '单页' : '双页'}
                </button>
              ))}
            </div>
          )}
          <div className="transport">
            <button onClick={() => p?.prev()} title={t('prev')}>⏮</button>
            <button className="play" onClick={() => p?.toggle()}>
              {s.playState === 'playing' ? '⏸' : '▶'}
            </button>
            <button onClick={() => p?.next()} title={t('next')}>⏭</button>
            <button onClick={() => p?.stop()} title={t('stop')}>⏹</button>
            <div className="speedctl">
              <span>中 {s.tts.speedZh.toFixed(2)}×</span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={s.tts.speedZh}
                onChange={(e) => s.setTts({ speedZh: Number(e.target.value) })}
              />
            </div>
            <div className="speedctl">
              <span>EN {s.tts.speedEn.toFixed(2)}×</span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={s.tts.speedEn}
                onChange={(e) => s.setTts({ speedEn: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div
          className="reader"
          style={readerStyle}
          onMouseUp={onReaderMouseUp}
          onMouseMove={onReaderMove}
          onMouseLeave={onReaderLeave}
        >
          {!s.book && <div className="welcome">{t('noBooks')}</div>}
          {s.book?.format === 'md' && (
            <MarkdownReader key={s.book.id} ref={readerRef} book={s.book} onSentences={onSentences} onReadFrom={readFrom} />
          )}
          {s.book?.format === 'pdf' && (
            <PdfReader
              key={s.book.id}
              ref={readerRef}
              book={s.book}
              viewMode={s.viewMode}
              pageGap={s.pdfPageGap}
              onSentences={onSentences}
              onReadFrom={readFrom}
            />
          )}
          {s.book?.format === 'epub' && (
            <EpubReader key={s.book.id} ref={readerRef} book={s.book} onSentences={onSentences} onReadFrom={readFrom} />
          )}
        </div>

        {s.showCaption && activeText && (
          <div className="caption" onClick={() => s.activeSentence && readFrom(s.activeSentence)}>
            {activeText}
          </div>
        )}
      </div>

      {noteBtn && (
        <button
          className="note-pop"
          style={{
            left: Math.min(noteBtn.x, window.innerWidth - 130),
            top: noteBtn.y + 12
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={saveNote}
        >
          📝 {t('addNote')}
        </button>
      )}

      {hover && (
        <HoverDict
          info={hover}
          onAddVocab={addVocabFromHover}
          onClose={() => setHover(null)}
          onMouseEnter={keepHover}
          onMouseLeave={scheduleHoverDismiss}
        />
      )}

      {/* floating controls (top-right, semi-transparent) */}
      <div className="float-ctrls">
        {/* play/pause only while immersive — the topbar transport is hidden then */}
        {isFullscreen && (
          <button
            className="fc-btn"
            title={s.playState === 'playing' ? t('pause') : t('play')}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => p?.toggle()}
          >
            {s.playState === 'playing' ? '⏸' : '▶'}
          </button>
        )}
        <button
          className="fc-btn"
          title={isFullscreen ? t('exitFullscreen') : t('fullscreen')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? '🗗' : '⛶'}
        </button>
      </div>

      {exporting && (
        <div className="export-overlay">
          <div className="export-box">
            <div>{exporting.done >= exporting.total ? t('done') : t('exporting')}</div>
            <progress max={exporting.total} value={exporting.done} />
            <div>{exporting.done}/{exporting.total}</div>
          </div>
        </div>
      )}
    </div>
  )
}
