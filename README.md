# Turing Agent（Ta）

企业 IM 聊天软件 + 内置智能体团队（Ta-PM / Ta-Architect / Ta-Fullstack / Ta-QA），专注软件开发「需求 → 澄清 → 评审 → 交付 → 验收」全流程。

- PRD：`TuringAgent.md` ｜ 技术方案：`TechDesign.md` ｜ 路线图：`docs/roadmap/`
- 交互原型：`prototype-static/`（浏览器直接打开）
- 产品文档与设计：`docs/`

## 开发

```bash
pnpm install        # 安装全部 workspace
pnpm build          # 构建全部包（contracts → gateway）
pnpm test           # 全仓测试
pnpm dev:gateway    # 启动网关开发服务器（默认 :3001）
```

### 本地依赖（PG）

```bash
docker compose -f deploy/docker-compose.yml up -d   # 启动 PostgreSQL 16（ta_dev 库，自动建 ta 角色）
pnpm --filter @ta/gateway migrate                    # 应用迁移（幂等）
```

> 网关集成测试需要本地 PG 运行（`postgres://ta:ta@localhost:5432/ta_dev`）；未启动会 fail fast。

### 消息引擎冒烟

```bash
# 登录 → 建会话 → 发消息 → 拉消息 → 标记已读
TOKEN=$(curl -s -X POST localhost:3001/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"alice"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s -X POST localhost:3001/api/v1/sessions -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"kind":"project","title":"报销系统","memberIds":["u-bob"]}'

curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/messages \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"clientMsgId":"m1","contentType":"text","content":"你好"}'

curl -s "localhost:3001/api/v1/sessions/<sessionId>/messages?after_seq=0" -H "authorization: Bearer $TOKEN"
```

### 审批与确认卡片

```bash
# 发起审批（approverId 必须是会话成员）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/approvals \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"上线审批","description":"报销系统上线","approverId":"u-bob"}'

# 审批人决策（通过/驳回；仅 approver 可决策）
curl -s -X POST localhost:3001/api/v1/approvals/<approvalId>/decide \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"decision":"approved"}'
# → 确认卡片消息实时更新状态（message.updated 经 WS 广播）
```

### 组织与治理

```bash
# 首个登录用户自动成为 admin；admin 可管理成员角色与查看审计
curl -s localhost:3001/api/v1/org/members -H "authorization: Bearer $TOKEN"
curl -s -X PATCH localhost:3001/api/v1/org/members/u-bob/role \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"role":"admin"}'
curl -s "localhost:3001/api/v1/org/audit?limit=20" -H "authorization: Bearer $TOKEN"
# → 登录/角色变更/审批决策全部留痕（append-only 审计）；最后一名 admin 不可被降级
```

### 任务卡（轻量看板）

```bash
# 创建任务（assignee 可为人类或智能体）→ 生成任务卡片消息
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"支付网关对接","assigneeId":"agent-ta-fullstack","assigneeKind":"agent"}'

# 流转状态（todo / in_progress / blocked / done）→ 卡片实时更新
curl -s -X PATCH localhost:3001/api/v1/tasks/<taskId>/status \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"status":"in_progress"}'

# 看板列表
curl -s localhost:3001/api/v1/sessions/<sessionId>/tasks -H "authorization: Bearer $TOKEN"
```

### 记忆文档

```bash
# 创建记忆（会话内讨论的沉淀）→ 编辑自动生成新版本（留痕可查）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/memories \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"需求基线","content":"报销系统需求基线 v1"}'

curl -s -X PUT localhost:3001/api/v1/memories/<memoryId> \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"content":"v2 更新内容"}'

curl -s localhost:3001/api/v1/memories/<memoryId>/versions -H "authorization: Bearer $TOKEN"
# → 版本历史 [v1, v2, …]，append-only 留痕

# 一键沉淀：LLM 摘要会话讨论为结构化记忆（需求/决策/待办/未决）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/memories/summarize \
  -H "authorization: Bearer $TOKEN"
# → 生成/更新「会话记忆 <日期>」，版本留痕；需配置 MODEL_API_KEY
```

### 群聊协作

