/**
 * Sentence segmentation + per-sentence language detection (zh / en).
 *
 * Splits on CJK punctuation (。！？…) and ASCII sentence enders (.!?), keeping
 * the delimiter, and tags each sentence by Chinese-character ratio so the player
 * can route it to a zh or en voice when "auto switch voice" is enabled.
 */
export type Lang = 'zh' | 'en'

export interface Sentence {
  id: string
  text: string
  lang: Lang
  /** char offset range within the source text (for text-layer highlighting) */
  start: number
  end: number
  /** true when this fragment was cut by a line/page break (no terminal punctuation
   *  and no hard boundary), i.e. it continues into the next sentence — the player
   *  joins it gaplessly and the PDF reader merges it across page boundaries. */
  softEnd?: boolean
}

// HARD-BREAK sentinel (U+001D) the PDF reader inserts at paragraph / heading
// boundaries (detected from vertical gaps) so a title isn't read straight into the
// following body text. It always ends a sentence and is NOT a soft continuation.
export const HARD_BREAK = String.fromCharCode(0x1d)

// Sentence boundaries: CJK 。！？…, ASCII .!? (not before a digit so "6.5.1" stays
// intact), and the hard-break sentinel. Commas/colons/semicolons are NOT sentence
// ends (they become adjustable in-sentence pauses, see splitAtComma in player.ts).
// Newlines are not boundaries (PDF wraps lines mid-sentence).
const ENDERS = new RegExp('([。！？…]+|[.!?]+(?![0-9])|' + HARD_BREAK + '+)')

export function detectLang(text: string): Lang {
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  const latin = (text.match(/[A-Za-z]/g) || []).length
  // any meaningful amount of Chinese -> treat as zh (Chinese is the harder case)
  if (cjk > 0 && cjk * 3 >= latin) return 'zh'
  if (latin > 0) return 'en'
  return cjk > 0 ? 'zh' : 'en'
}

export function segment(text: string, idPrefix = 's'): Sentence[] {
  const out: Sentence[] = []
  if (!text) return out

  const parts = text.split(ENDERS)
  let cursor = 0
  let buf = ''
  let bufStart = 0
  let n = 0

  // `hard` = flushed at a real boundary (punctuation or hard-break sentinel) ->
  // not a soft continuation. Length-fallback / end-of-text flushes are soft.
  const flush = (end: number, hard: boolean): void => {
    const clean = buf.split(HARD_BREAK).join('').trim()
    if (clean.length > 0) {
      out.push({
        id: `${idPrefix}-${n++}`,
        text: clean,
        lang: detectLang(clean),
        start: bufStart,
        end,
        softEnd: !hard
      })
    }
    buf = ''
  }

  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i]
    if (!piece) continue
    if (buf === '') bufStart = cursor
    buf += piece
    cursor += piece.length
    // odd indexes are the captured delimiters -> a real sentence boundary
    if (i % 2 === 1) {
      flush(cursor, true)
    } else if (buf.length > 600) {
      // safety valve for pathologically long runs with no punctuation (soft)
      flush(cursor, false)
    }
  }
  flush(cursor, false)
  return out
}
