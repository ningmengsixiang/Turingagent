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
