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
