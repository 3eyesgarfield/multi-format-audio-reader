/**
 * Sentence-level TTS playback engine.
 *
 * - Each sentence is split into maximal zh / en "runs" when auto-switch is on, so
 *   English embedded inside a Chinese sentence is voiced by the English voice (and
 *   vice-versa). Runs of one sentence play back-to-back with no gap.
 * - Plays through a single HTMLAudioElement; speed is applied instantly per run via
 *   `playbackRate` (pitch preserved), with independent zh / en speeds.
 * - Fragments cut by a line/page break (softEnd) join the next sentence gaplessly.
 * - Emits active-sentence + state changes so the UI can highlight + auto-scroll.
 */
import { Sentence, Lang, detectLang } from './segmenter'
import { synthesize } from './ttsClient'

export interface TtsSettings {
  speedZh: number
  speedEn: number
  pitch: number
  autoSwitch: boolean
  voiceZh: string
  voiceEn: string
  voiceSingle: string
  gapMs: number
  commaPause: number
}

export type PlayState = 'stopped' | 'playing' | 'paused'

export interface PlayerSource {
  sentences: Sentence[]
  onActive: (id: string | null) => void
}

interface Run {
  text: string
  lang: Lang
  voice: string
  pauseAfter: number // extra silence after this clip (comma pause), ms
}

/** Split a clause string at Chinese/ASCII commas, colons and semicolons, keeping
 *  the delimiter with the preceding clause, so we can add a configurable pause
 *  after each. ASCII ":"/";" between digits (e.g. a time "3:30") is NOT a split. */
function splitAtComma(text: string): string[] {
  const parts = text.split(/([，、,：；)）】』」]+|[:;]+(?!\d))/)
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const seg = (parts[i] || '') + (parts[i + 1] || '')
    if (seg.trim()) out.push(seg)
  }
  return out.length ? out : [text]
}

