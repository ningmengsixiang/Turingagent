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
  let stopResolve: ((v: { kind: 'transcript'; text: string } | { kind: 'audio'; blob: Blob; mime: string }) => void) | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null

  return {
    canRecord,
    start() {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          chunks = []
          mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
          recorder = new MediaRecorder(stream, { mimeType: mime })
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data)
          }
          recorder.start()
          maxTimer = setTimeout(() => {
            void this.stop()
          }, RECORD_MAX_MS)
        } catch {
          // 麦克风权限拒绝：录音失败，stop() 会走 audio 分支但 blob 为空 → 上层 catch
        }
      })()
    },
    stop() {
      return new Promise((resolve) => {
        stopResolve = resolve
        if (maxTimer) clearTimeout(maxTimer)
        if (!recorder || recorder.state === 'inactive') {
          resolve({ kind: 'audio', blob: new Blob([], { type: mime }), mime })
          return
        }
        const finish = () => {
          const blob = new Blob(chunks, { type: mime })
          recorder?.stream.getTracks().forEach((t) => t.stop())
          // 有转写支持且录音非空 → 尝试转写；否则降级 audio
          if (useTranscript && SR && blob.size > 0) {
            const rec = new SR()
            rec.lang = 'zh-CN'
            rec.interimResults = false
            rec.continuous = true
            rec.onresult = (e) => {
              let text = ''
              for (let i = 0; i < e.results.length; i++) {
                text += e.results[i][0]?.transcript ?? ''
              }
              text = text.trim()
              if (text) {
                try {
                  rec.stop()
                } catch {
                  /* noop */
                }
                stopResolve?.({ kind: 'transcript', text })
              } else {
                stopResolve?.({ kind: 'audio', blob, mime })
              }
            }
            rec.onerror = () => stopResolve?.({ kind: 'audio', blob, mime })
            rec.onend = () => {
              // 无结果结束时降级 audio（避免 Promise 悬挂）
              stopResolve?.({ kind: 'audio', blob, mime })
            }
            try {
              rec.start()
            } catch {
              stopResolve?.({ kind: 'audio', blob, mime })
            }
            // 转写兜底：3s 无结果降级（P95<3s 约束）
            setTimeout(() => stopResolve?.({ kind: 'audio', blob, mime }), 3000)
          } else {
            stopResolve?.({ kind: 'audio', blob, mime })
          }
        }
        recorder.onstop = () => finish()
        try {
          recorder.stop()
        } catch {
          finish()
        }
      })
    },
  }
}