```bash
# 会话成员列表（人类 + 四智能体）
curl -s localhost:3001/api/v1/sessions/<sessionId>/members -H "authorization: Bearer $TOKEN"

# 引用回复（replyTo = 被引消息 id；列表返回 replyPreview 摘要）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/messages \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"clientMsgId":"m2","contentType":"text","content":"引用回复","replyTo":"<被引消息id>"}'
```

### 任务看板

Web 右侧上下文面板提供会话任务看板：按状态（待开始/进行中/已阻塞/已完成）四列分组，点击卡片上的状态按钮流转，与聊天流中的任务卡实时同步；顶部统计瓦片展示总数/进行中/已完成/智能体任务占比。

### 文件上传

```bash
# 需要 MinIO（docker compose 已含；MINIO_* 环境变量可覆盖）
curl -s -X POST localhost:3001/api/v1/sessions/<sessionId>/files \
  -H "authorization: Bearer $TOKEN" -F "file=@<本地文件>"
# → 生成文件消息（contentType=file）；下载：GET /api/v1/files/<fileId> 返回 15 分钟预签名 URL
```

### 智能体团队（四角色）

网关内置模型网关（DeepSeek，OpenAI 兼容）。会话内 @ 对应智能体即触发，回复以该智能体身份实时推回：

| 智能体 | 触发 | 职责 |
|---|---|---|
| Ta-PM | `@Ta-PM <需求>` | 需求澄清与基线 |
| Ta-Architect | `@Ta-Architect <变更>` | 技术评审与影响评估 |
| Ta-Fullstack | `@Ta-Fullstack <需求>` | 软件生成与交付 |
| Ta-QA | `@Ta-QA <功能>` | 测试与验收 |

```bash
export MODEL_API_KEY=<你的 DeepSeek key>
pnpm dev:gateway
# 会话内发：@Ta-PM 帮我澄清报销需求 → Ta-PM 的回复实时出现在会话里
```

> 未配置 `MODEL_API_KEY` 时智能体自动禁用。`MODEL_BASE_URL` / `MODEL_NAME`（默认 `deepseek-chat`）可覆盖。

### 静默策略（FR-CHAT-05）

智能体仅在必要时机发言：`@提及` 必响应；无提及时由静默策略分类器判定——命中决策点（你定/选 A 还是 B/对比一下/审批）或项目关键词（打分 ≥3）→ 路由 Ta-PM 仲裁响应；闲聊静默（仅落库，零 LLM 成本）。

```bash
# 评测集门禁（1,000 组固定评测集，准确率 ≥95% 为发布门槛）
pnpm --filter @ta/gateway eval:silence
# 重新生成固定评测集（确定性，per-category seed）
pnpm --filter @ta/gateway gen:silence-cases
```

### 语音输入（FR-DESK-07 / FR-CHAT-01）

输入区 🎤 按住说话：实时转写（Web Speech API，Chrome/Edge）→ 松开以文字发送；转写失败或浏览器不支持 → 降级为语音文件消息（可下载播放，决策 D6）。需要 HTTPS 或 localhost（浏览器麦克风安全要求）。

### Web 前端

```bash
pnpm dev          # 并行起网关（:3001）+ Web（:5173）
# 浏览器打开 http://localhost:5173
# 登录（任意用户名）→ 新建项目群 → 发 @Ta-Fullstack <需求> → 智能体回复实时到达
```

> 首次 clone 后需先 `pnpm build`（构建 @ta/contracts 的 lib/）再 `pnpm dev`。

### 网关冒烟

```bash
curl localhost:3001/healthz
# {"status":"ok"}

curl -X POST localhost:3001/api/v1/auth/login -H 'content-type: application/json' -d '{"username":"alice"}'
# {"token":"<jwt>","user":{"id":"u-alice","name":"alice"}}

# WebSocket（token 从登录响应取）
# ws://localhost:3001/ws?token=<jwt>  → welcome → echo
```

## 结构

```
packages/contracts   共享类型契约（唯一事实来源）
services/gateway     网关：认证 / 健康检查 / WS
apps/                客户端（Phase 0 计划 4 落地）
```
