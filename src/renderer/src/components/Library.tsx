import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookMeta } from '../store'

interface Props {
  onOpen: (b: BookMeta) => void
  onOpenDialog: () => void
}

export function Library({ onOpen, onOpenDialog }: Props): JSX.Element {
  const { t } = useTranslation()
  const [books, setBooks] = useState<BookMeta[]>([])

  useEffect(() => {
    window.api.store.listBooks().then(setBooks)
  }, [])

  const fmtIcon: Record<string, string> = { pdf: '📄', epub: '📖', md: '📝' }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{t('library')}</span>
        <button className="btn-primary" onClick={onOpenDialog}>
          + {t('open')}
        </button>
      </div>
      <div className="panel-sub">
        <span>{t('recent')}</span>
        {books.length > 0 && (
          <button
            className="link-btn"
            onClick={() => {
              if (confirm(t('confirmClear')))
                window.api.store.clearBooks().then(() => setBooks([]))
            }}
          >
            {t('clearLibrary')}
          </button>
        )}
      </div>
      {books.length === 0 && <div className="empty">{t('noBooks')}</div>}
      <ul className="book-list">
        {books.map((b) => (
          <li key={b.id} onClick={() => onOpen(b)}>
            <span className="book-icon">{fmtIcon[b.format] ?? '📘'}</span>
            <span className="book-title">{b.title}</span>
            <button
              className="book-del"
              onClick={(e) => {
                e.stopPropagation()
                window.api.store.removeBook(b.id).then(() => window.api.store.listBooks().then(setBooks))
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
