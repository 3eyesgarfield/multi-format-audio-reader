import { app, BrowserWindow, ipcMain, dialog, globalShortcut } from 'electron'
import { join, extname, basename } from 'path'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { startSidecar, stopSidecar, waitForSidecar, TTS_BASE } from './sidecar'
import { store, BookRecord } from './store'
import { lookup, dictionaryAvailable, lookupEnglish, preloadEcdict } from './dictionary'

let win: BrowserWindow | null = null
let pendingOpenPath: string | null = null

const FORMATS: Record<string, BookRecord['format']> = {
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.md': 'md',
  '.markdown': 'md'
}

function detectFormat(p: string): BookRecord['format'] | null {
  return FORMATS[extname(p).toLowerCase()] ?? null
}

function bookIdFor(p: string): string {
  return createHash('sha1').update(p).digest('hex').slice(0, 16)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    title: 'Polyglot Reader',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // forward renderer console + crashes to the main stdout for debugging
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer] gone:', details.reason)
  })

  win.on('closed', () => (win = null))
}

function registerMediaKeys(): void {
  const send = (action: string) => () => win?.webContents.send('media:key', action)
  globalShortcut.register('MediaPlayPause', send('playpause'))
  globalShortcut.register('MediaNextTrack', send('next'))
  globalShortcut.register('MediaPreviousTrack', send('prev'))
}

function registerIpc(): void {
  ipcMain.handle('tts:base', () => TTS_BASE)

  ipcMain.handle('dialog:openBook', async () => {
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'epub', 'md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return openBookMeta(res.filePaths[0])
  })

  ipcMain.handle('book:meta', (_e, path: string) => openBookMeta(path))

  ipcMain.handle('file:read', (_e, path: string) => {
    const buf = readFileSync(path)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // ---- store ----
  ipcMain.handle('store:listBooks', () => store.listBooks())
  ipcMain.handle('store:upsertBook', (_e, b: BookRecord) => store.upsertBook(b))
  ipcMain.handle('store:setProgress', (_e, id: string, p: unknown) => store.setProgress(id, p))
  ipcMain.handle('store:removeBook', (_e, id: string) => store.removeBook(id))
  ipcMain.handle('store:clearBooks', () => store.clearBooks())
  ipcMain.handle('store:getHighlights', (_e, id: string) => store.getHighlights(id))
  ipcMain.handle('store:addHighlight', (_e, h) => store.addHighlight(h))
  ipcMain.handle('store:removeHighlight', (_e, id: string) => store.removeHighlight(id))
  ipcMain.handle('store:clearHighlights', (_e, bookId: string) => store.clearHighlights(bookId))
  ipcMain.handle('store:getVocab', () => store.getVocab())
  ipcMain.handle('store:addVocab', (_e, v) => store.addVocab(v))
  ipcMain.handle('store:removeVocab', (_e, w: string, l: string) => store.removeVocab(w, l))
  ipcMain.handle('store:clearVocab', () => store.clearVocab())
  ipcMain.handle('store:getSettings', () => store.getSettings())
  ipcMain.handle('store:setSettings', (_e, s) => store.setSettings(s))

  // ---- dictionary ----
  ipcMain.handle('dict:lookup', (_e, w: string) => lookup(w))
  ipcMain.handle('dict:lookupEn', (_e, w: string) => lookupEnglish(w))
  ipcMain.handle('dict:available', () => dictionaryAvailable())

  // ---- save a text/markdown file ----
  ipcMain.handle('file:saveText', async (_e, defaultName: string, content: string) => {
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    })
    if (res.canceled || !res.filePath) return null
    const fs = await import('fs')
    fs.writeFileSync(res.filePath, content, 'utf-8')
    return res.filePath
  })

  // ---- save dialog (audiobook export target) ----
  ipcMain.handle('dialog:saveAudio', async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [
        { name: 'MP3 Audio', extensions: ['mp3'] },
        { name: 'WAV Audio', extensions: ['wav'] }
      ]
    })
    return res.canceled ? null : res.filePath
  })
}

function openBookMeta(path: string): (BookRecord & { error?: string }) | null {
  const format = detectFormat(path)
  if (!format)
    return {
      id: '',
      path,
      title: basename(path),
      format: 'md',
      addedAt: 0,
      lastOpenedAt: 0,
      error: 'unsupported'
    }
  const id = bookIdFor(path)
  const existing = store.listBooks().find((b) => b.id === id)
  const rec: BookRecord = {
    id,
    path,
    title: existing?.title ?? basename(path),
    format,
    addedAt: existing?.addedAt ?? Date.now(),
    lastOpenedAt: Date.now(),
    progress: existing?.progress,
    cover: existing?.cover
  }
  store.upsertBook(rec)
  return rec
}

app.whenReady().then(async () => {
  // a file passed via association / argv
  const fileArg = process.argv.find((a) => detectFormat(a))
  if (fileArg) pendingOpenPath = fileArg

  startSidecar()
  registerIpc()
  preloadEcdict() // load the big English->Chinese dict in the background
  createWindow()
  registerMediaKeys()
  waitForSidecar().then((ok) => win?.webContents.send('tts:ready', ok))

  let didAutoOpen = false
  win?.webContents.on('did-finish-load', () => {
    if (didAutoOpen) return
    didAutoOpen = true
    if (pendingOpenPath) {
      win?.webContents.send('book:openPath', openBookMeta(pendingOpenPath))
      pendingOpenPath = null
    } else {
      // resume the last-read book at its saved position
      const recent = store.listBooks()[0]
      if (recent && existsSync(recent.path)) {
        win?.webContents.send('book:openPath', openBookMeta(recent.path))
      }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopSidecar()
})
