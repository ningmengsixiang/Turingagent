# Ta-Fullstack 软件生成智能体（原型 v1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DeepSeek Harness 上创建一个可运行的「Ta-Fullstack · 软件生成智能体」agent preset（从 shipped `standard` preset 复制而来，替换人设与元数据），使任何新会话选用该 preset 后，收到软件需求即可完成「澄清 → 需求基线 → 计划 → 实现 → 验证 → 交付」闭环并产出可运行代码。

**Architecture:** preset 本质是一份 agent-plane Cordis 组合（`agent.cordis.yml` + `preset.yml`），落位于用户级 preset 根 `~/.dsh/.agent-presets/ta-fullstack/`。工具集完全复用 `standard` 的现有行（bash / fs / skill / subagents / jobs / todo / web），**只替换 persona 提示词与展示元数据**，不新增任何服务行（避免 realm 与全局注册冲突）。生成的项目代码写入 `~/TuringAgent/ta-workspace/`（仓库 gitignore）。

**Tech Stack:** DeepSeek Harness agent preset（Cordis YAML 组合）；生成应用默认 Python FastAPI + SQLite + 原生 HTML/CSS/JS。

**设计文档：** `docs/superpowers/specs/2026-08-15-ta-fullstack-software-agent-design.md`

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `~/.dsh/.agent-presets/ta-fullstack/` | 创建（复制自 shipped `standard`） | preset 目录：组合 + 元数据 |
| `~/.dsh/.agent-presets/ta-fullstack/preset.yml` | 修改 | 展示元数据（name / description） |
| `~/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml` | 修改 | persona 提示词替换为 Ta-Fullstack 人设；其余行保持标准集 |
| `~/TuringAgent/ta-workspace/` | 运行时创建 | 生成的软件项目（不入库） |
| `.gitignore`（项目根） | 修改 | 追加 `ta-workspace/` |
| `docs/superpowers/plans/2026-08-15-ta-fullstack-software-agent.md` | 创建 | 本计划 |

**关键路径常量：**
- shipped `standard` preset：`/Users/wanzichanpinjingli/Desktop/TuringAgent/deepseek-harness/apps/cli/config/agent-presets/standard/`
- 用户 preset 根：`/Users/wanzichanpinjingli/.dsh/.agent-presets/`
- 工作区根：`/Users/wanzichanpinjingli/Desktop/TuringAgent/ta-workspace/`

---

## Task 1: 前置检查

**Files:**
- Read: `/Users/wanzichanpinjingli/Desktop/TuringAgent/deepseek-harness/apps/cli/config/agent-presets/standard/agent.cordis.yml`

- [ ] **Step 1: 确认 shipped `standard` preset 存在**

Run: `ls /Users/wanzichanpinjingli/Desktop/TuringAgent/deepseek-harness/apps/cli/config/agent-presets/standard/`
Expected: `agent.cordis.yml` 与 `preset.yml` 均在列表中。

- [ ] **Step 2: 确认用户 preset 根当前状态**

Run: `ls /Users/wanzichanpinjingli/.dsh/.agent-presets/ 2>/dev/null || echo "no user presets dir"`
Expected: `no user presets dir`（或仅列出已有用户 preset——若 `ta-fullstack` 已存在，先 `git` 之外确认它不是 shipped preset 且可安全删除，或改用未占用的 id）。

- [ ] **Step 3: 确认目标工作区根尚未存在（避免覆盖）**

Run: `ls -d /Users/wanzichanpinjingli/Desktop/TuringAgent/ta-workspace 2>/dev/null || echo "ok: workspace not yet created"`
Expected: `ok: workspace not yet created`（若已存在也接受，后续项目目录按 `ta-<name>-<date>` 命名不会冲突）。

---

## Task 2: 定义并运行探针插件 `preset-ops`

roster 服务 `agentPresets` 通过注入访问，会话内没有现成工具；按 skill 惯例挂一个临时 host 插件，注册三个只读/作者工具（`preset_list` / `preset_copy` / `preset_check`），用完即删。

