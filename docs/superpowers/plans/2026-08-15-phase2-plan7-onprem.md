# Phase 2 · 计划 18：私有化一键安装器（M2.5 部分）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地私有化一键安装器（M2.5/TechDesign onprem/）：生产版 Docker Compose（db + minio + gateway + web 静态服务，镜像化）+ `install.sh`（环境变量校验 → compose up → 健康检查 → 输出访问地址）+ `.env.example`（密钥/端口/模型配置）。Tauri 桌面壳（GUI 环境）与 K8s 安装器记 Phase 2 后续。

**Architecture:** 新增 `deploy/prod/`：`docker-compose.prod.yml`（db/minio/gateway/web 四服务，gateway 用 node:22-alpine 构建产物 + web 用 nginx:alpine 托管 dist，env 注入）+ `install.sh`（bash：检查 docker/环境变量 → 生成 .env → compose up -d → 健康检查 gateway → 打印地址）+ `.env.example`。web 的 nginx 反代 `/api` `/ws` → gateway（配置 `nginx.conf`）。数据持久化卷 + 备份提示。

**Tech Stack:** Docker Compose + nginx:alpine + node:22-alpine + bash install.sh。零代码改动（复用现有 gateway/web 构建产物）。

**决策记录：** 生产镜像用多阶段构建（web: node 构建 dist → nginx 托管；gateway: node 构建 lib → 精简运行镜像）——需在 `deploy/prod/` 放 `Dockerfile.web`/`Dockerfile.gateway`；安装器先做「Compose 起步」（TechDesign onprem/ 明确 Compose 起步 → K8s 后续）；环境变量（JWT_SECRET/MODEL_API_KEY/MINIO_*/端口）从 .env 注入，JWT_SECRET 必须强密钥（gateway config 已校验 ≥32 字符）；healthcheck 对齐 CI 经验（minio 无 curl，用 bash /dev/tcp；postgres pg_isready）；数据卷命名与 dev 隔离（ta-prod-*）；安装器不包含模型 key 默认值（必填，防误配）；Tauri 桌面壳（M2.5 另一半）与 K8s 安装器记 Phase 2 后续。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `deploy/prod/docker-compose.prod.yml` | 创建 | 四服务生产编排 |
| `deploy/prod/Dockerfile.web` | 创建 | web 多阶段构建（node→nginx） |
| `deploy/prod/nginx.conf` | 创建 | nginx 托管 dist + 反代 /api /ws |
| `deploy/prod/Dockerfile.gateway` | 创建 | gateway 多阶段构建（node→node:22-alpine） |
| `deploy/prod/install.sh` | 创建 | 一键安装脚本 |
| `deploy/prod/.env.example` | 创建 | 环境变量模板 |
| `README.md` | 修改 | 私有化部署说明 |

---

## Task 1: 生产 Dockerfile + nginx

**Files:**
- Create: `deploy/prod/Dockerfile.web`
- Create: `deploy/prod/nginx.conf`
- Create: `deploy/prod/Dockerfile.gateway`

- [ ] **Step 1: Dockerfile.web**

创建 `deploy/prod/Dockerfile.web`：

