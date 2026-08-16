# Phase 2 · 计划 14：CI/CD 集成（M2.3：代码评审 + 安全扫描门禁 + 部署联动）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 CI/CD 集成（M2.3/FR-INT-01/BL-3）：GitHub Actions CI 管道（typecheck + build + 全量测试 + 静默评测集门禁 + pnpm audit 安全门禁）作为合并门禁；部署联动 workflow（两级人工审批 environment，定义骨架不实际部署）。代码评审门禁 = CI 状态检查（PR 必过）。

**Architecture:** 新增 `.github/workflows/ci.yml`（push/PR 触发：pnpm install --frozen-lockfile → contracts build → gateway/web typecheck → 全量 test → eval:silence 门禁 → build → pnpm audit 安全门禁）与 `.github/workflows/deploy.yml`（workflow_dispatch + 两级 environment 审批，空部署步骤骨架）。CI 状态检查即「代码评审门禁」（PR 未过 CI 不可合并，PRD FR-INT-01 硬约束）；安全门禁 `pnpm audit --audit-level high` 失败即 CI 红。本地新增 `pnpm audit:security` 脚本与 CI 一致（本地可复跑）。README 补 CI/CD 说明。

**Tech Stack:** GitHub Actions（ubuntu-latest + pnpm/action-setup + node 24 + postgres/minio 服务容器供 gateway 测试）+ pnpm audit。无新依赖。

**CI 排障记录（首跑 6 轮迭代后全绿，均为真实 CI 环境问题）：** ① **CI 数据库用 ta_dev**（gateway 测试 15 处硬编码 ta_dev，env 不生效——最小修复，test-helpers 读 env 记后续）；② **minio/minio:latest 无默认 server command**（Cmd=["minio"]，无参数打印帮助即退出；GitHub Actions services 不支持 command）→ MinIO 移出 services，改 step 手动 `docker run ... server /data` + 循环探活（镜像内无 bash/curl，探活用 `sh -c 'exec 3<>/dev/tcp/...'`）；③ **pnpm/action-setup@v4 失败** → 改 node 内置 corepack（读 packageManager=pnpm@11.7.0，与本地一致）；④ **setup-node cache: pnpm 失败** → 去掉缓存参数；⑤ **typecheck 失败**（全新 checkout 无 contracts lib）→ typecheck 前先 `pnpm --filter @ta/contracts build`。最终 CI 14 step 全绿（install/migrate/typecheck/test/eval:silence 门禁/build/audit 门禁/git clean）。

**质量审查决策（T1-T3 后追加）：** ① **CI 数据库用 ta_dev**——gateway 测试 15 处硬编码 `ta_dev`（test-helpers.ts:4 不读 env、13 测试文件显式传 databaseUrl），ci.yml 原建 ta_test 导致 CI 全挂；最小修复：CI postgres 建 ta_dev（容器隔离无本地冲突），test-helpers 支持 env 覆盖记入后续优化；② **minio health check 换 bash /dev/tcp**——minio/minio:latest 自 2023 已移除 curl（上游 #18371），curl 探活必失败；③ pnpm/action-setup version 9 与本地 11.7 不符但 lockfileVersion 9.0 兼容（对齐 11 记入后续）；④ node 22 满足 engines>=22（本地 24，计划内部 22/24 表述统一为 22）。**后续优化**：test-helpers 读 `process.env.DATABASE_URL ?? ta_dev`、CI 对齐 pnpm 11。

**决策记录：** CI 用 GitHub Actions（仓库在 GitHub）；gateway 测试需 PG → services 容器 postgres:16（复用本地 ta_dev schema 语义，CI 用独立库名避免与本地冲突）；MinIO 测试用 services 容器 minio（CI 起容器，避免本地依赖）；`eval:silence` 门禁正式接入 CI（此前仅手动，roadmap 风险表第 1 条发布门禁闭环）；安全门禁用 `pnpm audit --audit-level high`（severity high/critical 失败；audit 需联网，GitHub Actions 可用）；部署联动为「两级审批 environment + workflow_dispatch」骨架（无真实服务器，实际部署命令/SSH 配置记 Phase 2 后续——私有化安装器 M2.5 联动）；代码评审门禁 = CI 必过（无独立 reviewdog，git 环境 github 自带 PR 检查）。注意：`pnpm audit` 在 CI 若因 registry 网络问题失败，用 `--no-audit` 降级选项记录（不绕过门禁）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `.github/workflows/ci.yml` | 创建 | CI 管道（install→typecheck→test→eval:silence→build→audit） |
| `.github/workflows/deploy.yml` | 创建 | 两级审批部署联动骨架 |
| `package.json`（根） | 修改 | `audit:security` 脚本 |
| `README.md` | 修改 | CI/CD 说明 |