**Files:**
- Create（动态）：pluginId 由 Host 分配，idPrefix 用 `pset`

- [ ] **Step 1: 定义插件（cordis_define）**

- `plugin.kind`: `new`，`idPrefix`: `pset`
- `name`: `preset-ops`
- `purpose`: `临时探针：复制/列出/校验 agent preset，用完即删`
- `code.host`（完整函数体）：

```js
return {
  name: 'preset-ops',
  inject: ['agentPresets', 'tools'],
  apply(ctx) {
    const tool = (name, description, parameters, fn) =>
      harness.registerTool(ctx, harness.defineTool({
        name,
        description,
        parameters,
        output: { schema: { type: 'string' }, render(_a, v) { return [{ type: 'text', text: v }] } },
        async execute(args) {
          try { return await fn(args) }
          catch (e) { return 'ERROR: ' + e.message }
        },
      }))

    tool('preset_list', 'List every agent preset with id, trust and path.',
      {},
      async () => {
        const all = await ctx.agentPresets.list()
        return all.map(p => `${p.id}\t${p.trust}\t${p.path}`).join('\n')
      })

    tool('preset_copy', 'Copy a shipped preset to a new locally authored preset id.',
      { from: { type: 'string', required: true }, id: { type: 'string', required: true }, name: { type: 'string', required: false } },
      async (a) => {
        await ctx.agentPresets.copy(a.from, a.id, a.name)
        const p = await ctx.agentPresets.resolve(a.id)
        return `copied: ${a.id} -> ${p.path} (trust=${p.trust})`
      })

    tool('preset_check', 'Mount-validate one preset by id (standingKeyFor).',
      { id: { type: 'string', required: true } },
      async (a) => {
        await ctx.agentPresets.standingKeyFor(a.id)
        return 'mounted OK'
      })
  },
}
```

Expected: cordis_define 返回 `pluginId` 与 `packageId`（记录下来，后续步骤使用）。

- [ ] **Step 2: 运行插件（cordis_run）**

Run: `cordis_run`，`pluginId`/`packageId` 取 Step 1 返回值，`mode: "run"`
Expected: 返回 `starting` 或直接成功；若返回 `awaiting-approval`，说明审批被拒（本会话审批已禁用，host 插件不应走审批），按失败处理并检查插件代码。

- [ ] **Step 3: 验证工具已注册（preset_list）**

Call: `preset_list`
Expected: 输出 shipped preset 行，形如：
```
standard	system	/Users/wanzichanpinjingli/Desktop/TuringAgent/deepseek-harness/apps/cli/config/agent-presets/standard/agent.cordis.yml
code	system	...
minimal	system	...
cordis	system	...
```
（`ta-fullstack` 此时还不应出现。）

---

## Task 3: 复制 `standard` → `ta-fullstack`

- [ ] **Step 1: 通过 roster 复制（preset_copy）**

Call: `preset_copy`，`{"from": "standard", "id": "ta-fullstack", "name": "Ta-Fullstack · 软件生成智能体"}`
Expected: `copied: ta-fullstack -> /Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml (trust=user)`
> 失败回退（仅当 roster 复制不可用时）：`cp -r /Users/wanzichanpinjingli/Desktop/TuringAgent/deepseek-harness/apps/cli/config/agent-presets/standard /Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack`，并手工把 `preset.yml` 的 `name` 改为目标名。

- [ ] **Step 2: 确认出现在 roster 中（preset_list）**

Call: `preset_list`
Expected: 新增一行 `ta-fullstack	user	/Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml`。

- [ ] **Step 3: 读取复制结果确认结构完整**

Run: `ls -la /Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/`
Expected: `agent.cordis.yml` 与 `preset.yml` 都在。

---

## Task 4: 写入元数据与 Ta-Fullstack 人设

**Files:**
- Modify: `/Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/preset.yml`
- Modify: `/Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml`

- [ ] **Step 1: 读取两个文件确认现状**

Run: `read /Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/preset.yml` 与 `read .../agent.cordis.yml`
Expected: `preset.yml` 含 `name: Ta-Fullstack · 软件生成智能体`（copy 已写入）与 standard 的 description；`agent.cordis.yml` 首行 persona 为 `You are a coding agent powered by the {{model}} model...`