```dockerfile
# 多阶段构建：node 构建 web dist → nginx 托管
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/contracts/ packages/contracts/
COPY apps/web/ apps/web/
RUN pnpm --filter @ta/contracts build && pnpm --filter @ta/web build

FROM nginx:alpine
COPY deploy/prod/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 2: nginx.conf**

创建 `deploy/prod/nginx.conf`：

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location /api/ {
    proxy_pass http://gateway:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /ws {
    proxy_pass http://gateway:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  location / {
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 3: Dockerfile.gateway**

创建 `deploy/prod/Dockerfile.gateway`：

```dockerfile
# 多阶段构建：node 构建 gateway lib → 精简运行镜像
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY services/gateway/package.json services/gateway/
RUN pnpm install --frozen-lockfile
COPY packages/contracts/ packages/contracts/
COPY services/gateway/ services/gateway/
RUN pnpm --filter @ta/contracts build && pnpm --filter @ta/gateway build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build /app/packages/contracts/lib /app/packages/contracts/lib
COPY --from=build /app/services/gateway/package.json /app/services/gateway/package.json
COPY --from=build /app/services/gateway/lib /app/services/gateway/lib
COPY --from=build /app/services/gateway/migrations /app/services/gateway/migrations
COPY --from=build /app/services/gateway/skills /app/services/gateway/skills
# 迁移 001-011 在启动时由 entrypoint 执行（避免容器内 tsx；用编译产物直接跑 SQL）
COPY --from=build /app/services/gateway/lib/migrate.js /app/services/gateway/lib/migrate.js
WORKDIR /app/services/gateway
EXPOSE 3001
CMD ["node", "lib/index.js"]
```

> 注：迁移执行需容器启动时应用——若 `lib/migrate.js` 编译产物可独立跑（`node lib/migrate.js`），用 entrypoint 包装；若依赖 tsx，则改为在 install.sh 中先跑迁移容器或加 entrypoint.sh。**实现时以实际构建产物为准**：gateway 的 migrate 脚本 build 后是 `lib/migrate.js`（tsc 编译 src/migrate.ts）——确认其可 `node lib/migrate.js` 运行（读 tsconfig.build.json 的 rootDir/outDir 与 migrate.ts 的 DB URL 来源——DATABASE_URL env）。若可行，compose 中 gateway 服务加 `command: sh -c "node lib/migrate.js && node lib/index.js"`（不用额外 entrypoint 文件）。

- [ ] **Step 4: 本地验证 Dockerfile 逻辑（可选，不强制构建镜像）**

构建镜像需拉取 node/nginx 镜像（网络 + 时间），CI 中不自动构建（无 registry）。本任务验证：
- 读 `services/gateway/tsconfig.build.json` 确认 build 输出含 migrate.js（`tsc -p tsconfig.build.json` 输出 lib/ 含 index.js/migrate.js）。
- 确认 `lib/migrate.js` 可用 `node lib/migrate.js` 直接跑（DATABASE_URL env 来源——读 src/migrate.ts）。

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/gateway build
ls services/gateway/lib/ | head
node services/gateway/lib/migrate.js 2>&1 | head -2
```

Expected: lib/ 含 index.js/migrate.js；migrate.js 可跑（无 tsx 依赖）。

- [ ] **Step 5: 提交**

```bash
git add deploy/prod/Dockerfile.web deploy/prod/nginx.conf deploy/prod/Dockerfile.gateway
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(deploy): 生产 Dockerfile（web nginx 托管/gateway 多阶段）+ nginx 反代"
```

---

## Task 2: 生产 compose + .env.example

**Files:**
- Create: `deploy/prod/docker-compose.prod.yml`
- Create: `deploy/prod/.env.example`

- [ ] **Step 1: docker-compose.prod.yml**

创建 `deploy/prod/docker-compose.prod.yml`：

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: ta-prod-db
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-ta}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-ta_prod}
    ports:
      - "127.0.0.1:${PG_PORT:-5432}:5432"
    volumes:
      - ta-prod-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-ta} -d ${POSTGRES_DB:-ta_prod}"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    container_name: ta-prod-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-taadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    ports:
      - "127.0.0.1:${MINIO_PORT:-9000}:9000"
      - "127.0.0.1:9001:9001"
    volumes:
      - ta-prod-minio-data:/data

  gateway:
    build:
      context: ../..
      dockerfile: deploy/prod/Dockerfile.gateway
    container_name: ta-prod-gateway
    depends_on:
      db:
        condition: service_healthy
      minio:
        condition: service_started
    environment:
      NODE_ENV: production
      PORT: 3001
      JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://${POSTGRES_USER:-ta}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-ta_prod}
      MODEL_API_KEY: ${MODEL_API_KEY}
      MODEL_PROVIDER: ${MODEL_PROVIDER:-deepseek}
      MODEL_NAME: ${MODEL_NAME:-deepseek-chat}
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: ${MINIO_ROOT_USER:-taadmin}
      MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      MINIO_BUCKET: ${MINIO_BUCKET:-ta-files}
    ports:
      - "127.0.0.1:${GATEWAY_PORT:-3001}:3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: sh -c "node lib/migrate.js && node lib/index.js"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{\"username\":\"probe\"}'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 10

  web:
    build:
      context: ../..
      dockerfile: deploy/prod/Dockerfile.web
    container_name: ta-prod-web
    depends_on:
      gateway:
        condition: service_healthy
    ports:
      - "${WEB_PORT:-8080}:80"

volumes:
  ta-prod-pgdata:
  ta-prod-minio-data:
