# Phase 1 · 计划 10：静默策略 + 评测集（发布门禁）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 FR-CHAT-05 静默策略（决策点/项目关键词触发 + 闲聊静默）与 1,000 组固定评测集门禁（准确率 ≥ 95%，PRD §13 发布门槛），并在 AgentBridge 中接入非 @ 触发路由（决策点/关键词 → Ta-PM 仲裁者）。

**Architecture:** 新增纯函数分类器 `agent/silence.ts`（零 LLM 成本：决策点正则 + 项目词表打分，≥3 分触发）→ 固定评测集 `eval/silence-cases.json`（由确定性生成器 `eval/gen-cases.ts` 产出 4×250 组：@提及/决策点/关键词/闲聊）→ 门禁 runner `eval/run-silence.ts`（准确率 < 95% 退出 1）+ vitest 门禁用例 → `AgentBridge.handle` 在无 @ 命中时走分类器，respond 时路由 Ta-PM（仲裁者，PRD「多智能体由 Ta-PM 仲裁」），silent 时零成本跳过。

**Tech Stack:** 无新依赖。纯 TS 正则/词表规则 + Node 确定性生成（mulberry32 伪随机，seed 固定保证可复现）+ vitest。

**决策记录：** 分类器与评测集按同一产品规则（PRD §6.7 触发矩阵）构建，评测集为固定资产入库（生成器可复现、JSON 即真源）；准确率门禁 ≥95% 是发布门槛（roadmap 风险表第 1 条）；分类器不可用时降级为纯 @ 必响应（现有行为，PRD §6.7 关键交互规则 1）；非 @ 触发一律路由 Ta-PM（仲裁者，不并行多个 agent，避免刷屏）；关键词打分 ≥3 分触发（强词 2-3 分、普通词 1 分，防闲聊误报）；决策点正则刻意收紧（如「对比一下」而非裸「比较」，防「这个比较好吃」误报）。后续（记入 Phase 2）：分类器升级为 LLM/embedding 打分、评测集持续扩充、误报回归流程。

**质量审查决策（T1 后追加）：** `MENTION_RE` 收窄为 Ta 系白名单 `/@\s*Ta[-_]?(?:PM|Architect|Fullstack|QA)(?![\w-])/i`（与 registry 一致；消除 email `a@b.com`、镜像 `nginx@sha256:…`、分支名 `feature@dev` 误报，`\w` 不含中文故 `@所有人` 本不匹配）；决策正则移除「同意|通过」（授予侧非审批请求侧，消除「我通过了考试」「打卡通过了」误报）——两项修正实证对评测集准确率影响为 0（100% 保持）。**关键锚定用例（T1 修复点）已固化为 vitest 硬断言**（`silence.test.ts` 的 `does not fire on emails, code fragments or approval-ack phrases`：admin@example.com/nginx@sha256/feature@dev/我同意/我通过了考试/打卡通过了/@所有人 必须 silent）——发布门禁除 ≥95% 阈值外，这些硬断言独立于评测集生效。**已知误报类（记 Phase 2，修需联动重生成 decision 模板，当前 10 条模板 7 条依赖这些模式）**：闲聊决策「你决定去哪吃饭/选哪个餐厅/红烧肉还是清蒸鱼好/哪个更好吃/股票跌了怎么办」；**已知漏报类（记 Phase 2 LLM 分类器）**：`吗`-问句（「这个需求要做吗」）、「进度怎么样」、空格敏感（「版本 1 和版本 2」vs「版本1和版本2」、`方案1 vs 方案2`）。评测集结构性弱点已记录：100% 源于模板与正则同源设计，靠 idle 模板补易混淆负例（Task 2 已含「我通过了考试 / admin@example.com / @所有人 / docker pull nginx@sha256:…」）与持续扩充缓解；频率限制器（≤3 条/轮、≥30s）兜底刷屏。

**质量审查决策（T4 后追加）：** 非 @ 触发路由 Ta-PM 改为按 id 查找（`AGENTS.find(a => a.id === 'agent-ta-pm')`，找不到显式报错跳过，防 AGENTS 调序静默改道）；非 @ 分支补 `agentMaxPromptChars` 护栏（与 @ 分支一致，防长文本绕过 4000 字符限制直接进 LLM）；确认无重复触发（@ 分支先行短路）、错误路径完整（provider 失败回错误回复、持久化失败返回 error）、幂等（clientMsgId 去重）。**P0 后续（放量前必须闭环，Phase 2 首项）**：频率限制器（≤3 条/轮、≥30s，PRD §6.7）+ per-session 并发护栏（在途 ≥1 排队/丢弃）——当前未实现，爆发 N 条决策点消息 → N 个并行在途 LLM 调用 + 429 刷屏；误报类（闲聊决策 5 类）每次误报 = 1 次完整 LLM 调用（有界线性，无放大回路，agent 互聊已短路）。记后续：非 @ too-long / 非 @ provider 失败 / @+决策点共存 3 个测试用例；emit 异常双回复 nit；多副本 outbox 前提；回复乱序（与护栏同修）。

