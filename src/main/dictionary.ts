import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Offline dictionary lookup. Loads CC-CEDICT (中→英) lazily from
 * resources/dict/cedict_ts.u8 when present. Returns null if no dictionary is
 * installed, so the UI can degrade gracefully (or fall back to online translate).
 *
 * CC-CEDICT line format:  traditional simplified [pin1 yin1] /gloss1/gloss2/
 */
interface Entry {
  word: string
  pinyin: string
  defs: string[]
}

let index: Map<string, Entry[]> | null = null
let tried = false

function dictPath(): string {
  const dev = join(app.getAppPath(), 'resources', 'dict', 'cedict_ts.u8')
  const prod = join(process.resourcesPath, 'dict', 'cedict_ts.u8')
  return existsSync(dev) ? dev : prod
}

function ensureLoaded(): void {
  if (tried) return
  tried = true
  const p = dictPath()
  if (!existsSync(p)) return
  index = new Map()
  const text = readFileSync(p, 'utf-8')
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.+)\/\s*$/)
    if (!m) continue
    const [, , simp, pinyin, glossRaw] = m
    const entry: Entry = { word: simp, pinyin, defs: glossRaw.split('/').filter(Boolean) }
    const arr = index.get(simp) ?? []
    arr.push(entry)
    index.set(simp, arr)
  }
}

export function lookup(word: string): Entry[] | null {
  ensureLoaded()
  if (!index) return null
  const w = word.trim()
  // exact match, then progressively shorter prefixes for multi-char selections
  for (let len = w.length; len >= 1; len--) {
    const hit = index.get(w.slice(0, len))
    if (hit) return hit
  }
  return []
}

export function dictionaryAvailable(): boolean {
  ensureLoaded()
  return index !== null
}

/* ------------------------------------------------------------------ */
/* ECDICT (英 -> 中) — large CSV, loaded incrementally in the background  */
/* ------------------------------------------------------------------ */

export interface EnEntry {
  word: string
  phonetic: string
  translation: string
}

let ecdict: Map<string, EnEntry> | null = null
let ecdictLoading = false

function ecdictPath(): string {
  const dev = join(app.getAppPath(), 'resources', 'dict', 'ecdict.csv')
  const prod = join(process.resourcesPath, 'dict', 'ecdict.csv')
  return existsSync(dev) ? dev : prod
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Kick off background loading of ECDICT (called once at app startup). */
export function preloadEcdict(): void {
  if (ecdict || ecdictLoading) return
  const p = ecdictPath()
  if (!existsSync(p)) return
  ecdictLoading = true
  const lines = readFileSync(p, 'utf-8').split('\n')
  const map = new Map<string, EnEntry>()
  let i = 1 // skip header
  const step = (): void => {
    const end = Math.min(i + 20000, lines.length)
    for (; i < end; i++) {
      const line = lines[i]
      if (!line) continue
      const f = parseCsvLine(line)
      const word = (f[0] || '').toLowerCase()
      const translation = (f[3] || '').replace(/\\n/g, '; ').trim()
      if (word && translation) map.set(word, { word: f[0], phonetic: f[1] || '', translation })
    }
    if (i < lines.length) setImmediate(step)
    else {
      ecdict = map
      ecdictLoading = false
    }
  }
  setImmediate(step)
}

export function lookupEnglish(word: string): EnEntry | null {
  const w = word.trim().toLowerCase()
  if (!ecdict || !w) return null
  return ecdict.get(w) ?? ecdict.get(w.replace(/[^a-z'-]/g, '')) ?? null
}
