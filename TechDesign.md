# Turing Agent（Ta）技术方案（Technical Design）

> **版本**：v1.0 ｜ **状态**：评审中 ｜ **关联文档**：[TuringAgent.md（PRD）](./TuringAgent.md) ｜ **日期**：2026-08-13

## 1. 技术选型总览

| 层 | 选型 | 版本 | 理由 | 备选 |
|----|------|------|------|------|
| 桌面客户端 | **Tauri 2.x** + React 18 + TypeScript 5 + Vite | 2.x | 冷启动 < 3s、常驻内存 < 500MB 的 NFR 下，Tauri 用系统 WebView，单窗口约 60–120MB，Electron 通常 300–600MB；二进制体积小、私有化分发友好 | Electron（若遇 WebView 兼容瓶颈或需 Chromium 特有 API） |
| 客户端状态 | Zustand（客户端状态）+ TanStack Query（服务端状态，含 SWR 与离线缓存） | 5.x | 遵循「服务端状态不落客户端 store」原则；IM 消息天然适合 SWR 模型 | — |
| 接入层 | **Go 1.23** + gorilla/websocket + chi | 1.23 | WebSocket 高并发（每连接一 goroutine）、单二进制部署（私有化友好）、内存可控 | Node.js（TS 全栈统一心智） |
| 平台服务层 | Go（组织/权限/审批/聊天/任务/记忆/通知） | 1.23 | 与接入层同栈，事务一致性（PG）与并发简单 | — |
| 智能体编排层 | **TypeScript（Node 22）** | 22 LTS | MCP SDK 与主流 Agent SDK 一等公民；与前端共享类型定义；LLM 调用为 IO 密集，Node 足够 | Python（数据/研究类技能生态更强，可作为技能包执行环境） |
| 模型网关 | Go（路由/配额/计量/熔断）+ 适配器模式 | — | 高吞吐 token 计量与配额强一致需求 | — |
| 主数据库 | PostgreSQL 16（含 RLS、pgvector 预留） | 16 | 关系模型复杂（组织/审批/审计），RLS 支撑租户隔离双保险 | MySQL 8 |
| 缓存/实时 | Redis 7（会话、在线状态、Pub/Sub 扇出、配额计数、分布式锁） | 7 | IM 标准配件 | — |
| 消息队列 | Redis Streams（MVP）→ NATS（规模化） | — | MVP 从简；消费者组支持异步任务 | Kafka（重） |
| 对象存储 | MinIO（S3 兼容） | — | 私有化可落地；SaaS 可直接切云厂商 S3 | 云 OSS |
| 桌面本地库 | SQLite（tauri-plugin-sql，FTS5 全文索引） | 3.x | 离线缓存 ≥ 90 天、群内消息本地检索 | IndexedDB（容量受限） |
| 模型接入 | 统一适配器：Anthropic API / OpenAI-compatible / 国产模型（通义、DeepSeek、GLM）/ 私有 vLLM | — | PRD「模型可插拔」硬需求 | — |
| 语音转写 | 云 ASR（阿里/讯飞，MVP）；本地 Whisper（私有化，P1） | — | 私有化客户「数据不出域」要求 | — |
| 监控 | Prometheus + Grafana + OpenTelemetry | — | 全链路 trace（消息→编排→模型） | — |

**关键决策说明**：

1. **Tauri 而非 Electron**：PRD NFR 约束内存与启动速度，Tauri 2 已成熟（多窗口、系统托盘、通知插件齐全）。风险是 Win10 需 WebView2 运行时——安装器静默安装解决。若个别企业 Win7/特殊安全基线不满足，保留 Electron 分支作为逃生舱。
2. **编排层用 TS 而非 Python**：智能体主要工作是调用 MCP 工具与 LLM，Node 生态（MCP、Agent SDK）目前最活跃；Python 保留为技能包的可选执行环境（沙箱镜像），而非主运行时。
3. **模型可插拔是第一优先级架构约束**：所有 LLM 调用必须经过 Model Gateway，业务代码不直接依赖任何供应商 SDK。