- [ ] **Step 2: 覆写 preset.yml（完整内容）**

Write `/Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/preset.yml`:

```yaml
name: Ta-Fullstack · 软件生成智能体
description: 把软件需求变成完整可运行代码的软件生成智能体：一轮澄清 → 需求基线 → 计划 → 实现 → 验证 → 交付；默认 FastAPI + SQLite + 原生前端。
```

- [ ] **Step 3: 替换 agent.cordis.yml 的 persona 提示词**

用 edit 工具替换 `agent.cordis.yml` 中 persona 行。old_string 精确匹配：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: >-
      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
```

new_string（完整人设，`|` 字面块保留换行）：

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |
      你是 Ta-Fullstack，Turing Agent 的「软件生成智能体」。你的工作目录是 {{cwd}}。

      你的使命：把用户的软件需求变成完整可运行的代码交付物。你同时具备产品经理的澄清能力（Ta-PM）与全栈工程师的开发能力（Ta-Fullstack）。

      ## 身份与边界（硬约束，不得违反）
      - 你是 AI 智能体：所有回复明确以 AI 身份输出，绝不伪装成人类。
      - 人类审批闸门：你只建议、不决策。部署、上线、对外发布等动作必须得到用户明确确认后才执行。
      - 克制发言：不与任务无关不主动发言；只在关键节点（澄清完成 / 计划 / 交付 / 阻塞）汇报。
      - 成本可控：单个任务总步数上限 60 步；验证修复最多 3 轮；超限如实报告，不无限重试。
      - 只在你自己的 workspace（/Users/wanzichanpinjingli/Desktop/TuringAgent/ta-workspace/）内写代码，不修改工作区外文件（读取 PRD / 参考文档除外）。

      ## 默认技术栈（用户未指定时）
      - 后端：Python FastAPI + SQLite
      - 前端：原生 HTML/CSS/JS 单页（无构建步骤）
      - 依赖最少化，锁定版本写入 requirements.txt

      ## 工作流程（收到需求后依次执行，每步向用户简要汇报）
      1. 澄清：一轮精简提问（≤5 问，每题带默认建议：技术栈 / 目标用户 / 核心功能范围 / 验收要点）。用户答「按默认」即采用建议值。
      2. 需求基线：在项目目录写 REQUIREMENTS.md（需求陈述 + 假设记录 + 验收清单）。
      3. 计划：拆任务清单——数据模型 → API → 前端 → 测试。
      4. 实现：逐模块生成完整可运行代码（后端 / 前端 / 依赖清单 / README）。
      5. 验证：启动应用做健康检查 + curl 冒烟 + pytest 基础用例；失败自动修复（≤3 轮）。
      6. 交付：输出交付总结（运行方式 + 验收清单勾选结果 + 已知限制）；提交代码前征求用户确认（审批闸门）。

      ## 交付物四件套（每个项目必须齐全）
      - 代码仓库：/Users/wanzichanpinjingli/Desktop/TuringAgent/ta-workspace/ta-<项目名>-<日期>/
      - REQUIREMENTS.md
      - TEST_REPORT.md（实际执行的命令与结果）
      - README.md（本地一键运行方式）

      ## 异常处理
      - 依赖安装失败：换版本 / 换源重试 ≤2 次，仍失败则报告阻塞。
      - 应用无法启动：查日志修复 ≤3 轮，超限如实报告并给出最小复现。
      - 需求不明确到无法开工：明确列出缺失信息请用户补充，不臆造核心业务规则。
```

- [ ] **Step 4: 读回校验**

Run: `read /Users/wanzichanpinjingli/.dsh/.agent-presets/ta-fullstack/agent.cordis.yml`（前 40 行即可）
Expected: persona 行已替换为新文本；其余行（`tool-bash`、`tool-fs`、`delegation` 等）原样保留，未被误改。

---

## Task 5: 挂载校验（mount-validate）

- [ ] **Step 1: preset_check**

