import { create } from 'zustand'
import { TtsSettings, PlayState } from './tts/player'
import { VoiceInfo } from './tts/ttsClient'

export interface BookMeta {
  id: string
  path: string
  title: string
  format: 'pdf' | 'epub' | 'md'
  progress?: unknown
}

export interface ReaderTheme {
  dark: boolean
  fontSize: number // px
  fontFamily: string
  lineHeight: number
}

export type ViewMode = 'scroll' | 'single' | 'double'

interface AppState {
  // tts
  voices: VoiceInfo[]
  health: { engines: Record<string, boolean>; ocr: boolean; gpu: boolean } | null
  tts: TtsSettings
  playState: PlayState
  activeSentence: string | null
  // reading
  book: BookMeta | null
  theme: ReaderTheme
  viewMode: ViewMode
  pdfPageGap: number // px gap between the two pages in double-page mode
  // ui
  panel: 'library' | 'toc' | 'search' | 'settings' | 'notes' | 'vocab' | null
  sleepMinutes: number | null
  dictZhToEn: boolean // also look up Chinese words on hover (中->英)
  showCaption: boolean // show the bottom "now reading" caption bar
  enableKokoro: boolean // load the Kokoro neural engine (off = don't load torch)
  vocabVersion: number // bumped when vocab changes so open panels refresh

  setVoices: (v: VoiceInfo[]) => void
  setHealth: (h: AppState['health']) => void
  setTts: (patch: Partial<TtsSettings>) => void
  setPlayState: (s: PlayState) => void
  setActive: (id: string | null) => void
  setBook: (b: BookMeta | null) => void
  setTheme: (patch: Partial<ReaderTheme>) => void
  setViewMode: (m: ViewMode) => void
  setPdfPageGap: (g: number) => void
  setPanel: (p: AppState['panel']) => void
  setSleep: (m: number | null) => void
  setDictZhToEn: (v: boolean) => void
  setShowCaption: (v: boolean) => void
  setEnableKokoro: (v: boolean) => void
  bumpVocab: () => void
  resetSettings: () => void
}

const defaultTts: TtsSettings = {
  speedZh: 1.0,
  speedEn: 1.0,
  pitch: 0,
  autoSwitch: true,
  voiceZh: 'sapi:Microsoft Huihui Desktop',
  voiceEn: 'edge:en-US-AriaNeural',
  voiceSingle: 'sapi:Microsoft Huihui Desktop',
  gapMs: 150,
  commaPause: 10
}

const defaultTheme: ReaderTheme = {
  dark: true,
  fontSize: 19,
  fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
  lineHeight: 1.8
}

export const useStore = create<AppState>((set) => ({
  voices: [],
  health: null,
  tts: defaultTts,
  playState: 'stopped',
  activeSentence: null,
  book: null,
  theme: defaultTheme,
  viewMode: 'scroll',
  pdfPageGap: 16,
  panel: 'library',
  sleepMinutes: null,
  dictZhToEn: false,
  showCaption: false,
  enableKokoro: true,
  vocabVersion: 0,

  setVoices: (voices) => set({ voices }),
  setHealth: (health) => set({ health }),
  setTts: (patch) => set((s) => ({ tts: { ...s.tts, ...patch } })),
  setPlayState: (playState) => set({ playState }),
  setActive: (activeSentence) => set({ activeSentence }),
  setBook: (book) => set({ book }),
  setTheme: (patch) => set((s) => ({ theme: { ...s.theme, ...patch } })),
  setViewMode: (viewMode) => set({ viewMode }),
  setPdfPageGap: (pdfPageGap) => set({ pdfPageGap }),
  setPanel: (panel) => set({ panel }),
  setSleep: (sleepMinutes) => set({ sleepMinutes }),
  setDictZhToEn: (dictZhToEn) => set({ dictZhToEn }),
  setShowCaption: (showCaption) => set({ showCaption }),
  setEnableKokoro: (enableKokoro) => set({ enableKokoro }),
  bumpVocab: () => set((st) => ({ vocabVersion: st.vocabVersion + 1 })),
  resetSettings: () =>
    set({
      tts: { ...defaultTts },
      theme: { ...defaultTheme },
      viewMode: 'scroll',
      pdfPageGap: 16,
      sleepMinutes: null,
      showCaption: false
    })
}))