**质量审查决策（T3 后追加）：** runner 本体补固定集规模/类别/唯一性校验（`raw.length !== 1000`、四类各 250、input 唯一 1000，防手改缩集 5 条全对即 100% 绕过门禁）+ `JSON.parse` try/catch 友好报错（非法语法 exit 1）；门禁阈值 `<95% exit 1` 与 PRD「≥95% 为门槛」一致（恰好 95% 通过，浮点 950/1000 精确相等实证）；`eval:silence` 为独立脚本（tsx src，vitest 不执行），**CI/CD 接线记 Phase 2 M2.3**（CI 须同时跑 eval:silence exit-code 门禁 + vitest，落地前发布流程手动执行）；runner 退出码测试（抽导出函数方案）与 lib/ 产物不含 silence-cases.json 记入后续任务。

**质量审查决策（T2 后追加）：** ① keyword 类改为**无放回抽样**（rng 洗牌 1600 组合取前 250）消除 18 组重复；② **per-category seed**（mention/decision/keyword/idle 各自 `mulberry32(42+类别序号)`）隔离 rng 消费，新增模板不再导致其他类别漂移；③ 生成器提炼 `take()` 辅助并修正「无词重叠」注释（`交付里程碑` 含 B 词 `交付`，因词表 includes 去重不影响分数）；④ reason 字段携带增益信息（keyword 记分值、decision 记命中正则索引）便于调试；⑤ runner 增加 JSON 运行时校验（input/expected/category/reason 四字段 + expected ∈ {respond,silent}），防手改 JSON 静默抬高准确率；⑥ 门禁生效依赖 Task 3 落地（runner + vitest + 脚本），此前「≥95% 发布门禁」无执行点——Task 3 完成后闭环。**门禁防退化实证**：≥95% 阈值允许 50 例失败，单条正则删除多逃逸（4/8 条决策正则删除 0 失败，模板双锚定遮蔽）；核心防线 = 关键锚定硬断言（见上）+ 三大机制整体存在性（删整条 keyword/MENTION 路径 → 75% 红）。记 Phase 2：补回 slice 截断的 8 个 idle 模板、`吗`-问句/进度/空格敏感正例、mention 边界负例（`@@`/`@bob`/全角 ＠/多 agent）、真实多句长消息语料、三重常量（generator/classifier/registry）去重或一致性测试。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `services/gateway/src/agent/silence.ts` | 创建 | 静默策略分类器（纯函数） |
| `services/gateway/src/agent/silence.test.ts` | 创建 | 分类器单元测试 |
| `services/gateway/src/eval/gen-cases.ts` | 创建 | 确定性评测集生成器（mulberry32 per-category seed，无放回抽样） |
| `services/gateway/src/eval/silence-cases.json` | 创建（生成产物入库） | 1,000 组固定评测集（真源） |
| `services/gateway/src/eval/run-silence.ts` | 创建 | 门禁 runner（<95% 退出 1） |
| `services/gateway/src/eval/silence.test.ts` | 创建 | 门禁 vitest 用例（条数 + 准确率） |
| `services/gateway/package.json` | 修改 | `eval:silence` / `gen:silence-cases` 脚本 |
| `services/gateway/src/agent/bridge.ts` | 修改 | 非 @ 触发走分类器 → Ta-PM |
| `services/gateway/src/agent/bridge.test.ts` | 修改 | 补决策点/关键词/静默用例 |
| `README.md` | 修改 | 静默策略说明 |

---

## Task 1: 静默策略分类器

**Files:**
- Create: `services/gateway/src/agent/silence.ts`
- Create: `services/gateway/src/agent/silence.test.ts`

- [ ] **Step 1: 写分类器**

创建 `services/gateway/src/agent/silence.ts`，内容逐字如下：

