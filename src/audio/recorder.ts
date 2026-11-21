// Microphone recording: MediaRecorder where it works, raw PCM → WAV as a fallback (iOS PWA quirks).
export interface Recording { blob: Blob; mime: string; seconds: number }
export interface ActiveRecording { stop: () => Promise<Recording>; cancel: () => void }

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/aac'].find(m => MediaRecorder.isTypeSupported?.(m))
}

export async function startRecording(): Promise<ActiveRecording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not available in this browser.')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const release = () => stream.getTracks().forEach(t => t.stop()) // drops the iOS mic indicator
  const t0 = performance.now()
  const mime = pickMime()
  if (mime) {
    try {
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: Blob[] = []
      rec.ondataavailable = e => e.data.size && chunks.push(e.data)
      rec.start()
      return {
        stop: () => new Promise((res, rej) => {
          rec.onstop = () => { release(); res({ blob: new Blob(chunks, { type: mime }), mime, seconds: (performance.now() - t0) / 1000 }) }
          rec.onerror = () => { release(); rej(new Error('Recording failed')) }
          rec.stop()
        }),
        cancel: () => { try { rec.stop() } catch { /* already stopped */ } release() },
      }
    } catch { /* fall through to WAV */ }
  }
  return startWav(stream, release, t0)
}

function startWav(stream: MediaStream, release: () => void, t0: number): ActiveRecording {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext
  const ctx: AudioContext = new AC()
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  const bufs: Float32Array[] = []
  proc.onaudioprocess = e => bufs.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  src.connect(proc); proc.connect(ctx.destination)
  const finish = () => { proc.disconnect(); src.disconnect(); release(); ctx.close() }
  return {
    stop: async () => {
      finish()
      const blob = encodeWav(bufs, ctx.sampleRate)
      return { blob, mime: 'audio/wav', seconds: (performance.now() - t0) / 1000 }
    },
    cancel: finish,
  }
}

export function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const n = chunks.reduce((s, c) => s + c.length, 0)
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, n * 2, true)
  let o = 44
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true)
  return new Blob([buf], { type: 'audio/wav' })
}

export function playBlob(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
  const a = new Audio(url)
  return new Promise(res => {
    const done = () => { URL.revokeObjectURL(url); res() }
    a.onended = done; a.onerror = done
    a.play().catch(done)
  })
}
