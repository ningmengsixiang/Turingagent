# Turing Agent 设计系统（UI Kit 规范）

## 1. 设计原则
- 清晰优先：信息层级明确，操作可预期
- 克制的视觉：中性灰为主，品牌色点缀（不喧宾夺主）
- 一致节奏：4px 间距刻度 / 8px 网格对齐

## 2. 色板（Light Theme）
| Token | 值 | 用途 |
|---|---|---|
| `--ta-color-brand` | `#0071e3` | 主操作、链接、选中态 |
| `--ta-color-brand-hover` | `#0077ed` | 主按钮 hover |
| `--ta-color-brand-soft` | `#eaf3ff` | 品牌浅底（选中/标签） |
| `--ta-color-success` | `#34c759` | 成功、通过、完成 |
| `--ta-color-success-soft` | `#eaf9ee` | 成功浅底 |
| `--ta-color-danger` | `#ff3b30` | 危险、驳回、错误 |
| `--ta-color-danger-soft` | `#ffecec` | 危险浅底 |
| `--ta-color-warning` | `#ff9f0a` | 警示、阻塞 |
| `--ta-color-text-primary` | `#1d1d1f` | 主文本 |
| `--ta-color-text-secondary` | `#6e6e73` | 次级文本 |
| `--ta-color-text-tertiary` | `#8e8e93` | 弱化文本 |
| `--ta-color-border` | `#d2d2d7` | 边框/分隔线 |
| `--ta-color-border-soft` | `#e5e5ea` | 弱边框（卡片） |
| `--ta-color-bg` | `#ffffff` | 页面背景 |
| `--ta-color-bg-secondary` | `#f5f5f7` | 次级背景（气泡/输入区） |
| `--ta-color-bg-tertiary` | `#f0f0f5` | 面板底 |

## 3. 字体
- 系统字体栈：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- 字号阶梯：`--ta-font-xs: 11px / --ta-font-sm: 12px / --ta-font-md: 13px / --ta-font-lg: 15px / --ta-font-xl: 17px / --ta-font-2xl: 20px / --ta-font-title: 26px`
- 行高：正文 1.5，标题 1.3

## 4. 间距 / 圆角 / 阴影
- 间距（4px 基数）：`--ta-space-1: 4 / -2: 8 / -3: 12 / -4: 16 / -5: 20 / -6: 24 / -8: 32`
- 圆角：`--ta-radius-sm: 6 / -md: 10 / -lg: 14 / -full: 9999`
- 阴影：`--ta-shadow-sm`（卡片）、`--ta-shadow-md`（浮层）、`--ta-shadow-lg`（弹窗）
- 动效：`--ta-duration-fast: 150ms / normal: 200ms / slow: 300ms`；缓动 `cubic-bezier(0.4, 0, 0.2, 1)`

## 5. 组件规范（UI Kit）
- Button：primary（品牌实底）/ secondary（浅底）/ ghost（透明描边）/ danger / small；禁用 40% 不透明度
- Input：1px 边框 + focus 品牌色环（2px soft）
- Badge：胶囊形，soft 底 + 对应色文字（AI/状态/计数）
- Card：白底 + 1px border-soft + sm 阴影 + lg 圆角
- Modal：遮罩 rgba(0,0,0,0.4) + 白卡 + lg 圆角 + md 阴影
- Toast：右上角堆叠，success/danger/info 三态，300ms 自动消失
- Spinner：SVG 圆环旋转，品牌色
- Avatar：圆形，soft 底 + 首字母，AI 用品牌 soft
- Chip：胶囊小标签（技能包/成员）
- EmptyState：居中图标 + 次级文本
- ProgressBar：圆角轨道 + 品牌填充，warn(>80%) 橙色 / tripped 红色
- Skeleton：浅灰块渐隐动画（加载占位）

## 6. 布局规范
- 三栏工作台：侧栏 260px（会话列表）+ 主区弹性（消息流）+ 右侧面板 300px（可收起）
- 消息气泡：human 右侧品牌 soft 底、agent 左侧白底描边；AI 附蓝色 Badge
- 卡片（审批/任务）：白底卡片 + 状态 Badge + 操作按钮组
- 看板列：白底 + 列头计数 + 卡片拖拽高亮（dashed 品牌环）