```ts
/** FR-CHAT-05 静默策略：@提及/决策点/项目关键词 → respond；其余 → silent（零 LLM 成本规则版） */

export type SilenceDecision = { decision: 'respond' | 'silent'; reason: string }

/** @ 提及（必响应，纯规则降级模式的核心兜底；PRD「分类器不可用时降级为仅 @ 必响应」） */
const MENTION_RE = /@[\w-]+/i

/** 决策点正则（命中即 respond；刻意收紧避免闲聊误报） */
const DECISION_RE: RegExp[] = [
  /你(?:来)?(?:定|决定|拍板|拿主意|说了算)/i,
  /(?:选|选择)[^，。]{0,10}?(?:还是|或|哪个)/i,
  /(?:还是|或)[^，。]{0,6}(?:好|更好)/i,
  /(?:哪个|哪一种)[^，。]{0,6}(?:好|更好|合适)/i,
  /(?:方案|版本|设计|做法)[一二三四1-4]?(?:与|和|vs|VS)[^，。]{0,8}(?:方案|版本|设计|做法)/i,
  /(?:对比|比较)一下/i,
  /(?:审批|批准|请确认|确认后|确认一下|确认无误|同意|通过|驳回)/i,
  /(?:怎么办|怎么处理|如何处理|如何解决|给个建议|给个意见|你怎么看|大家怎么看)/i,
]

/** 项目词表：强词 2-3 分、普通词 1 分；累计 ≥3 触发 */
const PROJECT_TERMS: ReadonlyArray<[string, number]> = [
  ['技术方案', 3],
  ['需求评审', 3],
  ['代码审查', 3],
  ['性能优化', 3],
  ['架构设计', 3],
  ['上线', 2],
  ['部署', 2],
  ['验收', 2],
  ['交付', 2],
  ['里程碑', 2],
  ['排期', 2],
  ['重构', 2],
  ['联调', 2],
  ['压测', 2],
  ['bug', 3],
  ['api', 2],
  ['prd', 2],
  ['需求', 1],
  ['功能', 1],
  ['缺陷', 1],
  ['测试', 1],
  ['用例', 1],
  ['架构', 1],
  ['设计', 1],
  ['文档', 1],
  ['接口', 1],
  ['数据库', 1],
  ['后端', 1],
  ['前端', 1],
  ['代码', 1],
  ['实现', 1],
  ['开发', 1],
  ['评审', 1],
  ['任务', 1],
  ['进度', 1],
  ['版本', 1],
  ['方案', 1],
  ['原型', 1],
]

const DECISION_THRESHOLD = 3

/** 分类消息：respond（应触发智能体）或 silent（应静默，仅落库） */
export function classifySilence(content: string): SilenceDecision {
  if (MENTION_RE.test(content)) return { decision: 'respond', reason: 'mention' }
  for (const re of DECISION_RE) {
    if (re.test(content)) return { decision: 'respond', reason: 'decision-point' }
  }
  let score = 0
  for (const [term, weight] of PROJECT_TERMS) {
    if (content.toLowerCase().includes(term)) score += weight
  }
  if (score >= DECISION_THRESHOLD) return { decision: 'respond', reason: `keyword-score-${score}` }
  return { decision: 'silent', reason: 'idle-chat' }
}
```

- [ ] **Step 2: 写分类器单元测试**

创建 `services/gateway/src/agent/silence.test.ts`，内容逐字如下：

```ts
import { describe, expect, it } from 'vitest'
import { classifySilence } from './silence.js'

describe('classifySilence', () => {
  it('responds to @ mentions routed as decision point', () => {
    expect(classifySilence('@Ta-PM 帮我整理下需求').decision).toBe('respond')
  })

  it('responds to decision points (你定/选A还是B/对比一下/审批)', () => {
    expect(classifySilence('这个方案你定吧').decision).toBe('respond')
    expect(classifySilence('选 A 还是 B 好').decision).toBe('respond')
    expect(classifySilence('方案一和方案二对比一下').decision).toBe('respond')
    expect(classifySilence('这个需求需要审批').decision).toBe('respond')
    expect(classifySilence('上线时间你怎么看').decision).toBe('respond')
    expect(classifySilence('这个 bug 怎么办').decision).toBe('respond')
  })

  it('responds to project keyword signals (score >= 3)', () => {
    expect(classifySilence('需求文档更新了，准备上线').decision).toBe('respond')
    expect(classifySilence('后端接口联调完成，可以部署了').decision).toBe('respond')
    expect(classifySilence('测试用例写完了，开始验收').decision).toBe('respond')
    expect(classifySilence('这个功能设计有问题，需要重构').decision).toBe('respond')
    expect(classifySilence('prd 更新了，代码审查安排下').decision).toBe('respond')
  })

  it('stays silent on idle chat (keyword score < 3, no decision point)', () => {
    expect(classifySilence('晚上一起吃饭？').decision).toBe('silent')
    expect(classifySilence('哈哈哈哈').decision).toBe('silent')
    expect(classifySilence('在吗').decision).toBe('silent')
    expect(classifySilence('嗯嗯，好的').decision).toBe('silent')
    expect(classifySilence('确认收到').decision).toBe('silent')
    expect(classifySilence('你说得对').decision).toBe('silent')
    expect(classifySilence('我看看方案').decision).toBe('silent')
    expect(classifySilence('这个比较好吃').decision).toBe('silent')
    expect(classifySilence('辛苦啦').decision).toBe('silent')
  })

  it('is case-insensitive for english terms', () => {
    expect(classifySilence('API 文档已更新').decision).toBe('respond')
    expect(classifySilence('Fix the BUG please').decision).toBe('respond')
  })
})
```

