import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

/**
 * Tiny JSON-file persistence for a single-user desktop app: library, reading
 * progress, bookmarks, highlights/notes, vocabulary and settings. Plenty for the
 * data volumes here and avoids native (better-sqlite3) rebuild headaches.
 */
export interface Highlight {
  id: string
  bookId: string
  locator: string // pdf page+rect | epub CFI | md char-offset
  text: string
  note?: string
  color?: string
  createdAt: number
}

export interface VocabEntry {
  word: string
  lang: string
  definition?: string
  phonetic?: string
  bookId?: string
  createdAt: number
}

export interface BookRecord {
  id: string // hash of path
  path: string
  title: string
  format: 'pdf' | 'epub' | 'md'
  addedAt: number
  lastOpenedAt: number
  progress?: unknown // format-specific locator (page no / CFI / scroll ratio)
  cover?: string
}

interface DataShape {
  books: Record<string, BookRecord>
  highlights: Highlight[]
  vocab: VocabEntry[]
  settings: Record<string, unknown>
}

const empty: DataShape = { books: {}, highlights: [], vocab: [], settings: {} }
let cache: DataShape | null = null

function file(): string {
  return join(app.getPath('userData'), 'reader-data.json')
}

function load(): DataShape {
  if (cache) return cache
  const f = file()
  let data: DataShape
  if (existsSync(f)) {
    try {
      data = { ...empty, ...JSON.parse(readFileSync(f, 'utf-8')) }
    } catch {
      data = { ...empty }
    }
  } else {
    data = { ...empty }
  }
  cache = data
  return data
}

function save(): void {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(load(), null, 2), 'utf-8')
}

export const store = {
  listBooks(): BookRecord[] {
    return Object.values(load().books).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  },
  upsertBook(b: BookRecord): void {
    load().books[b.id] = { ...load().books[b.id], ...b }
    save()
  },
  setProgress(id: string, progress: unknown): void {
    const d = load()
    if (d.books[id]) {
      d.books[id].progress = progress
      d.books[id].lastOpenedAt = Date.now()
      save()
    }
  },
  removeBook(id: string): void {
    delete load().books[id]
    save()
  },
  clearBooks(): void {
    load().books = {}
    save()
  },
  getHighlights(bookId: string): Highlight[] {
    return load().highlights.filter((h) => h.bookId === bookId)
  },
  addHighlight(h: Highlight): void {
    load().highlights.push(h)
    save()
  },
  removeHighlight(id: string): void {
    const d = load()
    d.highlights = d.highlights.filter((h) => h.id !== id)
    save()
  },
  clearHighlights(bookId: string): void {
    const d = load()
    d.highlights = d.highlights.filter((h) => h.bookId !== bookId)
    save()
  },
  getVocab(): VocabEntry[] {
    return load().vocab
  },
  addVocab(v: VocabEntry): void {
    const d = load()
    if (!d.vocab.some((e) => e.word === v.word && e.lang === v.lang)) {
      d.vocab.push(v)
      save()
    }
  },
  removeVocab(word: string, lang: string): void {
    const d = load()
    d.vocab = d.vocab.filter((e) => !(e.word === word && e.lang === lang))
    save()
  },
  clearVocab(): void {
    load().vocab = []
    save()
  },
  getSettings(): Record<string, unknown> {
    return load().settings
  },
  setSettings(s: Record<string, unknown>): void {
    load().settings = { ...load().settings, ...s }
    save()
  }
}