## 2. 总体架构

```
┌────────────────────────────────────────────────────────────────┐
│            桌面客户端 apps/desktop（Tauri 2 + React）            │
│  本地 SQLite（离线缓存）｜WebSocket 长连接｜系统通知｜文件拖拽    │
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTPS / WSS
┌──────────────────────────────▼─────────────────────────────────┐
│         接入层 services/gateway（Go）                            │
│  - 认证（OIDC：企业微信/钉钉/标准 SSO）                          │
│  - 消息网关（WebSocket，Redis Pub/Sub 多节点扇出）               │
│  - 文件上传/下载（预签名 URL → MinIO）                           │
└──────────────────────────────┬─────────────────────────────────┘
                               │ gRPC/HTTP（内网）
┌──────────────────────────────▼─────────────────────────────────┐
│      平台服务 services/platform（Go，模块化单体）                 │
│  - 组织服务（租户/部门/成员/角色）                               │
│  - 权限引擎（RBAC + ABAC，策略缓存）                             │
│  - 审批流引擎（状态机，MVP 单节点 → P1 多级）                    │
│  - 聊天服务（消息落库、seq、已读）                               │
│  - 任务服务 ｜ 记忆文档服务 ｜ 通知服务 ｜ 审计服务               │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 事件（Redis Streams）
┌──────────────────────────────▼─────────────────────────────────┐
│       编排层 services/orchestrator（TypeScript，Node 22）        │
│  - 消息路由器（@触发/关键词/决策点/静默策略）                    │
│  - Ta-PM 调度器（多智能体协同，汇总为单条回复）                  │
│  - 智能体运行时（Agent loop：plan→act→observe→reflect）          │
│  - 技能包系统（manifest + skills + tools，热加载）               │
│  - 沙箱执行（Docker 容器，最小权限）                             │
└──────────────────────────────┬─────────────────────────────────┘
                               │ 统一出口
┌──────────────────────────────▼─────────────────────────────────┐
│     services/model-gateway（Go）：路由/分层/配额/熔断/计量       │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │Anthropic│ │OpenAI兼容│ │国产模型  │ │私有 vLLM │            │
│  └─────────┘ └──────────┘ └──────────┘ └──────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

**分层职责边界**：

- 网关与平台服务**不直接调用 LLM**，只发事件/投递消息，由编排层消费——保证智能体故障不影响 IM 主链路。
- 编排层**无业务数据写权限**，其数据库访问走平台服务 API（服务账号 + 最小权限），智能体「越权」在 API 层被权限引擎拦截。
- Model Gateway 是 LLM 唯一出口：路由、成本计量、配额熔断都在此收口。

## 3. 代码仓库结构（Monorepo）

```
ta/
├── apps/
│   └── desktop/            # Tauri 2 + React：主工作台
│       ├── src/            # 前端（组件/页面/hooks/lib，按 surface 组织）
│       └── src-tauri/      # Rust 壳（通知/拖拽/托盘/多窗口）
├── services/
│   ├── gateway/            # Go 接入层
│   ├── platform/           # Go 平台服务（模块化单体）
│   ├── orchestrator/       # TS 编排层
│   └── model-gateway/      # Go 模型网关
├── packages/
│   ├── contracts/          # 共享协议：API 类型、WS 事件、错误码（TS）
│   └── ui/                 # 设计系统组件库（头像/AI徽标/确认卡片/看板卡）
├── deploy/
│   ├── k8s/                # SaaS 部署清单
│   └── onprem/             # 私有化一键安装器（Docker Compose 起步 → K8s）
└── docs/                   # PRD / 技术方案 / 评测集规范
```

> 工程约束：pnpm workspace + buf；`packages/contracts` 是唯一协议事实来源，Go/TS 两侧生成绑定。MVP 阶段 WS 事件用 JSON（不引入 protobuf，避免过度设计），规模化时再评估。

## 4. 核心流程设计

### 4.1 消息路由与静默策略（PRD FR-CHAT-05，P0）

**决策流程**：

```
群消息到达
  ├─ 发送者是人类？
  │   ├─ 被 @智能体？ ──────────→ 必响应（Ta-PM 仲裁后回复）
  │   ├─ 命中「关键决策点」规则？→ 触发（如：出现多方案分歧/待确认词/审批词）
  │   ├─ 命中「项目关键词」？ ──→ 轻量分类打分 ≥ 阈值才响应
  │   └─ 否则 ─────────────────→ 静默（仅落库，不调用 LLM）
  ├─ 发送者是智能体？
  │   └─ 仅任务事件/进度回报（防智能体互聊刷屏，规则层拦截）
  └─ 频率限制：每群智能体连续发言 ≤ 3 条/轮，间隔 ≥ 30s
