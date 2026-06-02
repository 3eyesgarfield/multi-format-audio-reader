import { useTranslation } from 'react-i18next'

export interface HoverInfo {
  word: string
  phonetic?: string
  meaning: string
  lang: 'en' | 'zh'
  x: number
  y: number
}

interface Props {
  info: HoverInfo
  onAddVocab: () => void
  onClose: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function HoverDict({ info, onAddVocab, onClose, onMouseEnter, onMouseLeave }: Props): JSX.Element {
  const { t } = useTranslation()
  const left = Math.min(info.x + 14, window.innerWidth - 340)
  const top = Math.min(info.y + 16, window.innerHeight - 180)
  return (
    <div
      className="hover-dict"
      style={{ left, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="hd-head">
        <span className="hd-word">{info.word}</span>
        {info.phonetic && <span className="hd-ph">[{info.phonetic}]</span>}
      </div>
      <div className="hd-meaning">{info.meaning}</div>
      <div className="hd-actions">
        <button onClick={onAddVocab}>＋ {t('addVocab')}</button>
        <button onClick={onClose}>✕</button>
      </div>
    </div>
  )
}
