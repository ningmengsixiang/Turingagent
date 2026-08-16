# Turing Agent 部署运维手册

## 1. 架构与端口
- 四服务：db (postgres:16) / minio (S3 :9000，控制台 :9001) / gateway (Fastify :3001) / web (nginx :80 反代 /api /ws)
- 生产 Compose：`deploy/prod/`；K8s：`deploy/k8s/`

## 2. 生产部署（Docker Compose）
1. `cd deploy/prod && cp .env.example .env`，编辑必填：JWT_SECRET（≥32 字符强随机）/ MODEL_API_KEY / POSTGRES_PASSWORD（≥8）/ MINIO_ROOT_PASSWORD（≥8）
2. `./install.sh`（校验 → 构建镜像 → 启动 → 健康检查 → 输出访问地址）
3. 验证：`curl localhost:8080/api/v1/auth/login -X POST -H 'content-type: application/json' -d '{"username":"admin"}'`（200）
4. K8s：`cd deploy/k8s && IMAGE_PREFIX=your-registry/ta- TA_HOST=ta.example.com MODEL_API_KEY=xxx ./install.sh`
5. 可选环境变量：`ESCALATION_CRON`（审批超时自动升级定时器，默认每小时 `0 * * * *`）、`EXTERNAL_RATE_LIMIT`（开放 API 限流，默认 60 次/分钟/key）、`WEB_PORT`/`GATEWAY_PORT`（默认 8080/3001，端口默认绑定 127.0.0.1 仅本机访问）

## 3. 健康检查
- `GET /healthz` → `{"status":"ok"}`（无鉴权，供 LB/探针）
- Compose healthcheck：db pg_isready / gateway login 探测 / web depends_on

## 4. 备份与恢复
- 数据库：`docker compose -f deploy/prod/docker-compose.prod.yml exec db pg_dump -U ta ta_prod > backup.sql`
- 恢复：`docker compose ... exec -T db psql -U ta ta_prod < backup.sql`
- 对象存储：MinIO 数据卷 `ta-prod-minio-data`（备份目录即可，或 mc mirror）
- 建议：每日 pg_dump + 卷快照；备份验证（恢复演练）季度一次

## 5. 升级
1. 拉新代码 → `docker compose -f deploy/prod/docker-compose.prod.yml build`（gateway/web 镜像）
2. `docker compose ... up -d`（迁移自动执行——gateway 启动前 `node lib/migrate.js`）
3. 验证 `/healthz` + 登录 + 一条消息
4. 回滚：`git checkout <旧版本>` + 重建镜像 + up -d（迁移为幂等增量，向前兼容）

## 6. 故障排查
- 容器状态：`docker compose ... ps` / `docker compose ... logs --tail=100`
- gateway 未健康：查 `docker compose ... logs gateway`（迁移失败/DB 连接/模型 key 缺失）
- web 反代 502：gateway 未就绪（depends_on healthcheck 未过）
- 配额熔断：`POST /api/v1/org/quota {budget}` 调额（管理员）
- 租户停用误操作：`POST /api/v1/org/tenants/:id/suspend` 后可恢复（DB 直接 UPDATE tenants SET status='active'）

## 7. 安全基线
- 必须：强 JWT_SECRET / 修改默认密码 / HTTPS（TLS 终止于反代或 ingress）/ 端口绑 127.0.0.1 或防火墙
- 开放 API：X-API-Key 仅 HTTPS 传输；默认限流 60 次/分钟/key（`EXTERNAL_RATE_LIMIT` 可调）
- 审计：`audit_events` 表 append-only（审批/配额/租户/API Key 等操作留痕）
- 生产加固后续：RLS 双保险 / 多副本限流（Redis）/ 密钥管理（KMS）

## 8. 监控建议（后续）
- Prometheus 指标端点 / 日志采集 / 告警（gateway 健康、配额 80%、审批超时升级）