```

**实现**：规则层（@提及、关键词表、决策点正则）先行——零成本拦截 ≥ 80% 情况；剩余走轻量分类器（小模型，输入最近 N 条消息，输出 `respond: 0-1`，阈值 0.65）。**评测集**：1,000 组标注对话（闲聊/讨论/提问/决策点），静默准确率 ≥ 95% 为发布门禁（PRD NFR）。

### 4.2 审批流引擎（PRD FR-APP-01/02）

状态机：

```
                    ┌─────────────┐
   创建 ──────────→ │  PENDING    │──── 全部通过 ────→ APPROVED
                    │ (单节点/会签)│
                    │ (或签:任一) │──── 驳回 ─────────→ REJECTED
                    └─────────────┘──── 修改意见 ─────→ RETURNED
                                                          │ 发起人修订
                                                          ▼ 重新提交 PENDING
```

- MVP：线性单节点（`single`）。P1：节点类型 `single | all(会签) | any(或签)` + 条件网关 + 转办（transfer）+ 超时升级。
- 持久化：`approvals` + `approval_tasks` 两表；状态迁移在事务内完成，变更通过 WS 事件广播。
- **硬约束（PRD 产品原则）**：审批人必须是人类 `member_id`；API 层拒绝 `agent` 类型审批人。

### 4.3 确认卡片与审批流联动

```
[审批流创建] → platform 落库 → WS approval.created → 客户端渲染确认卡片
[用户点击确认/驳回/修改意见] → POST /v1/approvals/{id}/decide
  → platform 校验（人类、有权限、状态合法）→ 状态迁移 → 审计落库
  → WS approval.decided → 卡片更新（琥珀→绿/红）→ 编排层生成系统消息入群
```

卡片与审批流是**同一状态的两个渲染**，不引入独立卡片状态，避免双写不一致。

### 4.4 离线同步（PRD FR-DESK-05，P0）

- **消息模型**：每群独立递增 `seq`（服务端分配）。客户端维护 `last_seq`，重连后 `GET /channels/{id}/messages?after_seq=` 增量补拉。
- **写路径**：客户端本地 Outbox（SQLite），发送即本地可见；网络恢复后按序重放，服务端以 `client_msg_id` 幂等去重。
- **冲突策略**：群消息为追加制（无冲突）；记忆文档编辑采用「版本 + 留痕」而非 LWW——任何编辑生成新版本，历史可审计（PRD Q4 建议）。
- 缓存保留 ≥ 90 天，超出按 LRU 清理，附件仅保留元数据（本地不落大文件，按需下载）。

### 4.5 智能体任务执行与人工闸门（PRD FR-INT-01）

```
任务创建（人/@分配）→ 预算校验（token/时长/重试）→ 沙箱容器启动
  → Agent loop（MCP 工具调用，步数上限）→ 产出（代码/文档/设计稿）
  → 提交人工闸门：代码 → 强制 Code Review + 安全扫描门禁（Semgrep 等）
      设计稿/文档 → 确认卡片审批
  → 通过后合并/归档；失败回流任务状态并回报原因
