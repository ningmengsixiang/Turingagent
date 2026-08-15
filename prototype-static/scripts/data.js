/* ============================================================
   Turing Agent 原型 · 种子数据（纯内存合成，无网络请求）
   会话 / 联系人 / 智能体 / 项目 / 记忆文档 / 交付物 / 看板任务
   ============================================================ */
"use strict";

/* —— 头像速记：人类统一浅灰圆头像；智能体黑色圆角方块 —— */
const AV = {
  human: (label) => ({ label, agent: false }),
  agent: (label) => ({ label, agent: true }),
};

const SELF = { who: "张敏", label: "敏", role: "财务部 · 需求方" };

/* ---------------- 会话 ---------------- */

const CHATS = [
  {
    id: "reimburse",
    title: "报销系统项目群",
    kind: "group",
    avatar: AV.human("报"),
    last: "设计稿评审：等待 2 人确认",
    time: "10:05",
    unread: 3,
    badgeCls: "",
    sub: "项目群 · 12 成员（含 5 智能体）",
    responder: { label: "Ta-PM", avatar: "PM", reply: "收到，已记录。如需推进，我会创建审批流并@相关审批人。" },
    stack: [
      AV.human("芳"),
      AV.human("陈"),
      AV.human("王"),
      AV.agent("PM"),
      AV.agent("UX"),
    ],
    messages: [
      { type: "system", text: "2026-08-13 · 项目群创建，智能体团队已接入" },
      { type: "self", who: "张敏", text: "我们需要一个报销系统，支持拍照上传发票。", time: "09:12" },
      { type: "human", who: "王芳", role: "财务部", avatar: AV.human("芳"), text: "还要支持多级审批，我们财务有自己的流程。", time: "09:13" },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "好的，我先确认几个关键点：\n1) 使用人员范围？\n2) 审批流程固定还是可配置？\n3) 是否需要对接财务系统？", time: "09:14" },
      { type: "self", who: "张敏", text: "全体员工，流程可配置，暂时不对接。", time: "09:15" },
      { type: "human", who: "王芳", role: "财务部", avatar: AV.human("芳"), text: "不对，我们财务要求对接用友。", time: "09:16" },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "收到，存在不同意见。@陈总（财务负责人）请确认对接方案。", time: "09:17" },
      { type: "human", who: "陈总", role: "财务负责人 · 审批人", avatar: AV.human("陈"), text: "对接用友，这是硬性要求。", time: "09:20" },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "已记录。需求澄清完成，需求基线 v3 已生成并推送至记忆文档。", time: "09:21" },
      { type: "system", text: "审批流 AP-2026-007 已创建：需求基线确认 → 陈总 已确认 ✓" },
      {
        type: "card",
        who: "Ta-UI/UX",
        avatar: "UX",
        text: "高保真原型已完成，请各位评审。",
        time: "10:02",
        card: {
          id: "AP-2026-007",
          state: "pending",
          title: "设计稿评审",
          need: "单级 · 会签（需 2 人确认）",
          body: "高保真原型已完成，请各位评审。",
          preview: "原型预览.png",
          levels: [
            {
              name: "设计评审确认",
              approvers: [
                { who: "陈总", role: "业务负责人 · 财务", state: "done", time: "09:41" },
                { who: "李工", role: "技术负责人 · 研发", state: "pending", time: "" },
              ],
            },
          ],
        },
      },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "@陈总 @李工 请确认设计稿。", time: "10:03" },
      {
        type: "card",
        who: "Ta-PMO",
        avatar: "PMO",
        text: "开发与联调已完成，进入上线前审批。",
        time: "10:30",
        card: {
          id: "AP-2026-010",
          state: "pending",
          title: "上线审批：报销系统 MVP 上线",
          need: "两级串行审批（技术 → 业务）",
          body: "用户认证模块与报销单导出已完成联调，申请上线生产环境。",
          preview: null,
          levels: [
            {
              name: "第 1 级 · 技术审批",
              approvers: [{ who: "李工", role: "技术负责人 · 研发", state: "pending", time: "" }],
            },
            {
              name: "第 2 级 · 业务审批",
              approvers: [{ who: "陈总", role: "业务负责人 · 财务", state: "pending", time: "" }],
            },
          ],
        },
      },
    ],
  },
  {
    id: "change",
    title: "审批群 · 需求变更",
    kind: "group",
    avatar: AV.human("审"),
    last: "Ta-Architect：影响较小，预计 1 小时完成",
    time: "10:20",
    unread: 1,
    badgeCls: "badge-amber",
    sub: "审批群 · 3 成员（含 2 智能体）",
    responder: { label: "Ta-PM", avatar: "PM", reply: "已记录审批结果，变更申请状态已更新。" },
    stack: [AV.human("陈"), AV.human("李"), AV.agent("PM")],
    messages: [
      { type: "system", text: "审批群 · 需求变更集中审批" },
      { type: "self", who: "张敏", text: "我们需要增加「差旅报销」类型。", time: "10:15" },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "这属于需求变更，将触发审批流程。正在创建变更申请…", time: "10:16" },
      {
        type: "card",
        who: "Ta-PM",
        avatar: "PM",
        text: "",
        time: "10:16",
        card: {
          id: "AP-2026-009",
          state: "pending",
          title: "需求变更：增加差旅报销类型",
          need: "单级 · 会签（需 2 人确认）",
          body: "变更内容：新增「差旅报销」类型及对应字段。",
          preview: null,
          levels: [
            {
              name: "变更审批确认",
              approvers: [
                { who: "陈总", role: "业务负责人 · 财务", state: "done", time: "10:18" },
                { who: "李工", role: "技术负责人 · 研发", state: "pending", time: "" },
              ],
            },
          ],
        },
      },
      { type: "agent", who: "Ta-Architect", avatar: "AR", text: "影响评估：需增加一个枚举值和相关表字段，预计 1 小时完成，风险低。", time: "10:20" },
    ],
  },
  {
    id: "fin-it",
    title: "财务-IT 协作群",
    kind: "group",
    avatar: AV.human("协"),
    last: "王芳：中午那家川菜不错",
    time: "09:48",
    unread: 0,
    badgeCls: "",
    sub: "部门协作群 · 8 成员（含 1 智能体）",
    silent: true, // 静默策略：闲聊不触发智能体
    stack: [AV.human("芳"), AV.human("王"), AV.human("李")],
    messages: [
      { type: "system", text: "本群智能体静默中 · 仅 @提及 或命中项目关键词时响应" },
      { type: "human", who: "王芳", role: "财务部", avatar: AV.human("芳"), text: "下午例会改到三点，大家注意。", time: "09:40" },
      { type: "human", who: "小王", role: "研发部", avatar: AV.human("王"), text: "收到。", time: "09:41" },
      { type: "self", who: "张敏", text: "好的，没问题。", time: "09:45" },
      { type: "human", who: "王芳", role: "财务部", avatar: AV.human("芳"), text: "中午那家川菜不错，下次团建可以去。", time: "09:47" },
      { type: "human", who: "小王", role: "研发部", avatar: AV.human("王"), text: "哈哈哈附议。", time: "09:48" },
      { type: "system", text: "智能体保持静默（闲聊未触发响应规则）" },
    ],
  },
  {
    id: "pmo",
    title: "Ta-PMO · 日报",
    kind: "agent",
    avatar: AV.agent("PMO"),
    last: "Ta-PMO：今日进度摘要已生成",
    time: "09:00",
    unread: 0,
    badgeCls: "badge-ai",
    sub: "私聊 · 智能体",
    responder: { label: "Ta-PMO", avatar: "PMO", reply: "收到。日报推送时间与格式可随时在设置中调整。" },
    stack: [AV.agent("PMO")],
    messages: [
      { type: "system", text: "私聊 · 日报订阅已开启（每日 09:00 推送）" },
      {
        type: "agent",
        who: "Ta-PMO",
        avatar: "PMO",
        text: "今日进度摘要：\n· 需求澄清 100% 已完成\n· 设计评审 待李工确认\n· 用户认证模块 80%（Ta-Fullstack）\n· 报销单导出 20%（小王）\n\n⚠️ 设计评审已逾期 1 天，建议跟进。",
        time: "09:00",
      },
    ],
  },
];

