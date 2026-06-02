import { useTranslation } from 'react-i18next'
import { TocItem } from '../readers/types'

interface Props {
  items: TocItem[]
  onGo: (item: TocItem) => void
}

export function TocPanel({ items, onGo }: Props): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="panel">
      <div className="panel-head">{t('toc')}</div>
      {items.length === 0 && <div className="empty">—</div>}
      <ul className="toc-list">
        {items.map((it, i) => (
          <li
            key={i}
            style={{ paddingLeft: 8 + (it.level - 1) * 14 }}
            onClick={() => onGo(it)}
          >
            {it.label || '—'}
          </li>
        ))}
      </ul>
    </div>
  )
}
