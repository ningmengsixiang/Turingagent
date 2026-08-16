/** 语音输入封装：MediaRecorder 录音 + Web Speech API 转写（MVP，浏览器本地，零外部依赖）。
 *  转写失败/不支持 → 调用方走降级路径（录音文件上传，决策 D6）。 */

export interface SpeechSession {
  /** 开始录音 + 转写 */
  start(): void
  /** 停止录音；返回 Promise：成功 → { kind: 'transcript'; text }，失败/不支持 → { kind: 'audio'; blob; mime } */
  stop(): Promise<{ kind: 'transcript'; text: string } | { kind: 'audio'; blob: Blob; mime: string }>
  /** 是否支持录音（MediaRecorder + getUserMedia） */
  canRecord: boolean
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

const RECORD_MAX_MS = 60_000 // 60s 上限，防超 20MB

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

export function createSpeechSession(): SpeechSession | null {
  if (typeof window === 'undefined') return null
  const canRecord =
    typeof window.MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  if (!canRecord) return null

  const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
  const useTranscript = typeof SR !== 'undefined'

  let recorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let mime = 'audio/webm'
  let startGen = 0 // 代次计数：使未决 start 在 stop 后失效（防竞态麦克风泄漏）
  let inflight: Promise<{ kind: 'transcript'; text: string } | { kind: 'audio'; blob: Blob; mime: string }> | null = null

  function stopRecognition(rec: SpeechRecognitionLike): void {
    try {
      rec.stop()
    } catch {
      /* noop */
    }
  }

  function pickMime(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    return candidates.find((m) => window.MediaRecorder.isTypeSupported(m)) ?? ''
  }

  return {
    canRecord,
    start() {
      const gen = ++startGen
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          if (gen !== startGen) {
            // 录音已停止：释放刚获取的麦克风（竞态修复）
            stream.getTracks().forEach((t) => t.stop())
            return
          }
          chunks = []
          mime = pickMime()
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data)
          }
          recorder.start()
          setTimeout(() => {
            void this.stop()
          }, RECORD_MAX_MS)
        } catch {
          // 麦克风权限拒绝 / MIME 不支持：录音失败，stop() 走 audio 分支（空 blob → 上层 catch）
        }
      })()
    },
    stop() {
      if (inflight) return inflight
      startGen++ // 使未决 start 失效
      inflight = new Promise((resolve) => {
        const settle = (v: { kind: 'transcript'; text: string } | { kind: 'audio'; blob: Blob; mime: string }) => {
          if (inflight) inflight = null // 允许下一次 stop 新建
          resolve(v)
        }
        if (!recorder || recorder.state === 'inactive') {
          settle({ kind: 'audio', blob: new Blob([], { type: mime }), mime })
          return
        }
        const finish = () => {
          const blob = new Blob(chunks, { type: mime })
          recorder?.stream.getTracks().forEach((t) => t.stop())
          if (useTranscript && SR && blob.size > 0) {
            let rec: SpeechRecognitionLike
            try {
              rec = new SR()
            } catch {
              settle({ kind: 'audio', blob, mime })
              return
            }
            rec.lang = 'zh-CN'
            rec.interimResults = false
            rec.continuous = true
            let settled = false
            const fallbackAudio = () => {
              if (settled) return
              settled = true
              stopRecognition(rec)
              settle({ kind: 'audio', blob, mime })
            }
            rec.onresult = (e) => {
              if (settled) return
              let text = ''
              for (let i = 0; i < e.results.length; i++) {
                text += e.results[i][0]?.transcript ?? ''
              }
              text = text.trim()
              if (text) {
                settled = true
                stopRecognition(rec)
                settle({ kind: 'transcript', text })
              } else {
                fallbackAudio()
              }
            }
            rec.onerror = () => fallbackAudio()
            rec.onend = () => fallbackAudio()
            // 转写兜底：3s 无结果降级（P95<3s 约束）
            setTimeout(fallbackAudio, 3000)
            try {
              rec.start()
            } catch {
              fallbackAudio()
            }
          } else {
            settle({ kind: 'audio', blob, mime })
          }
        }
        recorder.onstop = () => finish()
        try {
          recorder.stop()
        } catch {
          finish()
        }
      })
      return inflight
    },
  }
}