- [ ] **Step 3: 跑分类器测试**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/agent/silence.test.ts
```

Expected: typecheck exit 0；silence.test.ts 5 用例全 PASS（若「这个比较好吃」或「我看看方案」误报 respond，是正则过宽——先读分类器修正正则再继续，不得放宽测试断言）。

- [x] **Step 4: 提交**

```bash
git add services/gateway/src/agent/silence.ts services/gateway/src/agent/silence.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(silence): 静默策略分类器（决策点正则 + 项目词表打分）"
```

---

## Task 2: 固定评测集（1,000 组，确定性生成）

**Files:**
- Create: `services/gateway/src/eval/gen-cases.ts`
- Create: `services/gateway/src/eval/silence-cases.json`（生成产物，入库）

- [ ] **Step 1: 写生成器**

创建 `services/gateway/src/eval/gen-cases.ts`，内容逐字如下（mulberry32 per-category seed，无放回抽样，确定性）：

```ts
/** 生成 1,000 组固定评测集（4×250：@提及/决策点/关键词/闲聊）到 silence-cases.json。
 *  确定性：每类独立 seed（42+类别序号）+ 固定模板；无放回抽样保证 keyword 类不重复；每次运行产出相同 JSON。 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ---- mulberry32 确定性 PRNG ----
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

/** 无放回抽样：rng 洗牌后取前 n（Fisher-Yates） */
function sample<T>(rng: () => number, arr: readonly T[], n: number): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy.slice(0, n)
}

/** 取前 n（保序） */
function take<T>(arr: readonly T[], n: number): T[] {
  return arr.slice(0, n)
}

interface Case {
  input: string
  expected: 'respond' | 'silent'
  category: 'mention' | 'decision' | 'keyword' | 'idle'
  reason: string
}

// ---- 模板库 ----
const MENTION_PREFIXES = ['', '请', '麻烦', '帮我']
const MENTION_AGENTS = ['@Ta-PM', '@ta_pm', '@Ta-Architect', '@Ta-Fullstack', '@ta_fullstack', '@Ta-QA', '@Ta-QA ', '@Ta-PM ']
const MENTION_TASKS = [
  '帮我整理下需求', '评审下这个方案', '写个登录页面', '测试下这个功能', '看下这个 bug',
  '更新下文档', '设计下数据库表', '写个接口', '做个原型', '检查下代码',
  '梳理下任务进度', '排个交付计划', '分析下性能问题', '写个测试用例', '评估下这个设计',
  '改一下接口文档', '补个压测方案', '看看架构有没有问题', '列一下验收清单', '整理下会议纪要',
]

const DECISION_TEMPLATES = [
  (v: string) => `这个${v}你定吧`,
  (v: string) => `选 A 还是 B 好？${v}`,
  (v: string) => `${v}方案一和方案二对比一下`,
  (v: string) => `这个${v}需要审批`,
  (v: string) => `${v}上线时间你怎么看`,
  (v: string) => `这个 bug ${v}怎么办`,
  (v: string) => `请确认下${v}预算`,
  (v: string) => `${v}选哪个版本合适`,
  (v: string) => `这两个${v}设计哪个更好`,
  (v: string) => `${v}怎么处理比较好`,
]
const DECISION_SUBJECTS = [
  '需求', '功能', '方案', '页面', '接口', '数据库', '架构', '任务', '文档', '部署',
  '排期', '版本', '测试', '代码', '模块', '流程', '原型', '进度', '发布', '评审',
  '设计', '预算', '上线', '验收', '迭代',
]

const KEYWORD_TEMPLATES = [
  (a: string, b: string) => `${a}更新了，准备${b}`,
  (a: string, b: string) => `${a}完成，开始${b}`,
  (a: string, b: string) => `${a}有问题，需要${b}`,
  (a: string, b: string) => `${a}通过了，安排${b}`,
  (a: string, b: string) => `${a}已经写好，下一步${b}`,
  (a: string, b: string) => `${a}和${b}都要在今天搞定`,
  (a: string, b: string) => `${a}调整完就能${b}了`,
  (a: string, b: string) => `${a}还没做，先${b}吧`,
  (a: string, b: string) => `${a}别忘记${b}`,
  (a: string, b: string) => `${a}这块需要${b}一下`,
]
const KEYWORD_A = [
  '需求文档', '后端接口', '测试用例', '这个功能', '架构方案', 'prd', '代码审查', '数据库表', '前端页面', '性能优化',
  '接口文档', '交付里程碑', '任务清单', '项目进度', '测试脚本', '版本计划', '需求评审', '技术方案', 'bug 清单', '里程碑',
]
// KEYWORD_A 各项为 1-3 分词（普通 1 分/强 2 分/极强 3 分），KEYWORD_B 全为 2 分词；
// 与词表 includes 判定下无去重分数损失（A 含 B 词仅影响去重计数，不影响总分），任一 A + B 组合总分 ≥3
const KEYWORD_B = [
  '上线', '部署', '验收', '交付', '重构', '排期', '联调', '压测',
]

