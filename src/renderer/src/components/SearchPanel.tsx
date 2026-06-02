import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchHit } from '../readers/types'

interface Props {
  onSearch: (q: string) => SearchHit[]
  onGo: (hit: SearchHit) => void
  onReadFrom: (sentenceId: string) => void
}

export function SearchPanel({ onSearch, onGo, onReadFrom }: Props): JSX.Element {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searched, setSearched] = useState(false)

  const run = (): void => {
    setHits(onSearch(q))
    setSearched(true)
  }

  return (
    <div className="panel">
      <div className="panel-head">{t('search')}</div>
      <div className="search-row">
        <input
          value={q}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          autoFocus
        />
        <button onClick={run}>🔍</button>
      </div>
      {searched && hits.length === 0 && <div className="empty">{t('noResults')}</div>}
      <ul className="hit-list">
        {hits.map((h) => (
          <li key={h.id}>
            <span className="hit-label" onClick={() => onGo(h)}>
              {h.label}
            </span>
            {h.sentenceId && (
              <button className="hit-read" title={t('readFromHere')} onClick={() => onReadFrom(h.sentenceId!)}>
                ▶
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
