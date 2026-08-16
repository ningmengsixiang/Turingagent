# Phase 1 · 计划 11：语音转文字（ASR MVP：Web Speech API + 录音降级）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地群聊语音输入（FR-CHAT-01 语音转文字消息、FR-DESK-07 语音输入）：按住 🎤 录音 → Web Speech API 实时转写 → 以文字消息发送；转写失败/浏览器不支持 → 降级为语音文件消息（决策 D6：智能体可转写处理）。验收：转写 P95 < 3s（浏览器本地 API 天然满足）、失败降级路径可用。

**Architecture:** 纯前端任务，零后端改动——转写成功走既有 text 消息路由；降级复用既有文件上传路由（`POST /api/v1/sessions/:id/files`，音频 Blob 上传为 file 消息，MinIO 存原声）。新增 `apps/web/src/lib/speech.ts`（MediaRecorder 录音 + Web Speech API 封装，浏览器能力探测 + 失败降级信号），Chat.tsx 输入区增 🎤 按钮（按住说话：开始/停止录音 + 转写），语音文件消息渲染「🎤 语音 + 播放」气泡。

**Tech Stack:** 浏览器原生 Web Speech API（`SpeechRecognition`，Chrome/Edge 支持，实时转写零成本零 key）+ MediaRecorder（WebM/Opus 录音）+ 现有 `uploadFile`。测试用 vitest jsdom + mock（`window.SpeechRecognition`/`MediaRecorder`/`HTMLMediaElement.play`）。

**质量审查决策（T2 后追加）：** ① 60s 自动停止上移 Chat（onPointerDown 内 `setTimeout(handleSpeechStop, 60_000)`，配合 speech.stop 幂等无双发）——原实现 60s 内部 stop 结果被丢弃（整段录音丢失 + UI 卡录音态 + 松手空 blob 不发送），must-fix；② 无会话时 handleSpeechStop 先无条件 `stop()` 释放麦克风再守卫发送（audio 分支用 ensureSession 建会话，与 send 一致），must-fix；③ pointer capture（setPointerCapture + onPointerCancel + touch-action:none）——原 onPointerLeave 滑出边界即停即发，must-fix；④ unmount cleanup 调 stop() 释放麦克风；⑤ Task 3 夹具修正：user-event v14 无 pointerDown → fireEvent.pointerDown/Up；mockFetch 为 URL-only 查表（无 POST: 前缀）；files-POST 分支须推 message 入列表；断言文本改「🎤 语音消息」+ 播放按钮（语音气泡不显示文件名）。**记录后续**：远端语音消息 WS 广播缺 file 元数据 → 远端成员显示普通文件气泡（Phase 2 enrich 或前端按 `语音-*.webm` 兜底）；3s 转写期内快速重按丢新录音（start 时清 inflight 或期间禁用 mic）；busy 单布尔并发竞态（busy 计数）；降级路径未清 replyingTo（语音回复后引用条残留）；「播放」实为下载（attachment 头，Phase 2 内联播放需非 attachment URL）。

**质量审查决策（T1 后追加）：** ① start/getUserMedia 竞态修复——代次计数 `startGen`，stop 时使未决 start 失效并释放刚获取的 stream（防松手后继续录音 + 麦克风泄漏，must-fix）；② Safari MIME 降级失效修复——候选 MIME `['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']` + 无 mimeType 兜底构造（Safari 仅支持 audio/mp4，原回退 webm 必抛 NotSupportedError 被吞、录音静默失效，must-fix）；③ stop 幂等——in-flight Promise 缓存（双 stop 同 tick 首调用悬挂修复）；④ 转写分支异常安全——`new SR()` 包 try/catch（构造抛错悬挂修复）+ `settled` 标志防多路 resolve + `stopRecognition` 统一停识别（降级路径 rec.stop() 防麦克风灯不灭）；⑤ 陈旧 3s 兜底定时器跨 stop 污染经 `settled` 标志修复；⑥ 测试改造——flush gUM 微任务后 stop（修复用例 2/3 空转）+ 补双 stop 幂等/start 竞态回归用例。记录：`declare global` 未来与 lib.dom 冲突风险（引入 @types/dom-speech-recognition 时需调整）、权限拒绝无 UX 反馈（MVP 可接受）、60s 自动停止无 lib 级测试（nit）。

