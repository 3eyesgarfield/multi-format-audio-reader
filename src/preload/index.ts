import { contextBridge, ipcRenderer } from 'electron'

const api = {
  ttsBase: (): Promise<string> => ipcRenderer.invoke('tts:base'),

  openBookDialog: () => ipcRenderer.invoke('dialog:openBook'),
  bookMeta: (path: string) => ipcRenderer.invoke('book:meta', path),
  readFile: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('file:read', path),
  saveAudioDialog: (name: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveAudio', name),
  saveTextFile: (name: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('file:saveText', name, content),

  store: {
    listBooks: () => ipcRenderer.invoke('store:listBooks'),
    upsertBook: (b: unknown) => ipcRenderer.invoke('store:upsertBook', b),
    setProgress: (id: string, p: unknown) => ipcRenderer.invoke('store:setProgress', id, p),
    removeBook: (id: string) => ipcRenderer.invoke('store:removeBook', id),
    clearBooks: () => ipcRenderer.invoke('store:clearBooks'),
    getHighlights: (id: string) => ipcRenderer.invoke('store:getHighlights', id),
    addHighlight: (h: unknown) => ipcRenderer.invoke('store:addHighlight', h),
    removeHighlight: (id: string) => ipcRenderer.invoke('store:removeHighlight', id),
    clearHighlights: (bookId: string) => ipcRenderer.invoke('store:clearHighlights', bookId),
    getVocab: () => ipcRenderer.invoke('store:getVocab'),
    addVocab: (v: unknown) => ipcRenderer.invoke('store:addVocab', v),
    removeVocab: (w: string, l: string) => ipcRenderer.invoke('store:removeVocab', w, l),
    clearVocab: () => ipcRenderer.invoke('store:clearVocab'),
    getSettings: () => ipcRenderer.invoke('store:getSettings'),
    setSettings: (s: unknown) => ipcRenderer.invoke('store:setSettings', s)
  },

  dict: {
    lookup: (w: string) => ipcRenderer.invoke('dict:lookup', w),
    lookupEn: (w: string) => ipcRenderer.invoke('dict:lookupEn', w),
    available: () => ipcRenderer.invoke('dict:available')
  },

  onMediaKey: (cb: (action: string) => void) =>
    ipcRenderer.on('media:key', (_e, action) => cb(action)),
  onTtsReady: (cb: (ok: boolean) => void) =>
    ipcRenderer.on('tts:ready', (_e, ok) => cb(ok)),
  onOpenPath: (cb: (meta: unknown) => void) =>
    ipcRenderer.on('book:openPath', (_e, meta) => cb(meta))
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