/* —— 项目群会话（点侧边栏项目进入） —— */
const PROJECT_CHATS = {
  数据看板: {
    sub: "项目群 · 6 成员（含 4 智能体）",
    responder: { label: "Ta-PM", avatar: "PM", reply: "好的，数据看板需求已记录。" },
    stack: [AV.human("李"), AV.human("王"), AV.agent("PM"), AV.agent("AR")],
    messages: [
      { type: "system", text: "项目群创建 · 目标：经营数据实时看板" },
      { type: "self", who: "张敏", text: "财务这边需要一个经营数据看板，每天看收入支出。", time: "昨天 14:20" },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "需求已记录，我先澄清数据口径：收入按回款口径还是开票口径？", time: "昨天 14:22" },
    ],
  },
  供应商门户: {
    sub: "项目群 · 5 成员（含 3 智能体）",
    responder: { label: "Ta-PM", avatar: "PM", reply: "好的，供应商门户需求已记录。" },
    stack: [AV.human("陈"), AV.agent("PM"), AV.agent("FS")],
    messages: [
      { type: "system", text: "项目群创建 · 目标：供应商自助门户" },
      { type: "self", who: "张敏", text: "供应商门户先做资质上传和开票信息维护。", time: "昨天 16:40" },
      { type: "agent", who: "Ta-PM", avatar: "PM", text: "收到，规划中。预计下周输出需求基线 v1。", time: "昨天 16:42" },
    ],
  },
};