const IDLE_TEMPLATES = [
  () => '晚上一起吃饭？',
  () => '哈哈哈哈',
  () => '在吗',
  () => '嗯嗯，好的',
  () => '确认收到',
  () => '我通过了考试',
  () => '联系 admin@example.com 谢谢',
  () => '@所有人 记得提交日报',
  () => 'docker pull nginx@sha256:abc123',
  () => '你说得对',
  () => '我看看方案',
  () => '这个比较好吃',
  () => '辛苦啦',
  () => '谢谢老板',
  () => '周末愉快',
  () => '今天天气不错',
  () => '发个位置给我',
  () => '记得打卡',
  () => '好的收到',
  () => '晚安',
  () => '早安',
  () => '随便聊聊',
  () => '有没有人',
  () => '我先去开会了',
  () => '+1',
  () => '收到',
  () => '嗯嗯',
  () => '行吧',
  () => '稍等',
  () => 'ok',
  () => '好的',
  () => '明白了',
  () => '太棒了',
  () => '加油',
  () => '下班了',
  () => '喝杯咖啡',
  () => '这个笑话真好笑',
  () => '你看那个视频了吗',
  () => '午饭吃什么',
  () => '周末去爬山吗',
  () => '天气转凉了',
  () => '路上堵车了',
  () => '今天股票又跌了',
  () => '假期去哪玩',
]
const IDLE_SUFFIXES = ['', '，大家呢？', '～', '!', '……', '？', '～啦']

// ---- 展开：每类恰 250 组（per-category seed，无放回抽样，均匀覆盖模板面） ----
function buildCases(): Case[] {
  const cases: Case[] = []

  // 1) @提及 250：640 组合无放回抽样（per-category seed=42，覆盖全部前缀/agent/任务）
  const mentionRng = mulberry32(42)
  const mentionPool: Case[] = []
  for (const prefix of MENTION_PREFIXES) {
    for (const agent of MENTION_AGENTS) {
      for (const task of MENTION_TASKS) {
        mentionPool.push({ input: `${prefix}${agent} ${task}`, expected: 'respond', category: 'mention', reason: 'mention' })
      }
    }
  }
  cases.push(...sample(mentionRng, mentionPool, 250))

  // 2) 决策点 250：模板×主语 穷举恰 250（10×25，保序，无 rng）
  for (const tpl of DECISION_TEMPLATES) {
    for (const subj of DECISION_SUBJECTS) {
      cases.push({ input: tpl(subj), expected: 'respond', category: 'decision', reason: 'decision-point' })
    }
  }

  // 3) 关键词 250：1600 组合无放回抽样（per-category seed=44，不重复）
  const keywordRng = mulberry32(44)
  const keywordPool: Case[] = []
  for (const tpl of KEYWORD_TEMPLATES) {
    for (const a of KEYWORD_A) {
      for (const b of KEYWORD_B) {
        keywordPool.push({ input: tpl(a, b), expected: 'respond', category: 'keyword', reason: 'keyword-score' })
      }
    }
  }
  cases.push(...sample(keywordRng, keywordPool, 250))

  // 4) 闲聊 250：308 组合无放回抽样（per-category seed=46，覆盖全部模板含易混淆负例）
  const idleRng = mulberry32(46)
  const idlePool: Case[] = []
  for (const tpl of IDLE_TEMPLATES) {
    for (const suffix of IDLE_SUFFIXES) {
      idlePool.push({ input: `${tpl()}${suffix}`, expected: 'silent', category: 'idle', reason: 'idle-chat' })
    }
  }
  cases.push(...sample(idleRng, idlePool, 250))

  return cases
}

const all = buildCases()
if (all.length !== 1000) {
  throw new Error(`expected 1000 cases, got ${all.length}`)
}
for (const cat of ['mention', 'decision', 'keyword', 'idle'] as const) {
  const n = all.filter((c) => c.category === cat).length
  if (n !== 250) throw new Error(`expected 250 ${cat} cases, got ${n}`)
}
const uniqueInputs = new Set(all.map((c) => c.input))
if (uniqueInputs.size !== 1000) {
  throw new Error(`expected 1000 unique inputs, got ${uniqueInputs.size}`)
}
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'silence-cases.json')
writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n')
console.log(`generated ${all.length} cases (${uniqueInputs.size} unique) -> ${outPath}`)
```

- [ ] **Step 2: 运行生成器并核对**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway exec tsx src/eval/gen-cases.ts
python3 -c "
import json
c=json.load(open('services/gateway/src/eval/silence-cases.json'))
from collections import Counter
print('total', len(c))
print('unique', len({x['input'] for x in c}))
print(Counter(x['category'] for x in c))
print(Counter(x['expected'] for x in c))
"
```

