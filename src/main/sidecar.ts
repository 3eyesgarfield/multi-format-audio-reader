import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { store } from './store'

export const TTS_PORT = 8756
export const TTS_BASE = `http://127.0.0.1:${TTS_PORT}`

let proc: ChildProcess | null = null

/** Locate backend dir + python interpreter for dev and packaged builds. */
function resolvePaths(): { backendDir: string; python: string } {
  const devBackend = join(app.getAppPath(), 'backend')
  const prodBackend = join(process.resourcesPath, 'backend')
  const backendDir = existsSync(devBackend) ? devBackend : prodBackend
  const venvPy = join(backendDir, '.venv', 'Scripts', 'python.exe')
  const python = existsSync(venvPy) ? venvPy : 'python'
  return { backendDir, python }
}

export function startSidecar(): void {
  if (proc) return
  const { backendDir, python } = resolvePaths()
  // honour the "enable Kokoro" setting: when off, tell the sidecar to skip
  // loading kokoro/torch entirely (faster startup, lower memory)
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' }
  if (store.getSettings().enableKokoro === false) env.READER_DISABLE_KOKORO = '1'
  proc = spawn(python, ['server.py', '--port', String(TTS_PORT)], {
    cwd: backendDir,
    env,
    windowsHide: true
  })
  proc.stdout?.on('data', (d) => console.log('[tts]', d.toString().trim()))
  proc.stderr?.on('data', (d) => console.log('[tts]', d.toString().trim()))
  proc.on('exit', (code) => {
    console.log('[tts] exited', code)
    proc = null
  })
}

export function stopSidecar(): void {
  if (proc) {
    proc.kill()
    proc = null
  }
}

/** Poll /health until the sidecar answers (or time out). */
export async function waitForSidecar(timeoutMs = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${TTS_BASE}/health`)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