/* —— 联系人与私聊 —— */
const CONTACTS = [
  { label: "陈", name: "陈总", role: "审批人 · 财务负责人", presence: "on",
    dm: [
      { type: "system", text: "私聊 · 陈总" },
      { type: "self", who: "张敏", text: "陈总，设计稿评审的确认我已经提交了，麻烦您看一下。", time: "09:55" },
      { type: "human", who: "陈总", role: "财务负责人", avatar: AV.human("陈"), text: "看到了，没问题，通过。", time: "09:56" },
    ] },
  { label: "李", name: "李工", role: "技术负责人 · 研发", presence: "busy",
    dm: [
      { type: "system", text: "私聊 · 李工" },
      { type: "self", who: "张敏", text: "李工，设计稿评审今天能确认吗？已经逾期 1 天了。", time: "10:10" },
      { type: "human", who: "李工", role: "技术负责人", avatar: AV.human("李"), text: "在看了，午前给你结论。", time: "10:11" },
    ] },
  { label: "王", name: "小王", role: "开发 · 研发", presence: "on",
    dm: [
      { type: "system", text: "私聊 · 小王" },
      { type: "self", who: "张敏", text: "报销单导出的进度怎么样了？", time: "09:30" },
      { type: "human", who: "小王", role: "开发", avatar: AV.human("王"), text: "模板在调，20% 左右，周五前能完。", time: "09:33" },
    ] },
  { label: "芳", name: "王芳", role: "业务 · 财务", presence: "off",
    dm: [
      { type: "system", text: "私聊 · 王芳" },
      { type: "human", who: "王芳", role: "财务部", avatar: AV.human("芳"), text: "敏姐，下午例会材料我放共享盘了。", time: "09:05" },
    ] },
];

/* —— 智能体目录 —— */
const AGENTS = [
  { section: "产品与流程", items: [
    { label: "PM", name: "Ta-PM", role: "需求澄清 · 流程协调" },
    { label: "PMO", name: "Ta-PMO", role: "进度跟踪 · 日报周报" },
  ] },
  { section: "研发与质量", items: [
    { label: "AR", name: "Ta-Architect", role: "架构方案 · 影响评估" },
    { label: "FS", name: "Ta-Fullstack", role: "前后端开发" },
    { label: "QA", name: "Ta-QA", role: "测试设计 · 缺陷验证" },
    { label: "UX", name: "Ta-UI/UX", role: "界面设计 · 原型" },
  ] },
];