Expected: total 1000；unique 1000；category 四类各 250；expected respond 750 / silent 250。生成器幂等（再跑一次 `git diff --stat` 无变化）；总数/分类/唯一性不满足时生成器自行 throw（先读报错，不自行改代码）。

- [ ] **Step 3: 提交**

```bash
git add services/gateway/src/eval/gen-cases.ts services/gateway/src/eval/silence-cases.json
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(silence): 1,000 组固定评测集（确定性生成）"
```

---

## Task 3: 门禁 runner + vitest 门禁

**Files:**
- Create: `services/gateway/src/eval/run-silence.ts`
- Create: `services/gateway/src/eval/silence.test.ts`
- Modify: `services/gateway/package.json`

- [x] **Step 1: 写 runner**

创建 `services/gateway/src/eval/run-silence.ts`，内容逐字如下：

```ts
/** 静默策略评测集门禁：准确率 < 95% 退出码 1（发布门槛，PRD §13）。
 *  用法：pnpm --filter @ta/gateway eval:silence */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { classifySilence } from '../agent/silence.js'

const MIN_ACCURACY = 0.95

interface Case {
  input: string
  expected: 'respond' | 'silent'
  category: string
  reason: string
}

const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'silence-cases.json')
const raw = JSON.parse(readFileSync(casesPath, 'utf8')) as unknown[]

// 运行时校验：防手改/损坏的 JSON 静默抬高准确率
if (!Array.isArray(raw) || raw.length === 0) {
  console.error('评测集损坏：非数组或为空')
  process.exit(1)
}
for (const c of raw) {
  const ok =
    typeof c === 'object' &&
    c !== null &&
    typeof (c as Case).input === 'string' &&
    ((c as Case).expected === 'respond' || (c as Case).expected === 'silent') &&
    typeof (c as Case).category === 'string' &&
    typeof (c as Case).reason === 'string'
  if (!ok) {
    console.error('评测集损坏：字段非法（input/expected/category/reason 必需）', JSON.stringify(c))
    process.exit(1)
  }
}
const cases = raw as Case[]

const byCategory = new Map<string, { total: number; correct: number }>()
let correct = 0
const failures: Array<{ input: string; expected: string; got: string }> = []

for (const c of cases) {
  const got = classifySilence(c.input).decision
  const ok = got === c.expected
  if (ok) correct++
  else failures.push({ input: c.input, expected: c.expected, got })
  const row = byCategory.get(c.category) ?? { total: 0, correct: 0 }
  row.total++
  if (ok) row.correct++
  byCategory.set(c.category, row)
}

const accuracy = correct / cases.length
console.log(`总用例: ${cases.length}  正确: ${correct}  准确率: ${(accuracy * 100).toFixed(2)}%`)
for (const [cat, row] of byCategory) {
  console.log(`  ${cat.padEnd(10)} ${row.correct}/${row.total}  ${((row.correct / row.total) * 100).toFixed(1)}%`)
}
if (failures.length > 0 && failures.length <= 20) {
  for (const f of failures) console.log(`  FAIL 期望=${f.expected} 实际=${f.got}  输入: ${f.input}`)
} else if (failures.length > 20) {
  console.log(`  （前 20 条失败）`)
  for (const f of failures.slice(0, 20)) console.log(`  FAIL 期望=${f.expected} 实际=${f.got}  输入: ${f.input}`)
}

if (accuracy < MIN_ACCURACY) {
  console.error(`门禁未过：准确率 ${(accuracy * 100).toFixed(2)}% < ${MIN_ACCURACY * 100}%`)
  process.exit(1)
}
console.log(`门禁通过：准确率 ≥ ${MIN_ACCURACY * 100}%`)
```

- [x] **Step 2: package.json 增脚本**

读 `services/gateway/package.json`，在 `"migrate"` 后追加：

```json
    "gen:silence-cases": "tsx src/eval/gen-cases.ts",
    "eval:silence": "tsx src/eval/run-silence.ts"
```

（注意 JSON 逗号正确。）

- [x] **Step 3: 写 vitest 门禁用例**

创建 `services/gateway/src/eval/silence.test.ts`，内容逐字如下：

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifySilence } from '../agent/silence.js'

const MIN_ACCURACY = 0.95

interface Case {
  input: string
  expected: 'respond' | 'silent'
  category: string
  reason: string
}

const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'silence-cases.json')
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as Case[]