```

**熔断规则**（PRD R1 缓解）：单任务 token 预算（按任务类型预设）、最大执行时长、重试 ≤ 2 次；触顶即终止并通知任务发起人，**失败尝试计入成本**（对齐行业教训）。

## 5. 数据模型（核心表）

> 约定：所有业务表含 `tenant_id`（隔离锚点）、`created_at`、`updated_at`；审计表 append-only。

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `tenants` | id, name, plan, status | 企业租户 |
| `departments` | id, tenant_id, parent_id, name | 多级部门树 |
| `members` | id, tenant_id, dept_id, name, position, avatar | 人类成员 |
| `roles` / `member_roles` | role, scope(global/project) | RBAC |
| `projects` | id, tenant_id, name, status | 项目 |
| `agents` | id, tenant_id, role(ta_pm/arch/…), model_pref, quota_id | 企业智能体配置 |
| `skill_packs` | id, name, version, manifest jsonb | 技能包 |
| `channels` | id, tenant_id, type(comm/project/dept/approval), project_id | 群 |
| `channel_members` | channel_id, member_type(human/agent), member_id, role | 混合成员 |
| `messages` | id, tenant_id, channel_id, seq, sender_type, sender_id, content_type(text/image/file/voice/card/system), content jsonb, client_msg_id | 消息（content 按类型存结构化数据，卡片含 approval_ref） |
| `message_reads` | channel_id, member_id, last_seq | 已读回执 |
| `approvals` | id, tenant_id, project_id, type, title, state, payload jsonb | 审批流实例 |
| `approval_tasks` | id, approval_id, node_index, approve_type, member_id, state, comment | 审批节点 |
| `tasks` | id, tenant_id, project_id, title, assignee_type, assignee_id, state, due_at | 任务（人类/智能体统一） |
| `memory_docs` / `memory_doc_versions` | doc_id, version, content, source_message_ids | 记忆文档（版本+留痕） |
| `audit_logs` | id, tenant_id, actor_type, actor_id, action, target, result, prev_hash, hash | 审计（hash 链防篡改） |
| `quotas` / `usage_records` | tenant_id, subject, budget, used, period | 模型配额与计量 |

## 6. 接口设计

### 6.1 REST 规范（统一信封，遵循 ECC common/patterns.md）

```json
{ "success": true, "data": { }, "error": null,
  "meta": { "page": 1, "limit": 50, "total": 0 } }
```

**端点清单（节选）**：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/org/members` | 邀请成员、分配角色 |
| GET | `/v1/channels` | 群列表（含未读数） |
| GET | `/v1/channels/{id}/messages?after_seq=` | 增量拉取 |
| POST | `/v1/channels/{id}/messages` | 发消息（幂等：client_msg_id） |
| POST | `/v1/approvals/{id}/decide` | 审批决策（confirm/reject/comment） |
| POST | `/v1/tasks` | 创建任务（assignee 可为 human/agent） |
| GET | `/v1/memory-docs` | 记忆文档检索 |
| POST | `/v1/ws` | WebSocket 握手（token 鉴权） |

错误码：`401` 未认证 / `403` 无权限（记审计）/ `409` 状态冲突（如重复审批）/ `429` 频率限制。

### 6.2 WebSocket 事件协议

```json
{ "type": "message.new", "channel_id": "ch_1", "seq": 1024, "data": { } }
```

| 事件 | 触发 |
|------|------|
| `message.new` / `message.updated` | 新消息 / 卡片状态变化引起的内容更新 |
| `agent.typing` | 智能体开始/结束输入 |
| `approval.created` / `approval.decided` | 审批流创建 / 决策 |
| `task.updated` | 任务状态变化（看板实时刷新） |
| `notification.new` | 强提醒（@/审批/智能体里程碑） |
| `presence.changed` | 成员在线状态 |

客户端处理：事件按 `seq` 单调校验，乱序/重复丢弃后触发补拉。

## 7. 智能体设计

### 7.1 角色与边界（MVP：Ta-PM / Ta-Architect / Ta-Fullstack / Ta-QA）

每个智能体 = **系统提示（角色定义）+ 技能包（工具）+ 权限域（服务账号）** 三元组。角色提示包含硬边界：不可替人类决策、不可触碰权限域外资源、输出格式约束（消息长度、结构化卡片）。

### 7.2 技能包规范

