#!/usr/bin/env bash
# Turing Agent K8s 一键安装器（M2.5 K8s 扩展）
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== Turing Agent K8s 安装器 ==="
command -v kubectl >/dev/null 2>&1 || { echo "❌ 需要 kubectl"; exit 1; }
kubectl cluster-info >/dev/null 2>&1 || { echo "❌ 无法连接集群（kubectl cluster-info 失败）"; exit 1; }

# 配置
IMAGE_PREFIX="${IMAGE_PREFIX:-localhost:5000/ta-}"
HOST="${TA_HOST:-ta.example.com}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-$(openssl rand -hex 16)}"
MODEL_API_KEY="${MODEL_API_KEY:?MODEL_API_KEY 必填（模型 API Key）}"

[ "${#JWT_SECRET}" -ge 32 ] || { echo "❌ JWT_SECRET 需 ≥32 字符"; exit 1; }

echo "✅ 配置校验通过（镜像前缀: $IMAGE_PREFIX，host: $HOST）"

# 生成 secret（base64；tr -d '\n' 防止 GNU/BSD base64 默认 76 列折行破坏单行 YAML）
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
sed -e "s|REPLACE_ME_JWT_SECRET|$(b64 "$JWT_SECRET")|" \
    -e "s|REPLACE_ME_PG_PASSWORD|$(b64 "$POSTGRES_PASSWORD")|" \
    -e "s|REPLACE_ME_MINIO_PASSWORD|$(b64 "$MINIO_ROOT_PASSWORD")|" \
    -e "s|REPLACE_ME_MODEL_API_KEY|$(b64 "$MODEL_API_KEY")|" \
    secret.yaml | kubectl apply -f - >/dev/null

echo "✅ secret 已应用"

# 应用清单（替换镜像前缀与 host）
for f in namespace.yaml configmap.yaml postgres.yaml minio.yaml gateway.yaml web.yaml ingress.yaml; do
  sed -e "s|REPLACE_IMAGE_PREFIX|$IMAGE_PREFIX|g" -e "s|REPLACE_HOST|$HOST|g" "$f" | kubectl apply -f - >/dev/null
  echo "  应用 $f"
done

echo "⏳ 等待就绪（最长 120s）..."
kubectl -n ta-prod wait --for=condition=available --timeout=120s deployment/ta-web deployment/ta-gateway
kubectl -n ta-prod rollout status --timeout=120s statefulset/ta-postgres || true

echo ""
echo "=== 安装完成 ==="
echo "访问：http://$HOST（Ingress）"
echo "MinIO 控制台：kubectl -n ta-prod port-forward svc/minio 9001:9001"
echo "数据：PVC ta-pgdata / ta-minio-data（10Gi）"
echo "提示：镜像需已推送到 $IMAGE_PREFIX（docker build 见 deploy/prod/Dockerfile.*）"
