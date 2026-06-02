import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

interface VocabEntry {
  word: string
  lang: string
  definition?: string
  phonetic?: string
  createdAt: number
}

export function VocabPanel(): JSX.Element {
  const { t } = useTranslation()
  const [items, setItems] = useState<VocabEntry[]>([])

  async function enrich(list: VocabEntry[]): Promise<VocabEntry[]> {
    return Promise.all(
      list.map(async (v) => {
        if (v.definition && v.phonetic) return v // already complete
        try {
          if (v.lang === 'en') {
            const e = await window.api.dict.lookupEn(v.word)
            if (e) return { ...v, definition: v.definition || e.translation, phonetic: v.phonetic || e.phonetic }
          } else {
            const r = await window.api.dict.lookup(v.word)
            if (r && r.length)
              return {
                ...v,
                definition: v.definition || r[0].defs.slice(0, 4).join('; '),
                phonetic: v.phonetic || r[0].pinyin
              }
          }
        } catch {
          /* ignore */
        }
        return v
      })
    )
  }

  const vocabVersion = useStore((s) => s.vocabVersion)
  const refresh = (): void => {
    window.api.store.getVocab().then((list: VocabEntry[]) => enrich(list).then(setItems))
  }
  useEffect(refresh, [vocabVersion])

  function exportMd(): void {
    const lines = ['# 生词本 / Vocabulary', '']
    for (const v of items) {
      const ph = v.phonetic ? ` [${v.phonetic}]` : ''
      lines.push(`- **${v.word}**${ph}${v.definition ? ' — ' + v.definition.replace(/\n/g, ' ') : ''}`)
    }
    window.api.saveTextFile('vocabulary.md', lines.join('\n'))
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{t('vocab')}</span>
        {items.length > 0 && (
          <span className="head-actions">
            <button className="link-btn" onClick={exportMd}>
              {t('exportMd')}
            </button>
            <button
              className="link-btn"
              onClick={() => {
                if (confirm(t('confirmClearAll'))) window.api.store.clearVocab().then(() => setItems([]))
              }}
            >
              {t('clearAll')}
            </button>
          </span>
        )}
      </div>
      {items.length === 0 && <div className="empty">—</div>}
      <ul className="vocab-list">
        {items.map((v) => (
          <li key={v.word + v.lang}>
            <div className="vocab-main">
              <div className="vocab-word">
                {v.word}
                {v.phonetic && <span className="vocab-ph"> [{v.phonetic}]</span>}
              </div>
              {v.definition && <div className="vocab-def">{v.definition}</div>}
            </div>
            <button
              className="book-del"
              onClick={() => window.api.store.removeVocab(v.word, v.lang).then(refresh)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
