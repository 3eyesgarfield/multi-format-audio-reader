import { Sentence } from '../tts/segmenter'

export interface SearchHit {
  id: string // unique hit id
  sentenceId?: string
  label: string // snippet to show in results
  locator: unknown // reader-specific (sentence id, page, cfi…)
}

export interface TocItem {
  label: string
  locator: unknown
  level: number
}

/** Imperative handle every reader exposes to the app shell. */
export interface ReaderHandle {
  getSentences(): Sentence[]
  highlight(id: string | null): void
  search(query: string): SearchHit[]
  goToHit(hit: SearchHit): void
  getToc(): TocItem[]
  goToToc(item: TocItem): void
  getProgress(): unknown
  /** Flat text for whole-document audiobook export. */
  exportText(): Sentence[]
  /** (Re)apply the given persistent highlights (by sentence id). */
  applyHighlights(hls: { locator: string; color?: string }[]): void
  /** Scroll to a sentence by id (used to jump to a saved note). */
  goToSentence(id: string): void
}