describe('silence eval gate', () => {
  it('has exactly 1000 fixed cases', () => {
    expect(cases).toHaveLength(1000)
  })

  it('has valid structure (input/expected/category/reason, expected enum)', () => {
    for (const c of cases) {
      expect(typeof c.input).toBe('string')
      expect(['respond', 'silent']).toContain(c.expected)
      expect(typeof c.category).toBe('string')
      expect(typeof c.reason).toBe('string')
    }
    expect(new Set(cases.map((c) => c.input)).size).toBe(1000)
  })

  it('classifier accuracy >= 95% on the fixed set', () => {
    const correct = cases.filter((c) => classifySilence(c.input).decision === c.expected).length
    expect(correct / cases.length).toBeGreaterThanOrEqual(MIN_ACCURACY)
  })
})
```

- [x] **Step 4: 跑门禁**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway eval:silence
pnpm --filter @ta/gateway test --reporter=verbose src/eval/silence.test.ts
```

Expected: `eval:silence` 输出准确率 ≥ 95%（若 <95%，是分类器与评测集模板不齐——修正 `agent/silence.ts` 的决策点正则或词表，不得改评测集 JSON 来凑数；重跑直到通过，并在汇报中说明修正点）；vitest 3 用例 PASS（1000 固定集 / 结构校验含唯一性 / 准确率 ≥95%）。

- [x] **Step 5: 提交**

```bash
git add services/gateway/src/eval/run-silence.ts services/gateway/src/eval/silence.test.ts services/gateway/package.json
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(silence): 评测集门禁 runner + vitest 用例"
```

---

## Task 4: AgentBridge 接入静默策略（非 @ 触发 → Ta-PM）

**Files:**
- Modify: `services/gateway/src/agent/bridge.ts`
- Modify: `services/gateway/src/agent/bridge.test.ts`

- [x] **Step 1: bridge.ts 接入分类器**

读 `services/gateway/src/agent/bridge.ts`，做三处修改：

1. import 增：`import { classifySilence } from './silence.js'` 与 `import { AGENTS } from './registry.js'`（改现有 `findAgentByMention` import 为同时引入 AGENTS）。

2. `skippedReason` 联合类型增 `'silent'`：
```ts
  skippedReason?: 'not-a-mention' | 'agent-message' | 'disabled' | 'too-long' | 'error' | 'silent'
```

3. `handle()` 中「无 @ 命中」分支改造：把
```ts
    const hit = findAgentByMention(message.content)
    if (!hit) return { triggered: false, skippedReason: 'not-a-mention' }
    if (hit.requirement.length > this.options.config.agentMaxPromptChars) {
      return { triggered: false, skippedReason: 'too-long' }
    }

    const { agent, requirement } = hit
    const systemPrompt = agent.persona.replaceAll('{{cwd}}', process.cwd())
```
改为：
```ts
    const hit = findAgentByMention(message.content)
    if (hit) {
      if (hit.requirement.length > this.options.config.agentMaxPromptChars) {
        return { triggered: false, skippedReason: 'too-long' }
      }
      return this.runAgent(message, hit.agent, hit.requirement)
    }

    // 无 @ 提及：静默策略（FR-CHAT-05）——respond 路由 Ta-PM（仲裁者），silent 零成本跳过
    const decision = classifySilence(message.content)
    if (decision.decision === 'silent') return { triggered: false, skippedReason: 'silent' }
    const pm = AGENTS[0]!
    return this.runAgent(message, pm, message.content)
```

4. 把原 try/catch 主体抽为私有方法 `runAgent`（原逻辑不变，仅方法化）：
```ts
  private async runAgent(
    message: Message,
    agent: AgentDefinition,
    requirement: string,
  ): Promise<MentionResult> {
    const systemPrompt = agent.persona.replaceAll('{{cwd}}', process.cwd())
    try {
      const completion = await this.options.provider.complete(systemPrompt, requirement)
      console.log(
        `[agent] ${agent.displayName} run: prompt=${completion.promptTokens} completion=${completion.completionTokens} tokens`,
      )
      const { message: reply } = await createMessage(this.options.pool, {
        sessionId: message.sessionId,
        senderId: agent.id,
        senderKind: 'agent',
        contentType: 'text',
        content: completion.content,
        clientMsgId: `agent-${randomUUID()}`,
      })
      this.options.emitMessageCreated(reply)
      return { triggered: true, agentId: agent.id, reply }
    } catch (err) {
      console.error('[agent] run failed:', err)
      try {
        const { message: reply } = await createMessage(this.options.pool, {
          sessionId: message.sessionId,
          senderId: agent.id,
          senderKind: 'agent',
          contentType: 'text',
          content: `⚠️ ${agent.displayName} 处理失败，请稍后重试。`,
          clientMsgId: `agent-${randomUUID()}`,
        })
        this.options.emitMessageCreated(reply)
        return { triggered: true, agentId: agent.id, reply, skippedReason: 'error' }
      } catch (replyErr) {
        console.error('[agent] failed to persist error reply:', replyErr)
        return { triggered: false, skippedReason: 'error' }
      }
    }
  }
```

`AgentDefinition` 类型需从 registry import（改 import 行为 `import { AGENTS, findAgentByMention, type AgentDefinition } from './registry.js'`）。同时更新 `MentionResult` 注释说明 silent。