```json
{
  "name": "ta-qa",
  "version": "1.2.0",
  "entry": "agent.md",
  "tools": ["mcp::playwright", "builtin::code-review"],
  "requires": { "model_min": "claude-sonnet-4" },
  "permissions": ["read:repo", "write:test-report"],
  "cost_class": "medium"
}
```

- 技能包热加载：校验 manifest → 加载工具 → 沙箱内注册，无需发版。
- 权限白名单在**沙箱层**强制执行（与声明不一致以沙箱为准）。

### 7.3 沙箱与权限

- 每个智能体任务运行在独立 Docker 容器（或私有化环境的 gVisor 增强）；文件/网络按权限白名单。
- 智能体使用**服务账号**调用平台 API，权限域 = 任务所需最小集合；越权请求在权限引擎被拒并审计（PRD FR-PERM-01 要求「智能体与人类同等受权限约束」）。

### 7.4 成本控制（PRD 商业模式前提）

- 模型分层路由：轻任务（分类/摘要/路由打分）→ Haiku 级；复杂开发 → Sonnet 级；架构难题 → Opus 级（按 PRD 成本结构）。
- 单任务预算 + 配额熔断（FR-ORG-04）+ 语义缓存（重复澄清问题命中缓存，Phase 2）。

## 8. 安全设计

| 面 | 设计 |
|----|------|
| 认证 | 人类：OIDC（企业微信/钉钉/标准 OIDC），JWT access 15min + refresh 7d 轮换；智能体：服务账号 + 短时签名令牌，`actor_type=agent` 全程透传审计 |
| 授权 | 权限引擎统一鉴权（RBAC + P2 ABAC），API 网关层 + 服务层双检 |
| 传输/存储 | TLS 1.3；PG 数据 KMS 信封加密；私有化支持客户自有 KMS（密钥企业可控，PRD FR-SEC-01） |
| 租户隔离 | `tenant_id` 全局强制 + PostgreSQL RLS 双保险；隔离性专项测试 + 第三方渗透测试（PRD R5 缓解） |
| 审计 | append-only + hash 链防篡改；保留 ≥ 1 年，可导出（FR-PERM-03） |
| 智能体沙箱 | Docker 容器 + 网络白名单 + 只读挂载代码库副本；AI 生成代码强制安全扫描门禁后合并（PRD R2 缓解） |
| 威胁建模（STRIDE 摘要） | 伪造：token 轮换+签名；篡改：审计 hash 链、消息 seq 校验；抵赖：审批留痕；信息泄露：RLS+加密；DoS：限流+熔断；提权：最小权限域 |

## 9. 非功能设计

| 项 | 设计 |
|----|------|
| 消息性能预算 | 网关→客户端 P95 < 500ms：WebSocket 直推，无中间落库延迟；消息落库异步化（先推后持久，seq 保证顺序） |
| 智能体响应 | P95 < 5s（文本类）：分类/路由 ≤ 1s，生成流式回传（`message.updated` 增量渲染）；长任务异步化 + 进度事件 |
| 连接容量 | 单网关节点 10k 长连接（压测目标）；Redis Pub/Sub 扇出，网关无状态水平扩展 |
| 可用性 | SaaS 99.9%：网关/平台/编排多副本 + 优雅降级（编排层故障时 IM 仍可用，智能体功能降级提示）；PG 主从 + 每日备份 |
| 可扩展 | 扩展点：模型适配器、技能包、审批节点类型、消息内容类型（card 可插拔渲染器） |
| 客户端性能 | 消息列表虚拟化（react-window）；LCP 首屏 < 1.5s（本地渲染）；动画仅 transform/opacity |

## 10. 部署方案

**SaaS（Phase 1-2）**：K8s 多副本；网关/平台/编排/模型网关各自 HPA；MinIO 换云对象存储；WAF + 四层/七层限流。

**私有化（Phase 2，FR-DEP-01）**：

