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
let raw: unknown
try {
  raw = JSON.parse(readFileSync(casesPath, 'utf8'))
} catch {
  console.error(`评测集损坏：JSON 解析失败（${casesPath}）`)
  process.exit(1)
}

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
// 固定集规模校验：防缩集绕过（1000 条 / 每类 250 / 输入唯一）
if (raw.length !== 1000) {
  console.error(`评测集损坏：固定集应为 1000 条，实际 ${raw.length}`)
  process.exit(1)
}
const catCount = new Map<string, number>()
for (const c of raw as Case[]) {
  catCount.set(c.category, (catCount.get(c.category) ?? 0) + 1)
}
for (const cat of ['mention', 'decision', 'keyword', 'idle']) {
  if (catCount.get(cat) !== 250) {
    console.error(`评测集损坏：类别 ${cat} 应为 250 条，实际 ${catCount.get(cat) ?? 0}`)
    process.exit(1)
  }
}
if (new Set((raw as Case[]).map((c) => c.input)).size !== 1000) {
  console.error('评测集损坏：输入必须 1000 个唯一')
  process.exit(1)
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