```

> 注：gateway 挂载 docker.sock 是 Phase 2 后续「代码沙箱/部署联动」预留——**本计划移除该挂载**（YAGNI），保留 ports 绑定 127.0.0.1（仅本机访问，防暴露）。实现时按此精简：删除 volumes docker.sock 行。

- [ ] **Step 2: .env.example**

创建 `deploy/prod/.env.example`：

```bash
# Turing Agent 私有化安装配置（复制为 .env 后修改）

# 必填：JWT 签名密钥（≥32 字符）
JWT_SECRET=change-me-to-a-strong-secret-32chars-min

# 必填：模型 API Key（DeepSeek 或 OpenAI 兼容）
MODEL_API_KEY=

# 可选：模型配置
MODEL_PROVIDER=deepseek
MODEL_NAME=deepseek-chat

# 必填：数据库密码（生产环境必须修改）
POSTGRES_PASSWORD=ta-prod-secure-password

# 必填：MinIO 密码（≥8 字符，生产环境必须修改）
MINIO_ROOT_PASSWORD=ta-prod-minio-secure

# 可选：端口（默认 8080/3001/5432/9000，127.0.0.1 绑定仅本机访问）
WEB_PORT=8080
GATEWAY_PORT=3001
PG_PORT=5432
MINIO_PORT=9000

# 可选：数据库名/桶名
POSTGRES_DB=ta_prod
MINIO_BUCKET=ta-files
```

- [ ] **Step 3: 验证 compose 语法**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/prod/docker-compose.prod.yml config >/dev/null && echo "compose config OK" || echo "compose 语法错误（需修复）"
```

Expected: `docker compose config` 通过（无 .env 时用默认值；POSTGRES_PASSWORD 未定义会警告——config 阶段不校验 env 值，仅校验 YAML/插值语法；若报错，按报错修 YAML）。

- [ ] **Step 4: 提交**

```bash
git add deploy/prod/docker-compose.prod.yml deploy/prod/.env.example
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(deploy): 生产 compose（db/minio/gateway/web）+ .env.example"
```

---

## Task 3: install.sh

**Files:**
- Create: `deploy/prod/install.sh`

- [ ] **Step 1: 写 install.sh**

创建 `deploy/prod/install.sh`：

```bash
#!/usr/bin/env bash
# Turing Agent 私有化一键安装器（Docker Compose 起步，M2.5）
# 用法：./install.sh  [或 bash install.sh]
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Turing Agent 私有化安装器 ==="

# 1. 前置检查
command -v docker >/dev/null 2>&1 || { echo "❌ 需要 Docker（https://docs.docker.com/get-docker/）"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ 需要 docker compose 插件"; exit 1; }

# 2. 环境变量
if [ ! -f .env ]; then
  echo "⚠️ 未找到 .env，从 .env.example 创建（请编辑必填项）"
  cp .env.example .env
  echo "📝 请编辑 deploy/prod/.env 设置 JWT_SECRET / MODEL_API_KEY / 数据库与 MinIO 密码后重新运行"
  exit 1
fi

# 必填项校验
JWT_SECRET=$(grep -E '^JWT_SECRET=' .env | head -1 | cut -d= -f2- || true)
MODEL_API_KEY=$(grep -E '^MODEL_API_KEY=' .env | head -1 | cut -d= -f2- || true)
POSTGRES_PASSWORD=$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2- || true)
MINIO_ROOT_PASSWORD=$(grep -E '^MINIO_ROOT_PASSWORD=' .env | head -1 | cut -d= -f2- || true)

[ "${#JWT_SECRET}" -ge 32 ] || { echo "❌ JWT_SECRET 需 ≥32 字符（编辑 .env）"; exit 1; }
[ -n "$MODEL_API_KEY" ] || { echo "❌ MODEL_API_KEY 必填（编辑 .env）"; exit 1; }
[ -n "$POSTGRES_PASSWORD" ] && [ "${#POSTGRES_PASSWORD}" -ge 8 ] || { echo "❌ POSTGRES_PASSWORD 必填且 ≥8 字符"; exit 1; }
[ -n "$MINIO_ROOT_PASSWORD" ] && [ "${#MINIO_ROOT_PASSWORD}" -ge 8 ] || { echo "❌ MINIO_ROOT_PASSWORD 必填且 ≥8 字符"; exit 1; }
[ "$JWT_SECRET" != "change-me-to-a-strong-secret-32chars-min" ] || { echo "❌ 请修改 JWT_SECRET（不要用示例值）"; exit 1; }

echo "✅ 环境变量校验通过"

# 3. 构建并启动
echo "🔨 构建镜像（首次较慢）..."
docker compose -f docker-compose.prod.yml build

echo "🚀 启动服务..."
docker compose -f docker-compose.prod.yml up -d

# 4. 健康检查
WEB_PORT=$(grep -E '^WEB_PORT=' .env | head -1 | cut -d= -f2- || echo 8080)
echo "⏳ 等待服务健康（最多 60s）..."
for i in $(seq 1 30); do
  if curl -sf -X POST "http://localhost:${WEB_PORT}/api/v1/auth/login" \
    -H 'content-type: application/json' -d '{"username":"probe"}' >/dev/null 2>&1; then
    echo "✅ 服务已就绪（${i}x2s）"
    break
  fi
  sleep 2
  [ "$i" -eq 30 ] && { echo "❌ 健康检查超时，请查看 docker compose logs"; docker compose -f docker-compose.prod.yml logs --tail=50; exit 1; }
done

echo ""
echo "=== 安装完成 ==="
echo "Web 访问：http://localhost:${WEB_PORT}"
echo "MinIO 控制台：http://localhost:9001（taadmin / .env 中 MINIO_ROOT_PASSWORD）"
echo "数据卷：ta-prod-pgdata / ta-prod-minio-data（备份提示：docker compose -f docker-compose.prod.yml exec db pg_dump -U ta ta_prod > backup.sql）"
```