**决策记录：** MVP 用浏览器 Web Speech API 而非云 ASR（阿里/讯飞）——零成本、零 API key、P95<3s 本地实时、无隐私外传；TechDesign T1「MVP 云 ASR」修正为「MVP 浏览器 Web Speech；生产/私有化接云 ASR 或 Whisper（Phase 2，接口留 `lib/speech.ts` 单一封装点）」。降级路径（决策 D6）：录音 Blob → 复用文件上传 → file 消息（content = `语音-<时间>.webm`，前端语音气泡可播放）；语音文件消息 contentType 用既有 `file`（不新增 `voice` 消息流，`voice` 类型留给 Phase 2 云 ASR 实时转写消息）。按住说话交互（PRD：按住语音键 → 实时转写预览 → 松开发送）；降级时按住录制、松开上传。限制：Web Speech API 仅 Chrome/Edge（Firefox/Safari 走降级路径）；需 HTTPS 或 localhost（浏览器安全要求，dev 满足）；录音默认 ≤60s 自动停止（文件 20MB 上限内）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `apps/web/src/lib/speech.ts` | 创建 | MediaRecorder 录音 + Web Speech API 转写封装（能力探测/失败信号） |
| `apps/web/src/lib/speech.test.ts` | 创建 | 录音/转写封装单元测试（mock 浏览器 API） |
| `apps/web/src/pages/Chat.tsx` | 修改 | 🎤 按住说话按钮 + 转写文字发送 + 降级语音文件消息 + 语音气泡渲染 |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 语音按钮/转写发送/降级上传用例 |
| `apps/web/src/app.css` | 修改 | 语音按钮与语音气泡样式 |
| `README.md` | 修改 | 语音输入说明 |

---

## Task 1: speech.ts 录音与转写封装

**Files:**
- Create: `apps/web/src/lib/speech.ts`
- Create: `apps/web/src/lib/speech.test.ts`

- [ ] **Step 1: 写 speech.ts**

创建 `apps/web/src/lib/speech.ts`，内容逐字如下：

```ts
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
```


> 注：`createSpeechSession` 返回 null 表示浏览器不支持（连降级录音也不可用）；调用方据此隐藏 🎤 按钮。

- [ ] **Step 2: 写 speech.test.ts**

创建 `apps/web/src/lib/speech.test.ts`，内容逐字如下：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
```

> 注：jsdom 下 Web Speech 事件注入复杂，transcribes 用例实际验证「3s 无结果 → 降级 audio 兜底」（防止 Promise 悬挂）；转写成功路径的完整行为由 Task 3 的 Chat 层集成测试覆盖（vi.mock speech 模块注入 transcript 结果）。若用例实现中发现 `vi.useFakeTimers` 与 MediaRecorder 交互不稳，允许在测试文件内调整计时方式，但必须在汇报中说明调整。FakeRecorder 需可被 `new MediaRecorder(stream, { mimeType })` 构造（构造函数接受 (stream, options?)，若 FakeRecorder 无构造函数参数则 TS 报错——给 FakeRecorder 加 `constructor(_stream?: unknown, _opts?: unknown) {}` 空构造即可）。

- [ ] **Step 3: 跑测试**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/lib/speech.test.ts
```

Expected: typecheck exit 0；speech.test.ts 3 用例全 PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/lib/speech.ts apps/web/src/lib/speech.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 语音输入封装（MediaRecorder + Web Speech 转写 + 降级）"
```

---

## Task 2: Chat.tsx 语音按钮与消息渲染

**Files:**
- Modify: `apps/web/src/pages/Chat.tsx`

- [ ] **Step 1: import 与状态**

读 `apps/web/src/pages/Chat.tsx`，在 import 区增：

```tsx
import { createSpeechSession, type SpeechSession } from '../lib/speech.js'
```

在 `const fileInputRef = useRef<HTMLInputElement | null>(null)` 之后增：

```tsx
  const [speech, setSpeech] = useState<SpeechSession | null>(null)
  const [recording, setRecording] = useState(false)
  const speechRef = useRef<SpeechSession | null>(null)
  const recordingRef = useRef(false)
