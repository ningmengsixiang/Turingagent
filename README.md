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