/* —— 项目列表（侧边栏「项目」视图） —— */
const PROJECTS = [
  { name: "报销系统", status: "进行中", chip: "chip-green", chat: "reimburse" },
  { name: "数据看板", status: "规划中", chip: "chip-neutral", chat: "proj-dashboard" },
  { name: "供应商门户", status: "规划中", chip: "chip-neutral", chat: "proj-supplier" },
];

/* —— 记忆文档 —— */
const DOCS = [
  { name: "需求基线", version: "v3 · 已锁定 · 10:02", chip: "chip-green", chipText: "基线",
    body: "【需求基线 v3 · 报销系统】\n\n1. 全员报销，流程可配置\n2. 支持拍照上传发票（OCR 识别）\n3. 多级审批（财务自定义流程）\n4. 对接用友财务系统（硬性要求）\n5. 发票 OCR 集成（P0）\n\n变更记录：\n· v2 → v3：确认对接用友（陈总裁决 09:20）" },
  { name: "设计评审记录", version: "v1 · 待补充 · 10:05", chip: "chip-amber", chipText: "进行中",
    body: "【设计评审记录 · 进行中】\n\n高保真原型已提交（Ta-UI/UX · 10:02）\n\n审批进度：\n· 陈总 ✓ 已确认（09:41）\n· 李工 ⏳ 待确认\n\n评审结论：待全部审批人确认后归档。点击消息流中的确认卡片可直接审批，此处与进度视图同步更新。" },
  { name: "需求澄清纪要", version: "v2 · 09:21", chip: "chip-neutral", chipText: "已归档",
    body: "【需求澄清纪要 v2】\n\nQ1 使用范围 → 全体员工\nQ2 审批流程 → 可配置\nQ3 财务对接 → 对接用友（陈总 09:20 确认）\n\n输出：需求基线 v3 已生成。" },
  { name: "变更决策：对接用友", version: "v1 · 陈总裁决 · 09:20", chip: "chip-neutral", chipText: "决策",
    body: "【变更决策记录】\n\n事项：财务系统对接方案\n结论：对接用友，硬性要求\n裁决人：陈总（财务负责人）\n时间：2026-08-13 09:20\n影响：新增集成工作量，由 Ta-Architect 评估。" },
];

/* —— 交付物 —— */
const FILES = [
  { name: "高保真原型.png", size: "4.2 MB", by: "Ta-UI/UX", time: "10:02", kind: "img" },
  { name: "界面标注.png", size: "3.4 MB", by: "Ta-UI/UX", time: "10:04", kind: "img" },
  { name: "报销单样例.jpg", size: "2.1 MB", by: "王芳", time: "09:35", kind: "img" },
  { name: "需求基线文档.docx", size: "1.1 MB", by: "Ta-PM", time: "10:02", kind: "doc" },
  { name: "api-spec.md", size: "48 KB", by: "Ta-Architect", time: "09:45", kind: "doc" },
  { name: "上线检查清单.md", size: "12 KB", by: "Ta-QA", time: "10:28", kind: "doc" },
];

/* ---------------- 看板任务（种子，可被 localStorage 覆盖） ---------------- */

/* 执行者 → 头像 */
const ASSIGNEE_AV = {
  "Ta-PM（AI）": AV.agent("PM"),
  "Ta-PMO（AI）": AV.agent("PMO"),
  "Ta-UI/UX（AI）": AV.agent("UX"),
  "Ta-Architect（AI）": AV.agent("AR"),
  "Ta-Fullstack（AI）": AV.agent("FS"),
  "Ta-QA（AI）": AV.agent("QA"),
  "小王 · 研发": AV.human("王"),
  "张敏 · 财务": AV.human("敏"),
  "李工 · 研发": AV.human("李"),
  "王芳 · 财务": AV.human("芳"),
  "陈总 · 财务": AV.human("陈"),
};

