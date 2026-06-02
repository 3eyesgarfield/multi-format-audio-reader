import { useTranslation } from 'react-i18next'

export interface Highlight {
  id: string
  bookId: string
  locator: string
  text: string
  note?: string
  color?: string
  createdAt: number
}

interface Props {
  highlights: Highlight[]
  onGo: (h: Highlight) => void
  onDelete: (h: Highlight) => void
  onClear: () => void
}

export function NotesPanel({ highlights, onGo, onDelete, onClear }: Props): JSX.Element {
  const { t } = useTranslation()
  const sorted = [...highlights].sort((a, b) => b.createdAt - a.createdAt)

  function exportMd(): void {
    const lines = ['# 笔记 / Notes', '']
    const chrono = [...highlights].sort((a, b) => a.createdAt - b.createdAt)
    chrono.forEach((h, i) => {
      const text = h.text.replace(/\s+/g, ' ').trim()
      lines.push(`### ${i + 1}.`)
      lines.push(`> ${text}`)
      if (h.note) lines.push('', h.note.replace(/\s+/g, ' ').trim())
      lines.push('')
    })
    window.api.saveTextFile('notes.md', lines.join('\n'))
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{t('notes')}</span>
        {sorted.length > 0 && (
          <span className="head-actions">
            <button className="link-btn" onClick={exportMd}>
              {t('exportMd')}
            </button>
            <button className="link-btn" onClick={() => confirm(t('confirmClearAll')) && onClear()}>
              {t('clearAll')}
            </button>
          </span>
        )}
      </div>
      {sorted.length === 0 && <div className="empty">{t('noNotes')}</div>}
      <ul className="note-list">
        {sorted.map((h) => (
          <li key={h.id}>
            <span className={`note-dot ${h.color || 'yellow'}`} />
            <div className="note-body" onClick={() => onGo(h)}>
              <div className="note-text">{h.text.replace(/\s+/g, ' ').trim()}</div>
              {h.note && <div className="note-memo">{h.note}</div>}
            </div>
            <button className="note-del" title={t('stop')} onClick={() => onDelete(h)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
