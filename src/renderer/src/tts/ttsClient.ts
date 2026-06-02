/** Thin client for the Python TTS sidecar. */

export interface VoiceInfo {
  id: string
  engine: string
  name: string
  lang: string
  gender: string
}

let base = 'http://127.0.0.1:8756'

export async function initTtsBase(): Promise<void> {
  try {
    base = await window.api.ttsBase()
  } catch {
    /* keep default */
  }
}

export function ttsBase(): string {
  return base
}

export interface HealthInfo {
  status: string
  engines: Record<string, boolean>
  ocr: boolean
  gpu: boolean
}

export async function getHealth(): Promise<HealthInfo | null> {
  try {
    const r = await fetch(`${base}/health`)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export async function getVoices(): Promise<VoiceInfo[]> {
  try {
    const r = await fetch(`${base}/voices`)
    if (!r.ok) return []
    const j = await r.json()
    return j.voices ?? []
  } catch {
    return []
  }
}

export interface SynthParams {
  text: string
  engine: string
  voice: string
  rate?: number
  pitch?: number
}

/** Returns decoded audio as an ArrayBuffer (wav or mp3). */
export async function synthesize(p: SynthParams, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(`${base}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate: 1.0, pitch: 0, ...p }),
    signal
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(err.error || 'synthesis failed')
  }
  return r.arrayBuffer()
}

export async function ocrImage(png: Blob): Promise<string> {
  const r = await fetch(`${base}/ocr`, { method: 'POST', body: png })
  if (!r.ok) throw new Error('ocr failed')
  const j = await r.json()
  return j.text ?? ''
}

export interface ExportSegment {
  text: string
  engine: string
  voice: string
  rate: number
}

/** Streams export progress via SSE; calls onProgress with {done,total,path?}. */
export async function exportAudio(
  segments: ExportSegment[],
  outPath: string,
  format: string,
  onProgress: (p: { done: number; total: number; path?: string }) => void
): Promise<void> {
  const r = await fetch(`${base}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segments, out_path: outPath, format })
  })
  if (!r.body) throw new Error('no stream')
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const m = line.match(/^data: (.+)$/m)
      if (m) onProgress(JSON.parse(m[1]))
    }
  }
}
