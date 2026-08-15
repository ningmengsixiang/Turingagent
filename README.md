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