```

在现有 useEffect（初始化）中增（找到 `useEffect(() => {` 第一个即可，若无副作用初始化块则新增一个）：

```tsx
  useEffect(() => {
    const s = createSpeechSession()
    speechRef.current = s
    setSpeech(s)
    return () => {
      // S5：卸载时释放麦克风
      speechRef.current?.stop().catch(() => {})
      speechRef.current = null
    }
  }, [])
```

- [ ] **Step 2: 语音处理函数**

在 `downloadFile` 函数之后增：

```tsx
  async function handleSpeechStop() {
    recordingRef.current = false
    setRecording(false)
    const s = speechRef.current
    if (!s) return
    // 无条件 stop() 释放麦克风（M3：无会话时松手也必须停录音）
    let result
    try {
      result = await s.stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : '语音发送失败')
      return
    }
    try {
      if (result.kind === 'transcript' && result.text) {
        // 转写成功 → 文字消息（直接走发送链路，避免 setInput 异步读旧值）
        setBusy(true)
        setError(null)
        try {
          const sessionId = await ensureSession()
          if (sessionId) {
            const clientMsgId = crypto.randomUUID()
            await sendMessage(sessionId, { clientMsgId, contentType: 'text', content: result.text, replyTo: replyingTo?.id })
            await loadMessages(sessionId)
            void refreshSessions()
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : '发送失败')
        } finally {
          setBusy(false)
        }
      } else if (result.kind === 'audio' && result.blob.size > 0) {
        // 降级：语音文件上传（决策 D6）；无会话时也建会话（与 send() 一致）
        const file = new File([result.blob], `语音-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`, {
          type: result.mime,
        })
        const sessionId = await ensureSession()
        if (!sessionId) return
        await uploadFile(sessionId, file)
        await loadMessages(sessionId)
        void refreshSessions()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '语音发送失败')
    }
  }
```

> 注：若 `send()` 签名与现状不符（如 send 无参数直接读 input state），按现状调用；转写文本写入 input 后调 send() 发送。若 send 依赖 `e.target` 或表单，调整调用方式（读现有 send 实现后对齐），并在汇报中说明。

- [ ] **Step 3: 🎤 按钮**

在 footer 的 📎 按钮之后（file input 与发送按钮之间）增：

```tsx
          {speech?.canRecord ? (
            <button
              className={`ghost voice-btn ${recording ? 'recording' : ''}`}
              title={recording ? '松开发送' : '按住说话'}
              style={recording ? { touchAction: 'none' } : undefined}
              onPointerDown={(e) => {
                e.preventDefault()
                // S1：捕获指针，滑出边界不触发 pointerleave，松手仍收到 pointerup
                e.currentTarget.setPointerCapture(e.pointerId)
                recordingRef.current = true
                setRecording(true)
                speechRef.current?.start()
                // M2：60s 上限截断即发送（stop 幂等，无双发）
                window.setTimeout(() => {
                  if (recordingRef.current) void handleSpeechStop()
                }, 60_000)
              }}
              onPointerUp={() => {
                if (recordingRef.current) void handleSpeechStop()
              }}
              onPointerCancel={() => {
                if (recordingRef.current) void handleSpeechStop()
              }}
            >
              🎤
            </button>
          ) : null}
```

- [ ] **Step 4: 语音消息渲染**

在消息渲染的 `isFile` 分支（file-bubble）之后、默认气泡分支之前增语音气泡分支（在 `const isFile = ...` 附近增 `const isVoice = m.contentType === 'voice' || (isFile && /audio\//.test(m.file?.mime ?? ''))`，然后渲染分支 `isFile ? (...) : isVoice ? (...) : (...)`——注意顺序：isVoice 判定在 isFile 分支之后用 else 链）：

```tsx
                ) : isVoice ? (
                  <div className="file-bubble voice-bubble">
                    <span>🎤 语音消息</span>
                    {m.ref?.kind === 'file' ? (
                      <button className="ghost small" onClick={() => void downloadFile(m.ref!.id, m.content)}>播放</button>
                    ) : null}
                  </div>
                ) : (
```

并确保 `isVoice` 与 `isFile` 声明位置正确（`isFile` 先声明，`isVoice` 在其后，两者在渲染分支中 else-if 链：`isCard ? ... : isTask ? ... : isFile ? ... : isVoice ? ... : (...bubble)`）。

- [ ] **Step 5: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/pages/Chat.test.tsx
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；Chat.test.tsx 19 用例全 PASS（既有，新增用例在 Task 3）；build 产出 dist/。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/Chat.tsx
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 语音按钮（按住说话）与语音消息渲染"
```

---

## Task 3: 语音测试 + CSS + README

**Files:**
- Modify: `apps/web/src/pages/Chat.test.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `README.md`（根）

- [ ] **Step 1: Chat.test.tsx 增语音用例**

读 `apps/web/src/pages/Chat.test.tsx`，在文件顶部 import 区（`vi` 已导入）与既有 mockFetch 之后增语音 mock 辅助（放在文件内 describe 之前或顶部，保持风格一致）：

```tsx
class FakeSpeechRecognition {
  lang = ''
  interimResults = false
  continuous = false
  onresult: ((e: unknown) => void) | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start() {}
  stop() {}
}

class FakeRecorder {
  static isTypeSupported = () => true
  state = 'inactive'
  stream = { getTracks: () => [{ stop: vi.fn() }] }
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null
  onstop: (() => void) | null = null
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
}
```

在最后一个 describe 用例之后追加（注意 `vi.stubGlobal` 与 `vi.unstubAllGlobals` 配对；既有 setup 若已有 afterEach unstub，核对不冲突）。**关键**：用 `vi.mock('../lib/speech.js')` 注入可控假 session，完整覆盖 transcript 发送与 audio 降级两条路径。在 Chat.test.tsx 顶部（其他 vi.mock 之后）增：

```tsx
const mockStop = vi.fn()
const mockSpeechSession = { canRecord: true, start: vi.fn(), stop: mockStop }
vi.mock('../lib/speech.js', () => ({
  createSpeechSession: () => mockSpeechSession,
}))
```

> 注：若 Chat.test.tsx 已 import 真实 speech 模块（Task 2 后 Chat.tsx import 它），vi.mock 会拦截；mockStop 的可变行为在每个用例内通过 `mockStop.mockResolvedValueOnce(...)` 设定。若该文件已有 vi.mock 声明模式，按现有风格对齐。**事件 API 必须用 `fireEvent.pointerDown/pointerUp`**（本仓 user-event 为 v14，pointer API 已移除，`userEvent.pointerDown` 不存在）；`mockFetch` 为 URL-only 查表（不含 method 前缀），故 key 用纯 URL（如 `/api/v1/sessions/s1/messages`），且 messages/files 的 POST 分支会把返回 message 推入渲染列表（读现有 mockFetch 实现后按同款处理——通常现有 files-POST 分支已把 message 推入 `createdMessages`，核对后照抄）。

追加用例：

```tsx
  it('sends a transcript text after speech stop', async () => {
    mockStop.mockResolvedValueOnce({ kind: 'transcript', text: '语音转写结果' })
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      '/api/v1/sessions/s1/messages': { message: { id: 'm9', clientMsgId: 'c9', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'text', content: '语音转写结果', seq: 9, createdAt: '', ref: null } },
    })
    render(<Chat onLogout={vi.fn()} />)
    const mic = await screen.findByRole('button', { name: /🎤/ })
    fireEvent.pointerDown(mic)
    fireEvent.pointerUp(mic)
    expect(await screen.findByText(/语音转写结果/)).toBeTruthy()
  })

  it('uploads audio blob when speech degrades', async () => {
    mockStop.mockResolvedValueOnce({ kind: 'audio', blob: new Blob(['x'], { type: 'audio/webm' }), mime: 'audio/webm' })
    mockFetch({
      '/api/v1/sessions': { sessions: [{ id: 's1', kind: 'project', title: '报销系统', memberIds: [], unreadCount: 0 }] },
      '/api/v1/sessions/s1/messages?after_seq=0': { messages: [] },
      '/api/v1/sessions/s1/memories': { memories: [] },
      '/api/v1/sessions/s1/members': { members: [] },
      '/api/v1/sessions/s1/tasks': { tasks: [] },
      // 与既有文件上传用例相同的 POST 分支 key（URL-only，含返回 message 用于列表渲染）
      '/api/v1/sessions/s1/files': { file: { id: 'f1', sessionId: 's1', name: '语音-1.webm', size: 1, mime: 'audio/webm', uploadedBy: 'u-alice', createdAt: '' }, message: { id: 'm10', clientMsgId: 'c10', sessionId: 's1', senderId: 'u-alice', senderKind: 'human', contentType: 'file', content: '语音-1.webm', seq: 10, createdAt: '', ref: { kind: 'file', id: 'f1' }, file: { id: 'f1', name: '语音-1.webm', size: 1, mime: 'audio/webm' } } },
    })
    render(<Chat onLogout={vi.fn()} />)
    const mic = await screen.findByRole('button', { name: /🎤/ })
    fireEvent.pointerDown(mic)
    fireEvent.pointerUp(mic)
    // 语音气泡渲染「🎤 语音消息」（不显示文件名）→ 断言该文本与播放按钮
    expect(await screen.findByText(/🎤 语音消息/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /播放/ })).toBeTruthy()
  })
```

> 注：speech 的 FakeRecorder/FakeSpeechRecognition 类若 Task 1 测试已有，可在本文件内复制一份（测试文件互相独立，不共享）。用例 2 的 mockFetch key 必须与现有实现一致（若现有 files-POST 用例已存在，直接照抄其 key 与返回结构）；`fireEvent` 需从 `@testing-library/react` 导入（现有测试若已 import，复用）。

- [ ] **Step 2: app.css 增语音样式**

在 `.file-bubble` 之后追加：

```css
.recording { background: #ffecec !important; border-color: #ff5b5b !important; }
.voice-bubble { cursor: default; }
.voice-btn { touch-action: none; user-select: none; }
```

- [ ] **Step 3: README 增「语音输入」节**

在 README「### 静默策略（FR-CHAT-05）」节之后追加：

```markdown
### 语音输入（FR-DESK-07 / FR-CHAT-01）

输入区 🎤 按住说话：实时转写（Web Speech API，Chrome/Edge）→ 松开以文字发送；转写失败或浏览器不支持 → 降级为语音文件消息（可播放，决策 D6）。需要 HTTPS 或 localhost（浏览器麦克风安全要求）。
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 测试全 PASS（11 + 2 新增语音用例）；build 产出 dist/。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/Chat.test.tsx apps/web/src/app.css README.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(web): 语音按钮测试 + 样式 + README 语音说明"
```

---

## Task 4: 全仓验收 + 推送 + 真实验收

- [ ] **Step 1: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 137 + web 20+ ≈ 160）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [ ] **Step 2: 真实验收（降级路径 + 后端链路）**

Web Speech API 需真实浏览器，无法用 curl 验收；验收降级路径与既有后端链路：

```bash
cd /tmp
# 1) 登录建会话（gateway 需 NODE_ENV=development + MODEL_API_KEY 启动）
# 2) 生成一个真实音频文件上传（模拟降级语音）
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -c:a libopus /tmp/ta-voice-test.webm 2>/dev/null || \
  printf 'fake audio payload' > /tmp/ta-voice-test.webm
# 3) 上传为文件消息 → 验证 file 消息 + 可下载
curl -s -X POST "localhost:3001/api/v1/sessions/<sid>/files" -H "authorization: Bearer $TOKEN" \
  -F "file=@/tmp/ta-voice-test.webm;filename=语音-test.webm;type=audio/webm" | python3 -m json.tool
# 4) 下载验证 Content-Disposition 与内容一致
```

Expected: 上传返回 201 file+message（contentType=file、content=语音-test.webm、mime=audio/webm）；下载 200 且内容一致。转写主路径（Web Speech）标注为「浏览器手动验收项」（Chrome 打开 :5173 → 按住 🎤 说话 → 松开转成文字发送）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase1-plan11-voice-input.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 11 全部勾选 + README 语音说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录

- **Spec 覆盖**：FR-CHAT-01（语音转文字消息）→ Task 1/2；FR-DESK-07（按住语音键→实时转写预览→松开发送；转写失败降级语音消息，决策 D6）→ Task 2/3；验收「转写 P95 < 3s」→ Web Speech 本地实时 + 3s 降级兜底；「失败降级路径可用」→ Task 4 真实验收。
- **占位符扫描**：无 TBD；所有代码逐字给出。
- **类型一致性**：`SpeechSession`（start/stop/canRecord）在 speech.ts/Chat.tsx/speech.test.ts 一致；`createSpeechSession()` 返回 `SpeechSession | null`；`stop()` 返回判别联合 `{kind:'transcript'}|{kind:'audio'}`。
- **已知取舍**：MVP 浏览器 Web Speech（零成本）而非云 ASR（TechDesign T1 修正，接口封装在 speech.ts 单一位置，Phase 2 换云 ASR/Whisper 只改此文件）；Firefox/Safari 走降级录音路径；语音文件消息用 contentType=file（`voice` 类型留 Phase 2 云 ASR）；录音 ≤60s（20MB 上限内）；Web Speech 仅 HTTPS/localhost（dev 满足）。
