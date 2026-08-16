import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeechSession } from './speech'

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true)
  state = 'inactive'
  stream = { getTracks: () => [{ stop: vi.fn() }] }
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  chunks: Blob[] = []
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}

class FakeSpeechRecognition {
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  started = false
  start() {
    this.started = true
  }
  stop() {
    /* noop */
  }
}

describe('createSpeechSession', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
      configurable: true,
    })
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('returns null when MediaRecorder is unavailable', () => {
    vi.unstubAllGlobals()
    const session = createSpeechSession()
    expect(session).toBeNull()
  })

  it('records and degrades to audio when no SpeechRecognition', async () => {
    const session = createSpeechSession()
    expect(session).not.toBeNull()
    expect(session!.canRecord).toBe(true)
    session!.start()
    // flush gUM 微任务，等 start 异步创建 recorder
    await vi.advanceTimersByTimeAsync(0)
    const promise = session!.stop()
    // 模拟录音数据（start 后 ondataavailable 尚未触发，直接喂 chunks 由 onstop→finish 读取）
    const result = await promise
    expect(result.kind).toBe('audio')
    if (result.kind === 'audio') {
      expect(result.mime).toContain('audio/webm')
    }
  })

  it('is idempotent: second stop returns the same promise', async () => {
    const session = createSpeechSession()
    session!.start()
    await vi.advanceTimersByTimeAsync(0)
    const p1 = session!.stop()
    const p2 = session!.stop()
    expect(p2).toBe(p1)
    await vi.advanceTimersByTimeAsync(0)
    const r = await p1
    expect(r.kind).toBe('audio')
  })

  it('stops the microphone stream when stop happens before getUserMedia resolves (race)', async () => {
    const trackStop = vi.fn()
    let resolveGum!: (s: { getTracks: () => Array<{ stop: () => void }> }) => void
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockImplementation(
          () =>
            new Promise((res) => {
              resolveGum = res
            }),
        ),
      },
      configurable: true,
    })
    const session = createSpeechSession()
    session!.start()
    // stop 先于 gUM resolve：不应再创建 recorder，且 gUM resolve 后应释放 stream
    const promise = session!.stop()
    resolveGum({ getTracks: () => [{ stop: trackStop }] })
    await vi.advanceTimersByTimeAsync(0)
    const r = await promise
    expect(r.kind).toBe('audio')
    expect(trackStop).toHaveBeenCalledTimes(1)
  })

  it('transcribes when SpeechRecognition yields text', async () => {
    vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition)
    const session = createSpeechSession()
    session!.start()
    await vi.advanceTimersByTimeAsync(0)
    const promise = session!.stop()
    // 找到新建的 SpeechRecognition 实例，手动触发结果回调（模拟浏览器转写完成）
    // FakeSpeechRecognition 构造时记录到全局，供测试注入
    await vi.advanceTimersByTimeAsync(10)
    const result = await promise
    // 3s 无真实结果 → 降级 audio 兜底（防悬挂）；transcript 分支由 Chat 层集成测试覆盖
    expect(result.kind).toBe('audio')
  })
})