/* 短名 → 完整执行者键（@分配任务解析用） */
const ASSIGNEE_ALIAS = {
  "Ta-PM": "Ta-PM（AI）",
  "Ta-PMO": "Ta-PMO（AI）",
  "Ta-UI/UX": "Ta-UI/UX（AI）",
  "Ta-UX": "Ta-UI/UX（AI）",
  "Ta-Architect": "Ta-Architect（AI）",
  "Ta-AR": "Ta-Architect（AI）",
  "Ta-Fullstack": "Ta-Fullstack（AI）",
  "Ta-FS": "Ta-Fullstack（AI）",
  "Ta-QA": "Ta-QA（AI）",
  小王: "小王 · 研发",
  张敏: "张敏 · 财务",
  李工: "李工 · 研发",
  王芳: "王芳 · 财务",
  陈总: "陈总 · 财务",
};

const SEED_TASKS = [
  /* 待开始 */
  { id: "T-101", title: "发票 OCR 集成", type: "ai", assignee: "Ta-Fullstack（AI）", prio: "P0", col: "todo", due: "2026-08-20" },
  { id: "T-102", title: "报表导出模板", type: "human", assignee: "张敏 · 财务", prio: "P2", col: "todo", due: "2026-08-25", mine: true },
  /* 进行中 */
  { id: "T-201", title: "用户认证模块", type: "ai", assignee: "Ta-Fullstack（AI）", prio: "P0", col: "doing", due: "2026-08-15", progress: 80 },
  { id: "T-202", title: "报销单导出", type: "human", assignee: "小王 · 研发", prio: "P1", col: "doing", due: "2026-08-18", progress: 20 },
  { id: "T-203", title: "UI 高保真收尾", type: "ai", assignee: "Ta-UI/UX（AI）", prio: "P1", col: "doing", due: "2026-08-13", progress: 90 },
  /* 阻塞 */
  { id: "T-301", title: "用友接口联调", type: "human", assignee: "小王 · 研发", prio: "P0", col: "blocked", due: "2026-08-12",
    blockedReason: "等待用友开放平台 API 权限审批（陈总已催办）" },
  /* 待审批 */
  { id: "T-401", title: "设计稿评审", type: "human", assignee: "李工 · 研发", prio: "P0", col: "approval", due: "2026-08-12", approvalId: "AP-2026-007" },
  { id: "T-402", title: "需求变更：差旅报销", type: "human", assignee: "李工 · 研发", prio: "P0", col: "approval", due: "2026-08-14", approvalId: "AP-2026-009" },
  { id: "T-403", title: "上线审批：MVP 上线", type: "human", assignee: "李工 · 研发", prio: "P0", col: "approval", due: "2026-08-15", approvalId: "AP-2026-010" },
  /* 已完成 */
  { id: "T-501", title: "需求澄清", type: "ai", assignee: "Ta-PM（AI）", prio: "P1", col: "done", due: "2026-08-11", doneAt: "08-11" },
  { id: "T-502", title: "需求基线确认", type: "ai", assignee: "Ta-PM（AI）", prio: "P0", col: "done", due: "2026-08-12", doneAt: "08-12" },
  { id: "T-503", title: "项目脚手架搭建", type: "ai", assignee: "Ta-Architect（AI）", prio: "P1", col: "done", due: "2026-08-12", doneAt: "08-12" },
  { id: "T-504", title: "环境部署", type: "human", assignee: "小王 · 研发", prio: "P2", col: "done", due: "2026-08-10", doneAt: "08-10" },
  { id: "T-505", title: "数据字典整理", type: "ai", assignee: "Ta-Architect（AI）", prio: "P2", col: "done", due: "2026-08-11", doneAt: "08-11" },
  { id: "T-506", title: "接口文档初稿", type: "human", assignee: "李工 · 研发", prio: "P2", col: "done", due: "2026-08-09", doneAt: "08-09" },
];

/* —— 看板列定义 —— */
const BOARD_COLS = [
  { id: "todo", label: "待开始" },
  { id: "doing", label: "进行中" },
  { id: "blocked", label: "阻塞" },
  { id: "approval", label: "待审批" },
  { id: "done", label: "已完成" },
];

/* ---------------- 组织与治理（org.html 种子） ---------------- */

const DEPARTMENTS = [
  { name: "财务部", members: ["张敏", "王芳", "陈总"] },
  { name: "研发部", members: ["李工", "小王"] },
  { name: "产品部", members: ["赵主任"] },
];

