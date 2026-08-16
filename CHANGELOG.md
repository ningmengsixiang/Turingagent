# Changelog

## v0.1.0 (2026-08-16) — 首次发布（MVP + 治理完整版）

### 功能
- IM 群聊：@提及、AI 身份标识、确认卡片、文件上传（MinIO）、语音转文字（Web Speech + 降级录音）、引用回复
- 智能体团队：Ta-PM/Ta-Architect/Ta-Fullstack/Ta-QA 四角色，静默策略（1,000 组评测集 ≥95% 发布门禁）
- 审批：单级 + 多级引擎（会签/或签/串行/转办/退回重提/撤销）+ 超时自动升级（cron）
- 记忆文档：自动沉淀/版本留痕/总结触发；企业知识库（全文检索）
- 任务看板：拖拽换状态/统计瓦片/日报周报
- 组织治理：部门/ABAC 行级权限/多租户隔离/操作审计
- 技能包：manifest 热加载/市场安装/配额熔断（80% 预警 + 100% 熔断）
- 开放 API：API Key 管理/外部集成端点/限流

### 工程
- monorepo（contracts/gateway/web）；gateway Fastify + PG + MinIO；web React 19 + Vite
- CI/CD：GitHub Actions 全链路（typecheck/测试/静默门禁/安全审计）
- 部署：Docker Compose 一键安装器 + K8s 清单；DEPLOYMENT.md 运维手册
- 测试：239 用例（gateway 203 + web 34 + contracts 2）；生产镜像实测

### 上线就绪
- 优雅关闭（SIGTERM/SIGINT）；健康检查 /healthz；生产镜像构建验证
- 安全基线：强密钥校验/127.0.0.1 端口绑定/API 限流/审计留痕