- [ ] **Step 2: 校验脚本**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
bash -n deploy/prod/install.sh && echo "install.sh 语法 OK"
chmod +x deploy/prod/install.sh
```

Expected: `bash -n` 通过（语法校验，不执行）。

- [ ] **Step 3: 提交**

```bash
git add deploy/prod/install.sh
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(deploy): 一键安装器 install.sh（校验/构建/启动/健康检查）"
```

---

## Task 4: README + 全仓验收 + 推送

- [ ] **Step 1: README 追加「私有化部署」节**

在 README「### 企业知识库（FR-MEM-03）」节之后追加：

```markdown
### 私有化部署（M2.5）

一键安装器：`cd deploy/prod && cp .env.example .env`（编辑必填项：JWT_SECRET/MODEL_API_KEY/密码）→ `./install.sh`（构建镜像 → compose 启动 → 健康检查 → 输出访问地址）。生产 compose 含 db/minio/gateway/web 四服务（web 由 nginx 托管并反代 /api /ws），端口默认绑定 127.0.0.1（仅本机访问）。数据卷 ta-prod-* 持久化；备份：`docker compose -f docker-compose.prod.yml exec db pg_dump -U ta ta_prod > backup.sql`。Tauri 桌面壳与 K8s 安装器记后续。
```

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
bash -n deploy/prod/install.sh
docker compose -f deploy/prod/docker-compose.prod.yml config >/dev/null
```

Expected: build 全过；test 全绿（contracts 2 + gateway 177 + web 34 ≈ 213）；frozen-lockfile 通过；eval:silence 门禁通过；install.sh 语法 OK；compose config 通过；`git status` 干净（除 README/计划文档）。

- [ ] **Step 3: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan7-onprem.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 18 全部勾选 + README 私有化部署说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：M2.5（私有化）→ install.sh + 生产 compose（Compose 起步，TechDesign onprem/）；「Docker Compose 一键安装器」→ Task 2/3；数据持久化/备份 → volumes + pg_dump 提示；「Tauri 桌面壳」→ 记后续（需 GUI 环境）。FR-SEC-01（密钥）→ JWT_SECRET ≥32 校验 + 端口 127.0.0.1 绑定 + .env 必填校验。
- **占位符扫描**：无 TBD；文件逐字给出。
- **类型一致性**：gateway 镜像需 `lib/migrate.js` 可跑（Task 1 Step 4 验证）；compose env 变量与 config.ts 的 env 名一致（DATABASE_URL/MODEL_API_KEY/MINIO_*/JWT_SECRET/PORT）；web 反代路径与前端 client.ts 的 `/api` 前缀一致。
- **已知取舍**：镜像构建不在 CI 自动执行（无 registry；本地 install.sh 构建）；docker.sock 挂载移除（沙箱/部署联动记后续）；端口 127.0.0.1 绑定（生产暴露需反代/TLS 记后续）；K8s 安装器/Tauri 桌面壳记 Phase 2 后续。