Call: `preset_check`，`{"id": "ta-fullstack"}`
Expected: `mounted OK`。
四种失败形态（出现任一即修复后重跑）：
1. `Cannot find package …` —— 复制的行引用了未安装包，不应发生（source 可挂载 ⇒ copy 可挂载）。
2. `invalid config: …` —— YAML 编辑破坏了某行配置，检查 persona 缩进（`text: |` 下内容必须缩进）。
3. `N row(s) did not activate: … waiting for <service>` —— 某消费行被移出 realm，不应发生（未动 realm）。
4. `published process-global service(s) …` —— 新增了服务行，不应发生（未新增行）。

---

## Task 6: 清理探针插件

探针是探测工具，不是要留下的能力，用完即删。

- [ ] **Step 1: 停止并删除插件**

Run: `cordis_stop`（pluginId 取 Task 2 返回值）→ 再 `cordis_undefine`（同 pluginId）
Expected: 均成功；`preset_list` / `preset_copy` / `preset_check` 工具从工具目录消失。

---

## Task 7: 仓库收尾与提交

**Files:**
- Modify: `/Users/wanzichanpinjingli/Desktop/TuringAgent/.gitignore`

- [ ] **Step 1: .gitignore 追加工作区目录**

Append 到 `/Users/wanzichanpinjingli/Desktop/TuringAgent/.gitignore`：

```
ta-workspace/
```

- [ ] **Step 2: 提交计划与收尾**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
git add docs/superpowers/plans/2026-08-15-ta-fullstack-software-agent.md .gitignore
git commit -m "docs: Ta-Fullstack 软件生成智能体实现计划；工作区不入库"
git push
```

Expected: 提交成功并推送到 `origin/main`。

---

## Task 8: 端到端验收（手动，需用户参与）

pre-set 只在实际会话中才显示最终智能体形态，最后一步必须由用户开一个新会话验证。

- [ ] **Step 1: 启动新会话**

在 DeepSeek Harness Web GUI 新建会话，选择 preset **Ta-Fullstack · 软件生成智能体**，确认工具列表含 bash / fs / skill / subagent / jobs / todo / web 等标准工具。

- [ ] **Step 2: 发送验收需求**

> 帮我做一个报销系统简化版：员工可以提交报销单（类型、金额、说明），部门负责人可以审批（通过 / 驳回），员工可以查看自己的报销历史和状态。技术栈按默认。

- [ ] **Step 3: 核对六步闭环**

| 检查点 | 期望 |
|---|---|
| 一轮澄清 | ≤5 问且每题带默认建议，答「按默认」可跳过 |
| 需求基线 | 项目内 `REQUIREMENTS.md` 含需求 + 假设 + 验收清单 |
| 代码生成 | `~/TuringAgent/ta-workspace/ta-reimbursement-<日期>/` 完整可运行 |
| 验证 | 应用能启动（健康检查 200）、curl 冒烟走通、`TEST_REPORT.md` 含真实命令输出 |
| 交付 | 交付总结含运行方式 + 验收勾选 + 已知限制 |
| 审批闸门 | 提交 / 上线类动作前征求用户确认 |

- [ ] **Step 4: 回报结果**

按上表逐项记录通过 / 不通过；不通过项作为修复输入回到对应 Task。

---

## Self-Review 记录（写完后自查）

- **Spec 覆盖**：spec §2 智能体定义 → Task 4 persona；§3 六步流程 → persona 流程段 + Task 8 验收；§4 交付物四件套 → persona 交付段 + Task 8；§5.1 preset 结构 → Task 2/3/4；§5.2 workspace → Task 7 + persona；§5.3 验证手段 → Task 8；§5.4 成本与安全 → persona 硬边界；§6 原型验收 → Task 8。
- **占位符扫描**：无 TBD/TODO；所有代码块完整。
- **类型一致性**：工具名 `preset_list` / `preset_copy` / `preset_check` 在 Task 2 定义、Task 3/5 调用，拼写一致；插件名 `preset-ops` 与 idPrefix `pset` 在 Task 2/6 一致；路径常量 Task 1–8 统一。
