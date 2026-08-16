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