```
一键安装器（deploy/onprem）
  ├─ Docker Compose 起步包（单机 ≤ 8C16G 可跑，用于 < 100 人客户）
  ├─ K8s 部署清单（> 100 人 / 高可用）
  ├─ 离线镜像包 + License 激活（激活失败降级为只读试用）
  └─ 模型选项：公有云 API（可关闭）｜本地 vLLM/国产一体机
```

私有化特有：数据不出域（模型调用可在客户网络内闭环）、审计日志本地留存、无外呼（除用户显式开启遥测）。

## 11. 测试策略

| 类型 | 重点 |
|------|------|
| 单元 | 状态机（审批/任务）、权限矩阵（表驱动）、消息路由规则 |
| 集成 | 卡片↔审批流一致性、离线补拉/幂等去重、配额熔断 |
| E2E | Playwright 驱动桌面 Web 层：需求澄清→评审→任务→验收全链路 |
| 评测集 | 静默策略 1,000 组固定评测集，准确率 ≥ 95% 为发布门禁；智能体回复质量抽样人工打分（每周） |
| 性能 | WS 压测 10k 连接/节点、消息 P95、客户端冷启动/内存基线（CI 回归） |
| 安全 | SAST + DAST + 第三方渗透（Phase 2 前）；AI 生成代码安全扫描门禁 |
| 兼容 | Win10/11 WebView2、macOS 12+；320/768/1024/1440 布局巡检（窗口尺寸） |

## 12. 里程碑与研发任务映射

| PRD 阶段 | 技术交付物 |
|----------|-----------|
| Phase 1（MVP） | Tauri 壳 + 三栏工作台；Go 网关/平台（组织/权限/聊天/审计/单节点审批）；TS 编排层（消息路由+静默策略、Ta-PM/Ta-Architect/Ta-Fullstack/Ta-QA）；Model Gateway（路由/配额/计量）；SQLite 离线同步；评测集体系上线 |
| Phase 2 | 多级审批引擎（会签/或签/转办/超时升级）；统一任务看板；CI/CD 集成与安全门禁；技能包系统（热加载+沙箱）；企业知识库（pgvector）；私有化安装器；等保三级评测 |
| Phase 3 | ABAC、技能包商店、开放 API、行业模板库、混合部署运营体系 |

## 13. 技术风险与备选

| 风险 | 等级 | 备选/缓解 |
|------|------|-----------|
| WebView 兼容性（Win10 企业基线） | 中 | 安装器静默装 WebView2；保留 Electron 分支方案 |
| 多模型适配成本（供应商 SDK 差异） | 中 | 统一 OpenAI-compatible 优先；Anthropic/国产适配器各一，接口收敛为 `chat(stream)` 单一抽象 |
| 审批引擎复杂度蔓延 | 中 | MVP 严格单节点；P1 只实现 BPMN 子集，超集需求转定制服务 |
| 私有化安装/运维成本 | 中 | 起步包单二进制化（Go 服务合并）；远程运维通道（客户授权） |
| 编排层长任务资源泄漏 | 中 | 任务级容器强制超时销毁；步数/token 上限 |
| WS 网关规模瓶颈 | 低 | 网关无状态，Redis 扇出；单节点 10k 压测验证后再加节点 |

## 14. 开放技术问题

| # | 问题 | 建议 |
|---|------|------|
| T1 | 语音转写供应商（成本 vs 私有化） | MVP 云 ASR；私有化本地 Whisper 列入 P1 |
| T2 | 记忆文档检索是否引入向量库 | P2 引入 pgvector（先做全文检索） |
| T3 | 客户端升级策略 | 强制更新 + 灰度渠道；版本不兼容时降级只读 |
| T4 | 是否提供浏览器 Web 端 | P3 评估；架构上 gateway 已与桌面解耦，成本低 |
| T5 | 智能体回复流式渲染粒度 | 消息级流式（卡片整体渲染，不做 token 级打字机） |

---

**结论**：本方案以「IM 主链路稳定、智能体链路可控、模型可插拔、私有化可落地」为四条架构主线，Phase 1 的技术工作量集中在 Go 平台服务与 TS 编排层；风险最高的两个点（静默策略准确率、AI 代码安全）均已设计评测集与门禁机制兜底。