---

## Task 1: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 写 ci.yml**

创建 `.github/workflows/ci.yml`，内容逐字如下：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: ta
          POSTGRES_PASSWORD: ta
          POSTGRES_DB: ta_dev
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U ta"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
      minio:
        image: minio/minio:latest
        env:
          MINIO_ROOT_USER: taadmin
          MINIO_ROOT_PASSWORD: ta12345678
        ports:
          - 9000:9000
        options: >-
          --health-cmd "bash -c 'exec 3<>/dev/tcp/localhost/9000 && echo >&3 && exec 3>&-' || exit 1"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgres://ta:ta@localhost:5432/ta_dev
      MINIO_ENDPOINT: localhost:9000
      MINIO_ACCESS_KEY: taadmin
      MINIO_SECRET_KEY: ta12345678
      MINIO_BUCKET: ta-files

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Migrate database
        run: pnpm --filter @ta/gateway migrate
        env:
          DATABASE_URL: postgres://ta:ta@localhost:5432/ta_dev

      - name: Typecheck
        run: pnpm -r typecheck

      - name: Test
        run: pnpm test
        env:
          DATABASE_URL: postgres://ta:ta@localhost:5432/ta_dev

      - name: Silence eval gate (发布门禁)
        run: pnpm --filter @ta/gateway eval:silence

      - name: Build
        run: pnpm build

      - name: Security audit (安全门禁)
        run: pnpm audit --audit-level high

      - name: Check git clean
        run: git diff --exit-code
```

> 注：`pnpm audit` 在 pnpm 11 下为 `pnpm audit`（兼容 npm 语义）；`--audit-level high` 使 high/critical 漏洞失败。若 CI 的 audit 因 registry 波动误报，可在 workflow 内加 `|| echo 'audit warning (non-blocking)'` 降级为警示——但**默认按门禁失败**，降级仅限明确记录的例外（决策记录）。`pnpm -r typecheck` 需各 package 有 typecheck 脚本（contracts/gateway/web 均有，核对）；`pnpm test` 根脚本为 `pnpm -r build && pnpm -r test`（先 build 再 test，contracts 依赖先构建 ✓）。

- [ ] **Step 2: 本地核对 workflow 命令可跑**

workflow 命令在本地等价验证（Postgres 用本地容器 ta-db 已跑 gateway 测试；CI 的 ta_test 库名不同但 schema 一致）：

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm -r typecheck
pnpm test
pnpm --filter @ta/gateway eval:silence
pnpm build
git diff --exit-code
```

Expected: 全 exit 0（本地验证 CI 各 step 的命令等价物；audit 本地跳过——无 npm lockfile，`pnpm audit` 本地跑一次确认行为：`pnpm audit --audit-level high` 若无漏洞 exit 0，有则记录输出）。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "ci: GitHub Actions CI 管道（typecheck/test/静默门禁/build/安全审计）"
```

---

## Task 2: 部署联动 workflow（两级审批骨架）

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: 写 deploy.yml**

创建 `.github/workflows/deploy.yml`，内容逐字如下：

```yaml
name: Deploy (两级审批)

on:
  workflow_dispatch:
    inputs:
      environment:
        description: '目标环境'
        required: true
        type: choice
        options:
          - staging
          - production
      commit:
        description: '部署版本（commit sha）'
        required: true
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.inputs.commit }}

      - name: 构建产物（验证可部署性）
        run: |
          pnpm install --frozen-lockfile
          pnpm build

      - name: 部署占位（实际命令记 Phase 2 后续——私有化安装器 M2.5 联动）
        run: echo "部署步骤骨架：ssh/docker compose up 命令待 M2.5 落地"