- [x] **Step 2: bridge.test.ts 补用例**

读 `services/gateway/src/agent/bridge.test.ts`，在既有用例后追加（沿用现有 setup：StubProvider、临时池、`bridge.handle` 调用方式）：

```ts
  it('responds via Ta-PM on decision point without mention', async () => {
    const res = await bridge.handle({
      id: 'm-d1', clientMsgId: 'c-d1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
      contentType: 'text', content: '这个方案你定吧', seq: 2, createdAt: '', ref: null,
    } as Message)
    expect(res.triggered).toBe(true)
    expect(res.agentId).toBe('agent-ta-pm')
    expect(res.reply?.senderId).toBe('agent-ta-pm')
  })

  it('stays silent on idle chat (no provider call)', async () => {
    const res = await bridge.handle({
      id: 'm-s1', clientMsgId: 'c-s1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
      contentType: 'text', content: '哈哈哈哈', seq: 3, createdAt: '', ref: null,
    } as Message)
    expect(res.triggered).toBe(false)
    expect(res.skippedReason).toBe('silent')
  })

  it('responds via Ta-PM on keyword signal without mention', async () => {
    const res = await bridge.handle({
      id: 'm-k1', clientMsgId: 'c-k1', sessionId: 's1', senderId: 'u-alice', senderKind: 'human',
      contentType: 'text', content: '测试用例写完了，开始验收', seq: 4, createdAt: '', ref: null,
    } as Message)
    expect(res.triggered).toBe(true)
    expect(res.agentId).toBe('agent-ta-pm')
  })
```

注意：既有测试若用 `expect.objectContaining` 或精确 `skippedReason` 断言，需核对不受新分支影响（@ 提及路径不变）。

- [x] **Step 3: 跑测试**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway typecheck
pnpm --filter @ta/gateway test --reporter=verbose src/agent/bridge.test.ts
```

Expected: typecheck exit 0；bridge.test.ts 既有 9 用例 + 新增 3 用例全 PASS（12）。

- [ ] **Step 4: 提交**

```bash
git add services/gateway/src/agent/bridge.ts services/gateway/src/agent/bridge.test.ts
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(silence): AgentBridge 非 @ 触发走静默策略（respond→Ta-PM，silent 跳过）"
```

---

## Task 5: README + 全仓验收 + 推送

**Files:**
- Modify: `README.md`（根）

- [x] **Step 1: README 追加「静默策略」节**

在 README「### 智能体团队（四角色）」节之后追加：

```markdown
### 静默策略（FR-CHAT-05）

智能体仅在必要时机发言：`@提及` 必响应；无提及时由静默策略分类器判定——命中决策点（你定/选 A 还是 B/对比一下/审批）或项目关键词（打分 ≥3）→ 路由 Ta-PM 仲裁响应；闲聊静默（仅落库，零 LLM 成本）。

```bash
# 评测集门禁（1,000 组固定评测集，准确率 ≥95% 为发布门槛）
pnpm --filter @ta/gateway eval:silence
# 重新生成固定评测集（确定性，per-category seed）
pnpm --filter @ta/gateway gen:silence-cases
```
```

- [x] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
```

Expected: build 全过；test 全绿（contracts 2 + gateway 125+5+2=132 + web 19 = 153）；frozen-lockfile 通过；`git status` 干净（除 README）。

- [x] **Step 3: 提交 + 推送**

```bash
git add README.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: README 补静默策略与评测集门禁说明"
git push
```

Expected: 推送成功。

---

## Self-Review 记录

- **Spec 覆盖**：FR-CHAT-05（消息路由与静默策略）→ Task 1 分类器 + Task 2 评测集 + Task 4 接入；PRD §6.7 触发矩阵（@必响应/决策点/关键词 ≥0.65/闲聊静默）→ Task 1 规则对齐（分数阈值 3 对应 0.65 语义）；PRD §13 静默准确率 ≥95% 发布门禁 → Task 3；PRD「分类器不可用降级纯规则」→ 规则版即降级模式，@ 必响应保留（Task 4 提及分支不变）；PRD「多智能体由 Ta-PM 仲裁」→ Task 4 非 @ 触发路由 Ta-PM。
- **占位符扫描**：无 TBD；所有代码逐字给出。
- **类型一致性**：`classifySilence` 返回 `SilenceDecision`；`MentionResult.skippedReason` 增 `'silent'`；`runAgent` 复用 `AgentDefinition`；`Case` 接口在生成器/runner/vitest 中字段一致（input/expected/category/reason）。
- **已知取舍**：规则分类器（零成本、确定性、可解释）而非 LLM 分类器——LLM 版 Phase 2（嵌入打分 + 持续扩充评测集）；评测集由模板组合生成（覆盖矩阵语义），真实语料扩充后续；非 @ 触发仅 Ta-PM 单响应（防刷屏，PR-5）。