function engineOf(voiceId: string): string {
  return voiceId.split(':', 1)[0] || 'sapi'
}

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** Spell Arabic numerals out as Chinese characters so the zh voice reads them
 *  cleanly (a bare "2" confuses Kokoro's number g2p). Dots between digits become
 *  "点": "6.5.1" -> 六点五点一, "2024" -> 二零二四, "2" -> 二. */
// read a 1-2 digit integer numerically: 5->五, 10->十, 15->十五, 50->五十, 53->五十三
function intZh(s: string): string {
  if (s.length > 2) return [...s].map((d) => ZH_DIGITS[+d]).join('') // long -> digit by digit
  const n = +s
  if (n < 10) return ZH_DIGITS[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return (tens === 1 ? '十' : ZH_DIGITS[tens] + '十') + (ones ? ZH_DIGITS[ones] : '')
}

export function digitsToZh(text: string): string {
  // a number token may contain dots (decimal or version)
  return text.replace(/\d[\d.]*\d|\d/g, (tok) => {
    const dots = (tok.match(/\./g) || []).length
    if (dots >= 2) {
      // version like 6.5.1 -> 六点五点一 (digit by digit, dots -> 点)
      return [...tok].map((c) => (c === '.' ? '点' : ZH_DIGITS[+c])).join('')
    }
    if (dots === 1) {
      // decimal: integer part numeric, fractional part digit by digit
      const [int, frac] = tok.split('.')
      return intZh(int) + '点' + [...frac].map((d) => ZH_DIGITS[+d]).join('')
    }
    return intZh(tok)
  })
}

/** Read math/percent symbols as Chinese words, and keep bracketed asides from
 *  mashing into adjacent words (PDF often drops the surrounding spaces). Applied
 *  to the whole sentence before language splitting, so the inserted Chinese (大于
 *  etc.) is voiced by the Chinese voice. */
export function normalizeSymbols(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '百分之$1') // 50% -> 百分之50 (-> 百分之五十)
    .replace(/%/g, '百分号')
    .replace(/!=|≠/g, '不等于')
    .replace(/>=|≥/g, '大于等于')
    .replace(/<=|≤/g, '小于等于')
    .replace(/>/g, '大于')
    .replace(/</g, '小于')
    .replace(/=/g, '等于')
    .replace(/([)\]）】])(?=[A-Za-z0-9一-鿿])/g, '$1 ')
    .replace(/([A-Za-z0-9一-鿿])(?=[([（【])/g, '$1 ')
}

/** Split a string into maximal runs of Chinese vs English; neutral characters
 *  (digits, punctuation, spaces) stick to the current run. */
export function splitRuns(text: string): { text: string; lang: Lang }[] {
  const isCJK = (c: string): boolean => /[㐀-鿿豈-﫿]/.test(c)
  const isLatin = (c: string): boolean => /[A-Za-z]/.test(c)
  const isDigit = (c: string): boolean => /[0-9]/.test(c)
  const out: { text: string; lang: Lang }[] = []
  let cur: Lang | null = null
  let buf = ''
  for (const ch of text) {
    // digits read as Chinese ("15" -> 十五); CJK -> zh; latin -> en; else neutral
    const l: Lang | null = isCJK(ch) || isDigit(ch) ? 'zh' : isLatin(ch) ? 'en' : null
    if (l === null) {
      buf += ch
      continue
    }
    if (cur === null) {
      cur = l
      buf += ch
    } else if (l === cur) {
      buf += ch
    } else {
      out.push({ text: buf, lang: cur })
      buf = ch
      cur = l
    }
  }
  if (buf.trim()) out.push({ text: buf, lang: cur ?? detectLang(buf) })
  return out.filter((r) => r.text.trim().length > 0)
}

export class TtsPlayer {
  // two elements: one plays while the next clip is preloaded on the other, so
  // transitions have no load latency (pause values become exact)
  private els: HTMLAudioElement[] = [new Audio(), new Audio()]
  private ai = 0
  private settings: TtsSettings
  private source: PlayerSource | null = null
  private index = 0
  private runs: Run[] = []
  private runIndex = 0
  private curId: string | null = null
  private state: PlayState = 'stopped'
  private cache = new Map<string, string>()
  private inflight = new Map<string, Promise<string>>()

  onState: (s: PlayState) => void = () => {}

  private get audio(): HTMLAudioElement {
    return this.els[this.ai]
  }

  constructor(settings: TtsSettings) {
    this.settings = settings
    for (const el of this.els) {
      el.preservesPitch = true
      el.addEventListener('ended', () => this.onEnded(el))
      el.addEventListener('error', () => this.onEnded(el))
    }
  }

  updateSettings(s: TtsSettings): void {
    const voiceChanged =
      s.voiceZh !== this.settings.voiceZh ||
      s.voiceEn !== this.settings.voiceEn ||
      s.voiceSingle !== this.settings.voiceSingle ||
      s.pitch !== this.settings.pitch ||
      s.autoSwitch !== this.settings.autoSwitch
    this.settings = s
    const run = this.runs[this.runIndex]
    if (run) this.audio.playbackRate = this.speedForLang(run.lang)
    if (voiceChanged) this.clearCache()
  }

  setSource(src: PlayerSource): void {
    this.source = src
  }

  /** Pre-synthesize a tiny bit of zh + en text so the engine/model (esp. Kokoro's
   *  GPU pipeline) is loaded and the first real click starts instantly. */
  async warmup(): Promise<void> {
    const zhVoice = this.settings.autoSwitch ? this.settings.voiceZh : this.settings.voiceSingle
    const enVoice = this.settings.autoSwitch ? this.settings.voiceEn : this.settings.voiceSingle
    const jobs = new Set([zhVoice, enVoice])
    await Promise.all(
      [...jobs].map((v) => this.fetchByText(v === zhVoice ? '你好' : 'hello', v).catch(() => {}))
    )
  }

  private speedForLang(lang: Lang): number {
    return lang === 'zh' ? this.settings.speedZh : this.settings.speedEn
  }

  private buildRuns(s: Sentence): Run[] {
    const mk = (text: string, lang: Lang, voice: string): Run[] => {
      const t = lang === 'zh' ? digitsToZh(text) : text // spell numbers for zh voice
      // at 0, don't split at commas — keep one clip so the only pause is the
      // engine's own (minimal); splitting adds clip overhead on top of that
      if (this.settings.commaPause <= 0) return [{ text: t, lang, voice, pauseAfter: 0 }]
      const clauses = splitAtComma(t)
      return clauses.map((c, i) => ({
        text: c,
        lang,
        voice,
        pauseAfter: i < clauses.length - 1 ? this.settings.commaPause : 0
      }))
    }
    const base = normalizeSymbols(s.text)
    if (!this.settings.autoSwitch) return mk(base, s.lang, this.settings.voiceSingle)
    return splitRuns(base).flatMap((r) =>
      mk(r.text, r.lang, r.lang === 'zh' ? this.settings.voiceZh : this.settings.voiceEn)
    )
  }

  private async fetchByText(text: string, voice: string): Promise<string> {
    const clean = text.replace(/\s+/g, ' ').trim()
    const key = `${voice}|${this.settings.pitch}|${clean}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const existing = this.inflight.get(key)
    if (existing) return existing
    const p = synthesize({ text: clean, engine: engineOf(voice), voice, rate: 1.0, pitch: this.settings.pitch })
      .then((buf) => {
        const url = URL.createObjectURL(new Blob([buf]))
        this.cache.set(key, url)
        this.inflight.delete(key)
        return url
      })
      .catch((e) => {
        this.inflight.delete(key)
        throw e
      })
    this.inflight.set(key, p)
    return p
  }

  /** The chunk that will play after the current one (next clause, or first chunk
   *  of the next sentence). */
  private peekNext(): Run | null {
    if (this.runIndex + 1 < this.runs.length) return this.runs[this.runIndex + 1]
    const ns = this.source?.sentences[this.index + 1]
    if (!ns) return null
    return this.buildRuns(ns)[0] ?? null
  }

  /** Preload the next chunk onto the *other* element so switching to it is instant. */
  private async preloadNext(): Promise<void> {
    const next = this.peekNext()
    if (!next) return
    try {
      const url = await this.fetchByText(next.text, next.voice)
      const other = this.els[1 - this.ai]
      if (other.src !== url) {
        other.src = url
        other.load()
      }
    } catch {
      /* ignore */
    }
  }

  // (re)seed the current sentence then play its first chunk
  private playCurrent(): void {
    const list = this.source?.sentences ?? []
    if (this.index >= list.length) {
      this.stop()
      return
    }
    const s = list[this.index]
    this.curId = s.id
    this.runs = this.buildRuns(s)
    this.runIndex = 0
    this.playChunk()
  }

  private async playChunk(): Promise<void> {
    const chunk = this.runs[this.runIndex]
    if (!chunk) {
      this.advanceSentence()
      return
    }
    try {
      const url = await this.fetchByText(chunk.text, chunk.voice)
      if (this.state !== 'playing') return
      const el = this.audio
      if (el.src !== url) el.src = url
      try {
        el.currentTime = 0
      } catch {
        /* not seekable yet */
      }
      el.volume = 1
      el.playbackRate = this.speedForLang(chunk.lang)
      await el.play()
      // highlight only once audio has started (so page render/flip never delays it)
      if (this.runIndex === 0 && this.curId && this.state === 'playing') {
        this.source?.onActive(this.curId)
      }
      this.preloadNext()
    } catch {
      setTimeout(() => this.onEnded(this.audio), 200) // skip a failed chunk
    }
  }

  private onEnded(el: HTMLAudioElement): void {
    if (this.state !== 'playing' || el !== this.audio) return
    const finished = this.runs[this.runIndex]
    if (this.runIndex + 1 < this.runs.length) {
      this.runIndex++
      this.ai = 1 - this.ai // swap to the preloaded element
      const pause = finished?.pauseAfter ?? 0 // exact comma/colon pause
      if (pause > 0) setTimeout(() => this.playChunk(), pause)
      else this.playChunk()
    } else {
      this.advanceSentence()
    }
  }

  private advanceSentence(): void {
    if (this.state !== 'playing') return
    const finishedSentence = this.source?.sentences[this.index]
    this.index++
    if (this.index >= (this.source?.sentences.length ?? 0)) {
      this.stop()
      return
    }
    const s = this.source!.sentences[this.index]
    this.curId = s.id
    this.runs = this.buildRuns(s)
    this.runIndex = 0
    this.ai = 1 - this.ai // swap to the preloaded element (next sentence's chunk 0)
    const gap = finishedSentence?.softEnd ? 0 : this.settings.gapMs
    if (gap > 0) setTimeout(() => this.playChunk(), gap)
    else this.playChunk()
  }

  playFrom(id: string): void {
    const list = this.source?.sentences ?? []
    const i = list.findIndex((s) => s.id === id)
    if (i < 0) return
    this.index = i
    this.setState('playing')
    this.playCurrent()
  }

  play(): void {
    if (this.state === 'paused') {
      this.setState('playing')
      this.audio.play().catch(() => this.onEnded(this.audio))
      return
    }
    if (!this.source?.sentences.length) return
    this.setState('playing')
    this.playCurrent()
  }

  pause(): void {
    if (this.state === 'playing') {
      this.audio.pause()
      this.setState('paused')
    }
  }

  toggle(): void {
    if (this.state === 'playing') this.pause()
    else this.play()
  }

  next(): void {
    this.audio.pause()
    this.setState('playing')
    this.index = Math.min(this.index + 1, (this.source?.sentences.length ?? 1) - 1)
    this.playCurrent()
  }

  prev(): void {
    this.audio.pause()
    this.setState('playing')
    this.index = Math.max(this.index - 1, 0)
    this.playCurrent()
  }

  stop(): void {
    for (const el of this.els) {
      el.pause()
      el.removeAttribute('src')
    }
    this.setState('stopped')
    this.source?.onActive(null)
    this.index = 0
    this.runs = []
    this.runIndex = 0
    this.ai = 0
  }

  /** Fade out then stop — used by the sleep timer. */
  fadeOutStop(ms = 4000): void {
    const startVol = this.audio.volume
    const steps = 20
    let n = 0
    const t = setInterval(() => {
      n++
      this.audio.volume = Math.max(0, startVol * (1 - n / steps))
      if (n >= steps) {
        clearInterval(t)
        this.stop()
        this.audio.volume = startVol
      }
    }, ms / steps)
  }

  getState(): PlayState {
    return this.state
  }

  private setState(s: PlayState): void {
    this.state = s
    this.onState(s)
  }

  private clearCache(): void {
    for (const url of this.cache.values()) URL.revokeObjectURL(url)
    this.cache.clear()
    this.inflight.clear()
  }
}