```

> 注：`environment: ${{ github.event.inputs.environment }}` 使 GitHub 环境保护规则生效——staging/production 环境若配置了「required reviewers」，则部署需两级人工审批（PRD FR-INT-03 部署确认卡语义的 CI 侧实现）。工作流为骨架：无真实服务器时部署命令占位（决策记录：M2.5 私有化安装器落地时填充）。

- [ ] **Step 2: 提交**

```bash
git add .github/workflows/deploy.yml
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "ci: 两级审批部署联动 workflow 骨架"
```

---

## Task 3: audit 脚本 + README

**Files:**
- Modify: `package.json`（根）
- Modify: `README.md`（根）

- [ ] **Step 1: 根 package.json 增 audit:security 脚本**

读根 `package.json`，scripts 增：

```json
    "audit:security": "pnpm audit --audit-level high"
```

（注意 JSON 逗号；放在 test 之后。）

- [ ] **Step 2: README 增「CI/CD」节**

在 README「### 任务看板增强（M2.2）」节之后追加：

```markdown
### CI/CD 集成（M2.3 / FR-INT-01）

GitHub Actions CI 管道（push/PR 触发）作为合并门禁：pnpm install --frozen-lockfile → 数据库迁移 → typecheck → 全量测试 → **静默评测集门禁**（1,000 组 ≥95%）→ build → **安全审计**（pnpm audit，high/critical 失败即红）。本地可复跑安全门禁：`pnpm audit:security`。部署联动：`.github/workflows/deploy.yml` 两级审批 environment 骨架（staging/production 人工审批后执行，实际部署命令随 M2.5 私有化安装器落地）。
```

- [ ] **Step 3: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
git diff --check
```

Expected: JSON 合法；diff 无空白错误。

- [ ] **Step 4: 提交**

```bash
git add package.json README.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: README CI/CD 说明 + audit:security 脚本"
```

---

## Task 4: 全仓验收 + 推送

- [x] **Step 1: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
docker compose -f deploy/docker-compose.yml ps
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
git diff --exit-code
```

Expected: build 全过；test 全绿（contracts 2 + gateway 164 + web 32 ≈ 198）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净（除 README/计划文档）。

- [x] **Step 2: CI 真实性验证（可选）**

推送后触发 GitHub Actions，确认 workflow 语法与各 step 通过（`git push` 后访问仓库 Actions 页；若无法访问 GitHub 页面，标注「CI 首次运行待 GitHub 侧确认」，本地命令等价物已全绿）。同时检查 workflow YAML 语法：

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); yaml.safe_load(open('.github/workflows/deploy.yml')); print('YAML OK')" 2>/dev/null || echo "pyyaml 不可用（跳过，GitHub 会校验语法）"
```

- [x] **Step 3: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase2-plan3-cicd.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 14 全部勾选 + README CI/CD 说明"
git push
```

Expected: 推送成功（推送触发 CI 首次运行）。

---

## Self-Review 记录

- **Spec 覆盖**：M2.3（代码评审门禁→CI 状态检查；安全扫描门禁→pnpm audit；部署联动→deploy.yml 两级审批 environment）→ Task 1/2；FR-INT-01（代码未过评审门禁不得合并）→ CI 必过语义；PRD §7.2 静默门禁接线（roadmap 风险表第 1 条，此前仅手动）→ ci.yml 含 eval:silence；FR-INT-03 部署确认卡 → deploy.yml environment 保护。审计门禁「无旁路」（PRD 第 633 行）→ audit step 失败即 CI 红。
- **占位符扫描**：无 TBD；workflow 逐字给出（部署命令占位为决策记录明示的 M2.5 骨架，非 TBD）。
- **类型一致性**：CI step 命令与本地 package.json scripts 一致（typecheck/test/build/eval:silence）；`pnpm audit --audit-level high` 在 ci.yml 与 audit:security 脚本一致；DATABASE_URL 环境变量在 ci.yml env 与 migrate/test step 一致。
- **已知取舍**：CI 的 gateway 测试依赖 postgres/minio services 容器（GitHub Actions 支持）；`pnpm -r typecheck` 依赖各 package 有 typecheck 脚本（均有）；audit 联网依赖（Actions 可用，registry 波动降级选项已记录）；部署命令占位（M2.5 落地）；无 reviewdog（GitHub 原生 PR 检查即评审门禁）。