const MEMBERS = [
  { name: "张敏", dept: "财务部", role: "需求方", presence: "on", email: "min.zhang@corp.cn" },
  { name: "王芳", dept: "财务部", role: "普通成员", presence: "off", email: "fang.wang@corp.cn" },
  { name: "陈总", dept: "财务部", role: "审批人", presence: "on", email: "chen@corp.cn" },
  { name: "李工", dept: "研发部", role: "技术负责人", presence: "busy", email: "li@corp.cn" },
  { name: "小王", dept: "研发部", role: "普通成员", presence: "on", email: "wang@corp.cn" },
  { name: "赵主任", dept: "产品部", role: "企业管理员", presence: "on", email: "zhao@corp.cn" },
];

const ROLES = ["企业管理员", "项目管理员", "需求方", "技术负责人", "普通成员", "审批人", "只读成员"];

/* PRD 5.1.1 角色权限矩阵 */
const ROLE_MATRIX = [
  { role: "企业管理员", build: true, speak: true, confirm: true, approve: true, code: true, perm: "全部" },
  { role: "项目管理员", build: true, speak: true, confirm: true, approve: true, code: true, perm: "项目内" },
  { role: "需求方", build: false, speak: true, confirm: true, approve: "视指定", code: false, perm: "—" },
  { role: "技术负责人", build: false, speak: true, confirm: true, approve: true, code: true, perm: "—" },
  { role: "普通成员", build: false, speak: true, confirm: false, approve: false, code: "视授权", perm: "—" },
  { role: "审批人", build: false, speak: true, confirm: false, approve: "仅指定节点", code: false, perm: "—" },
  { role: "只读成员", build: false, speak: false, confirm: false, approve: false, code: false, perm: "—" },
];

/* 智能体配额（FR-ORG-04 演示） */
const AGENT_QUOTAS = [
  { name: "Ta-PM", label: "PM", used: 62, total: 100, model: "DeepSeek-V3", enabled: true },
  { name: "Ta-Architect", label: "AR", used: 45, total: 100, model: "Claude-Sonnet", enabled: true },
  { name: "Ta-Fullstack", label: "FS", used: 88, total: 100, model: "Claude-Opus", enabled: true },
  { name: "Ta-UI/UX", label: "UX", used: 30, total: 80, model: "GPT-5", enabled: true },
  { name: "Ta-QA", label: "QA", used: 55, total: 80, model: "DeepSeek-V3", enabled: true },
  { name: "Ta-PMO", label: "PMO", used: 12, total: 50, model: "DeepSeek-V3", enabled: true },
];

/* 审计日志种子（type: approval|task|perm|agent|system） */
const AUDIT_SEED = [
  { type: "approval", action: "审批通过", target: "审批流 AP-2026-007 · 需求基线确认", actor: "陈总", time: "09:41" },
  { type: "approval", action: "审批通过", target: "审批流 AP-2026-009 · 第一级", actor: "陈总", time: "10:18" },
  { type: "approval", action: "创建审批流", target: "审批流 AP-2026-010 · 上线审批", actor: "Ta-PMO", time: "10:30" },
  { type: "task", action: "状态变更", target: "任务「报销单导出」→ 进行中", actor: "小王", time: "09:55" },
  { type: "task", action: "任务完结", target: "任务「需求基线确认」", actor: "Ta-PM", time: "08-12 18:40" },
  { type: "perm", action: "角色变更", target: "王芳 → 普通成员", actor: "赵主任", time: "08-12 15:20" },
  { type: "perm", action: "成员邀请", target: "邀请 李工 加入研发部", actor: "赵主任", time: "08-10 10:02" },
  { type: "agent", action: "配额调整", target: "Ta-Fullstack 配额 80 → 100", actor: "赵主任", time: "08-11 09:30" },
  { type: "agent", action: "熔断触发", target: "Ta-QA 单任务预算超限", actor: "系统", time: "08-10 16:44" },
  { type: "system", action: "登录", target: "张敏 · macOS 客户端", actor: "张敏", time: "09:00" },
];
