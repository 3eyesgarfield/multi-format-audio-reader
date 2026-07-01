import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useStore } from '../store'

interface Props {
  onExport: () => void
}

export function SettingsPanel({ onExport }: Props): JSX.Element {
  const { t } = useTranslation()
  const { voices, tts, setTts, theme, setTheme, health, sleepMinutes, setSleep, resetSettings, dictZhToEn, setDictZhToEn, showCaption, setShowCaption, viewMode, pdfPageGap, setPdfPageGap, enableKokoro, setEnableKokoro, lookupMode, setLookupMode, book, pdfCropTop, setPdfCropTop, pdfCropBottom, setPdfCropBottom } =
    useStore()

  const zhVoices = voices.filter((v) => v.lang === 'zh')
  const enVoices = voices.filter((v) => v.lang === 'en')

  const VoiceSelect = ({
    value,
    onChange,
    list
  }: {
    value: string
    onChange: (v: string) => void
    list: typeof voices
  }): JSX.Element => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((v) => (
        <option key={v.id} value={v.id}>
          [{v.engine}] {v.name}
        </option>
      ))}
    </select>
  )

  return (
    <div className="panel settings">
      <div className="panel-head">{t('settings')}</div>

      <div className="set-group">
        <label>
          <input
            type="checkbox"
            checked={tts.autoSwitch}
            onChange={(e) => setTts({ autoSwitch: e.target.checked })}
          />
          {t('autoSwitch')}
        </label>
      </div>

      {tts.autoSwitch ? (
        <>
          <div className="set-group">
            <span>{t('voiceZh')}</span>
            <VoiceSelect value={tts.voiceZh} onChange={(v) => setTts({ voiceZh: v })} list={zhVoices} />
          </div>
          <div className="set-group">
            <span>{t('voiceEn')}</span>
            <VoiceSelect value={tts.voiceEn} onChange={(v) => setTts({ voiceEn: v })} list={enVoices} />
          </div>
        </>
      ) : (
        <div className="set-group">
          <span>{t('voiceSingle')}</span>
          <VoiceSelect value={tts.voiceSingle} onChange={(v) => setTts({ voiceSingle: v })} list={voices} />
        </div>
      )}

      <div className="set-group">
        <span>
          {t('speedZh')}: {tts.speedZh.toFixed(2)}×
        </span>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.05}
          value={tts.speedZh}
          onChange={(e) => setTts({ speedZh: Number(e.target.value) })}
        />
      </div>

      <div className="set-group">
        <span>
          {t('speedEn')}: {tts.speedEn.toFixed(2)}×
        </span>
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.05}
          value={tts.speedEn}
          onChange={(e) => setTts({ speedEn: Number(e.target.value) })}
        />
      </div>

      <div className="set-group">
        <span>
          {t('pitch')}: {tts.pitch}
        </span>
        <input
          type="range"
          min={-10}
          max={10}
          step={1}
          value={tts.pitch}
          onChange={(e) => setTts({ pitch: Number(e.target.value) })}
        />
      </div>

      <div className="set-group">
        <span>
          {t('commaPause')}: {tts.commaPause}
        </span>
        <input
          type="range"
          min={0}
          max={600}
          step={10}
          value={tts.commaPause}
          onChange={(e) => setTts({ commaPause: Number(e.target.value) })}
        />
      </div>

      <div className="set-group">
        <span>
          {t('gap')}: {tts.gapMs}
        </span>
        <input
          type="range"
          min={0}
          max={1000}
          step={50}
          value={tts.gapMs}
          onChange={(e) => setTts({ gapMs: Number(e.target.value) })}
        />
      </div>

      <hr />

      <div className="set-group">
        <label>
          <input
            type="checkbox"
            checked={showCaption}
            onChange={(e) => setShowCaption(e.target.checked)}
          />
          {t('showCaption')}
        </label>
      </div>

      <div className="set-group">
        <span>{t('theme')}</span>
        <button onClick={() => setTheme({ dark: !theme.dark })}>
          {theme.dark ? t('dark') : t('light')}
        </button>
      </div>
      <div className="set-group">
        <span>
          {t('fontSize')}: {theme.fontSize}px
        </span>
        <input
          type="range"
          min={14}
          max={30}
          step={1}
          value={theme.fontSize}
          onChange={(e) => setTheme({ fontSize: Number(e.target.value) })}
        />
      </div>
      <div className="set-group">
        <span>
          {t('lineHeight')}: {theme.lineHeight.toFixed(1)}
        </span>
        <input
          type="range"
          min={1.2}
          max={2.6}
          step={0.1}
          value={theme.lineHeight}
          onChange={(e) => setTheme({ lineHeight: Number(e.target.value) })}
        />
      </div>

      {book?.format === 'pdf' && (
        <>
          <div className="set-group">
            <span>
              {t('cropTop')}: {Math.round(pdfCropTop * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.005}
              value={pdfCropTop}
              onChange={(e) => setPdfCropTop(Number(e.target.value))}
            />
          </div>
          <div className="set-group">
            <span>
              {t('cropBottom')}: {Math.round(pdfCropBottom * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={0.2}
              step={0.005}
              value={pdfCropBottom}
              onChange={(e) => setPdfCropBottom(Number(e.target.value))}
            />
          </div>
        </>
      )}

      {viewMode === 'double' && (
        <div className="set-group">
          <span>
            {t('pageGap')}: {pdfPageGap}px
          </span>
          <input
            type="range"
            min={-100}
            max={120}
            step={2}
            value={pdfPageGap}
            onChange={(e) => setPdfPageGap(Number(e.target.value))}
          />
        </div>
      )}

      <hr />

      <div className="set-group">
        <span>{t('lookupMode')}</span>
        <button onClick={() => setLookupMode(lookupMode === 'hover' ? 'click' : 'hover')}>
          {lookupMode === 'hover' ? t('lookupHover') : t('lookupClick')}
        </button>
      </div>

      <div className="set-group">
        <label>
          <input
            type="checkbox"
            checked={dictZhToEn}
            onChange={(e) => setDictZhToEn(e.target.checked)}
          />
          {t('dictZhToEn')}
        </label>
      </div>

      <div className="set-group">
        <span>{t('sleepTimer')}</span>
        <select
          value={sleepMinutes ?? 0}
          onChange={(e) => setSleep(Number(e.target.value) || null)}
        >
          <option value={0}>{t('off')}</option>
          {[5, 10, 15, 30, 45, 60].map((m) => (
            <option key={m} value={m}>
              {m} {t('minutes')}
            </option>
          ))}
        </select>
      </div>

      <div className="set-group">
        <button className="btn-primary" onClick={onExport}>
          🎧 {t('exportAudio')}
        </button>
      </div>

      <hr />

      <div className="set-group">
        <label>
          <input
            type="checkbox"
            checked={enableKokoro}
            onChange={(e) => setEnableKokoro(e.target.checked)}
          />
          {t('enableKokoro')}
        </label>
        <span style={{ fontSize: 11, opacity: 0.7 }}>{t('enableKokoroHint')}</span>
      </div>

      <div className="set-group">
        <span>{t('engineStatus')}</span>
        <div className="engine-status">
          {health &&
            Object.entries(health.engines).map(([k, v]) => (
              <span key={k} className={v ? 'on' : 'off'}>
                {k}
              </span>
            ))}
          {health?.gpu && <span className="on">{t('gpu')}</span>}
        </div>
      </div>

      <div className="set-group">
        <span>Language / 语言</span>
        <button onClick={() => i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')}>
          {i18n.language === 'zh' ? '中 / EN' : 'EN / 中'}
        </button>
      </div>

      <hr />

      <div className="set-group">
        <button
          onClick={() => {
            if (confirm(t('confirmReset'))) resetSettings()
          }}
        >
          ↺ {t('resetSettings')}
        </button>
      </div>
    </div>
  )
}
