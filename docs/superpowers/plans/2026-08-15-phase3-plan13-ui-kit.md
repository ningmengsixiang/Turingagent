# Phase 3 · 计划 31：UI Kit 与设计系统

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立完整 UI Kit 与设计规范并落地全界面：Design Tokens（色板/字体/间距/圆角/阴影/动效）→ 可复用组件库（Button/Input/TextArea/Badge/Modal/Toast/Spinner/Avatar/EmptyState/Chip/ProgressBar/Skeleton）→ 全局基础样式（reset + tokens）→ 全页面视觉落地（登录页/三栏工作台/消息气泡/卡片/看板/面板/弹窗）。**保留现有类名与按钮文本**（不破坏 Chat/Login 测试 24 用例）。

**Architecture:** ① `apps/web/src/design/tokens.css`——CSS 自定义属性（Design Tokens：品牌/功能/中性色、字体阶梯、间距刻度、圆角、阴影、动效）；② `apps/web/src/ui/`——类型化 React 组件（`ui/Button.tsx`、`ui/Input.tsx`、`ui/Modal.tsx`、`ui/Badge.tsx`、`ui/Toast.tsx`、`ui/Spinner.tsx`、`ui/Avatar.tsx`、`ui/Chip.tsx`、`ui/EmptyState.tsx`、`ui/ProgressBar.tsx`、`ui/Skeleton.tsx` + 各自的 CSS 或统一 `ui/ui.css`），组件**保持页面现有 class 名**（渐进：先建组件，页面逐步替换内部实现而不改 DOM 语义）；③ `apps/web/src/app.css` 重构——保留全部既有类名选择器，改其样式引用 tokens，并追加新组件样式；④ 页面视觉落地：Login 页、Chat 三栏（sidebar/message-list/panel）、气泡（human/agent/卡片）、看板、知识库、技能包、配额条、弹窗。视觉规范源：`docs/design/DESIGN.md`（色板/字体/组件规范，作为 UI Kit 文档）。

**Tech Stack:** React 19 + TypeScript + 纯 CSS（CSS 自定义属性，零新依赖）。不引入 Tailwind/UI 库（保持轻量、可控、测试兼容）。

**决策记录：** 设计方向延续现有 Apple 风（品牌蓝 #0071e3 + 中性灰阶）升级为完整规范（Light 主题先行，暗色 tokens 预留）；**渐进式**：组件库先建 + 页面只改视觉（类名/文本/DOM 语义不变，测试兼容）；tokens 用 CSS 变量（运行时切换主题/定制品牌成本最低）；UI Kit 组件为「展示层封装」（页面保留现有 JSX 结构，逐步将重复元素替换为组件）；间距/字号用刻度（4px 基数）；圆角 6/10/14（元素/容器/浮层）；阴影 3 级；动效 150-250ms。空态/骨架屏/Toast 为新增能力（页面逐步接入）。暗色主题、组件文档站（Storybook）记 Phase 3 后续。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `docs/design/DESIGN.md` | 创建 | 设计规范文档（色板/字体/组件/间距/圆角/阴影） |
| `apps/web/src/design/tokens.css` | 创建 | Design Tokens（CSS 变量） |
| `apps/web/src/design/base.css` | 创建 | 全局 reset + 排版基础 |
| `apps/web/src/ui/ui.css` | 创建 | UI Kit 组件样式 |
| `apps/web/src/ui/Button.tsx` | 创建 | 按钮（primary/secondary/ghost/danger/small） |
| `apps/web/src/ui/Input.tsx` | 创建 | 输入框（含搜索/textarea 变体） |
| `apps/web/src/ui/Badge.tsx` | 创建 | 徽标（AI/状态/计数） |
| `apps/web/src/ui/Modal.tsx` | 创建 | 弹窗容器 |
| `apps/web/src/ui/Toast.tsx` | 创建 | 轻提示（成功/错误/信息） |
| `apps/web/src/ui/Spinner.tsx` | 创建 | 加载指示器 |
| `apps/web/src/ui/Avatar.tsx` | 创建 | 头像（首字母/emoji） |
| `apps/web/src/ui/Chip.tsx` | 创建 | 标签片（技能包/成员） |
| `apps/web/src/ui/EmptyState.tsx` | 创建 | 空态占位 |
| `apps/web/src/ui/ProgressBar.tsx` | 创建 | 进度条（配额） |
| `apps/web/src/ui/Skeleton.tsx` | 创建 | 骨架屏 |
| `apps/web/src/ui/index.ts` | 创建 | 组件导出 |
| `apps/web/src/app.css` | 修改 | 重构为 tokens + 保留类名 + 新组件样式引用 |
| `apps/web/src/main.tsx` | 修改 | import tokens/base/ui.css |
| `apps/web/src/pages/Login.tsx` | 修改 | 视觉落地（保留类名/文本） |
| `apps/web/src/pages/Chat.tsx` | 修改 | 视觉落地（保留类名/文本/DOM 语义） |
| `apps/web/src/pages/Chat.test.tsx` | 修改 | 不破坏（仅若组件替换引入新可访问性时增补断言） |
| `apps/web/src/design/tokens.test.ts` | 创建 | tokens 完整性测试 |
| `README.md` | 修改 | UI Kit 说明 |

---

## Task 1: 设计规范 + Tokens + 基础样式

**Files:**
- Create: `docs/design/DESIGN.md`
- Create: `apps/web/src/design/tokens.css`
- Create: `apps/web/src/design/base.css`
- Create: `apps/web/src/design/tokens.test.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: 写 DESIGN.md（设计规范源）**

创建 `docs/design/DESIGN.md`，内容：

```markdown
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
```

- [ ] **Step 2: 写 tokens.css**

创建 `apps/web/src/design/tokens.css`：

```css
/* Design Tokens — Turing Agent UI Kit（Light Theme） */
:root {
  /* 品牌 */
  --ta-color-brand: #0071e3;
  --ta-color-brand-hover: #0077ed;
  --ta-color-brand-soft: #eaf3ff;
  --ta-color-brand-text: #0071e3;
  /* 功能 */
  --ta-color-success: #34c759;
  --ta-color-success-soft: #eaf9ee;
  --ta-color-danger: #ff3b30;
  --ta-color-danger-soft: #ffecec;
  --ta-color-warning: #ff9f0a;
  --ta-color-warning-soft: #fff4e0;
  /* 中性 */
  --ta-color-text-primary: #1d1d1f;
  --ta-color-text-secondary: #6e6e73;
  --ta-color-text-tertiary: #8e8e93;
  --ta-color-text-on-brand: #ffffff;
  --ta-color-border: #d2d2d7;
  --ta-color-border-soft: #e5e5ea;
  --ta-color-bg: #ffffff;
  --ta-color-bg-secondary: #f5f5f7;
  --ta-color-bg-tertiary: #f0f0f5;
  /* 字体 */
  --ta-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --ta-font-xs: 11px;
  --ta-font-sm: 12px;
  --ta-font-md: 13px;
  --ta-font-lg: 15px;
  --ta-font-xl: 17px;
  --ta-font-2xl: 20px;
  --ta-font-title: 26px;
  /* 间距（4px 基数） */
  --ta-space-1: 4px;
  --ta-space-2: 8px;
  --ta-space-3: 12px;
  --ta-space-4: 16px;
  --ta-space-5: 20px;
  --ta-space-6: 24px;
  --ta-space-8: 32px;
  /* 圆角 */
  --ta-radius-sm: 6px;
  --ta-radius-md: 10px;
  --ta-radius-lg: 14px;
  --ta-radius-full: 9999px;
  /* 阴影 */
  --ta-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06);
  --ta-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04);
  --ta-shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.06);
  /* 动效 */
  --ta-duration-fast: 150ms;
  --ta-duration-normal: 200ms;
  --ta-duration-slow: 300ms;
  --ta-ease: cubic-bezier(0.4, 0, 0.2, 1);
}
```

- [ ] **Step 3: 写 base.css**

创建 `apps/web/src/design/base.css`：

```css
/* 全局基础：reset + 排版 */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#root {
  height: 100%;
}

body {
  font-family: var(--ta-font-family);
  font-size: var(--ta-font-md);
  line-height: 1.5;
  color: var(--ta-color-text-primary);
  background: var(--ta-color-bg);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  line-height: 1.3;
  font-weight: 600;
}

button {
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  border: none;
  background: none;
}

input,
textarea {
  font-family: inherit;
  font-size: inherit;
}

input:focus,
textarea:focus,
button:focus-visible {
  outline: 2px solid var(--ta-color-brand-soft);
  outline-offset: 1px;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background: var(--ta-color-border);
  border-radius: var(--ta-radius-full);
}
::-webkit-scrollbar-track {
  background: transparent;
}
```

- [ ] **Step 4: tokens 完整性测试**

创建 `apps/web/src/design/tokens.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tokensCss = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
)

const REQUIRED_TOKENS = [
  '--ta-color-brand',
  '--ta-color-brand-soft',
  '--ta-color-success',
  '--ta-color-danger',
  '--ta-color-warning',
  '--ta-color-text-primary',
  '--ta-color-text-secondary',
  '--ta-color-border',
  '--ta-color-bg',
  '--ta-color-bg-secondary',
  '--ta-font-family',
  '--ta-font-md',
  '--ta-space-2',
  '--ta-space-4',
  '--ta-radius-md',
  '--ta-radius-lg',
  '--ta-shadow-sm',
  '--ta-shadow-md',
  '--ta-duration-normal',
]

describe('design tokens', () => {
  it('defines all required tokens', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(tokensCss).toContain(token)
    }
  })

  it('uses valid color hex values', () => {
    const hexes = tokensCss.match(/#[0-9a-fA-F]{3,8}/g) ?? []
    expect(hexes.length).toBeGreaterThan(5)
    for (const hex of hexes) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/)
    }
  })
})
```

- [ ] **Step 5: main.tsx import**

读 `apps/web/src/main.tsx`，import 增：

```tsx
import './design/tokens.css'
import './design/base.css'
import './ui/ui.css'
import './app.css'
```

- [ ] **Step 6: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/design/tokens.test.ts
pnpm --filter @ta/web test --reporter=verbose
```

Expected: typecheck exit 0；tokens.test.ts 2 用例 PASS；web 全量 24+2=26 用例全 PASS（既有不受影响——只加 import 与 tokens）。

- [ ] **Step 7: 提交**

```bash
git add docs/design/DESIGN.md apps/web/src/design apps/web/src/main.tsx
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ui): 设计系统 Tokens + 基础样式 + DESIGN.md 规范"
```

---

## Task 2: UI Kit 组件库

**Files:**
- Create: `apps/web/src/ui/ui.css`
- Create: `apps/web/src/ui/Button.tsx`
- Create: `apps/web/src/ui/Input.tsx`
- Create: `apps/web/src/ui/Badge.tsx`
- Create: `apps/web/src/ui/Modal.tsx`
- Create: `apps/web/src/ui/Toast.tsx`
- Create: `apps/web/src/ui/Spinner.tsx`
- Create: `apps/web/src/ui/Avatar.tsx`
- Create: `apps/web/src/ui/Chip.tsx`
- Create: `apps/web/src/ui/EmptyState.tsx`
- Create: `apps/web/src/ui/ProgressBar.tsx`
- Create: `apps/web/src/ui/Skeleton.tsx`
- Create: `apps/web/src/ui/index.ts`
- Create: `apps/web/src/ui/ui.test.tsx`

- [ ] **Step 1: 写组件（逐个，类型安全）**

创建 `apps/web/src/ui/Button.tsx`：

```tsx
import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: ButtonProps) {
  return <button className={`ui-btn ${variant} ${size} ${className}`.trim()} {...rest} />
}
```

创建 `apps/web/src/ui/Input.tsx`：

```tsx
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export function Input({ invalid = false, className = '', ...rest }: InputProps) {
  return <input className={`ui-input ${invalid ? 'invalid' : ''} ${className}`.trim()} {...rest} />
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export function TextArea({ invalid = false, className = '', ...rest }: TextAreaProps) {
  return <textarea className={`ui-input ${invalid ? 'invalid' : ''} ${className}`.trim()} {...rest} />
}
```

创建 `apps/web/src/ui/Badge.tsx`：

```tsx
import type { ReactNode } from 'react'

export type BadgeVariant = 'brand' | 'success' | 'danger' | 'warning' | 'neutral'

export interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return <span className={`ui-badge ${variant} ${className}`.trim()}>{children}</span>
}
```

创建 `apps/web/src/ui/Modal.tsx`：

```tsx
import type { ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  title?: string
  onClose?: () => void
  children: ReactNode
  className?: string
}

export function Modal({ open, title, onClose, children, className = '' }: ModalProps) {
  if (!open) return null
  return (
    <div className="ui-modal-mask" onClick={onClose}>
      <div className={`ui-modal ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
        {title ? <div className="ui-modal-title">{title}</div> : null}
        {children}
      </div>
    </div>
  )
}
```

创建 `apps/web/src/ui/Toast.tsx`：

```tsx
import type { ReactNode } from 'react'

export type ToastVariant = 'success' | 'danger' | 'info'

export interface ToastItem {
  id: number
  variant: ToastVariant
  content: ReactNode
}

export interface ToastProps {
  toasts: ToastItem[]
}

export function Toast({ toasts }: ToastProps) {
  if (toasts.length === 0) return null
  return (
    <div className="ui-toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ui-toast ${t.variant}`}>{t.content}</div>
      ))}
    </div>
  )
}
```

创建 `apps/web/src/ui/Spinner.tsx`：

```tsx
export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return <span className={`ui-spinner ${size} ${className}`.trim()} aria-label="加载中" role="status" />
}
```

创建 `apps/web/src/ui/Avatar.tsx`：

```tsx
export interface AvatarProps {
  name: string
  kind?: 'human' | 'agent'
  className?: string
}

export function Avatar({ name, kind = 'human', className = '' }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span className={`ui-avatar ${kind} ${className}`.trim()} title={name}>
      {kind === 'agent' ? '🤖' : initial}
    </span>
  )
}
```

创建 `apps/web/src/ui/Chip.tsx`：

```tsx
import type { ReactNode } from 'react'

export interface ChipProps {
  children: ReactNode
  title?: string
  className?: string
}

export function Chip({ children, title, className = '' }: ChipProps) {
  return <span className={`ui-chip ${className}`.trim()} title={title}>{children}</span>
}
```

创建 `apps/web/src/ui/EmptyState.tsx`：

```tsx
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon?: string
  children: ReactNode
  className?: string
}

export function EmptyState({ icon = '📭', children, className = '' }: EmptyStateProps) {
  return (
    <div className={`ui-empty ${className}`.trim()}>
      <span className="ui-empty-icon">{icon}</span>
      <span className="ui-empty-text">{children}</span>
    </div>
  )
}
```

创建 `apps/web/src/ui/ProgressBar.tsx`：

```tsx
export interface ProgressBarProps {
  /** 0-1 */
  ratio: number
  tone?: 'default' | 'warn' | 'danger'
  className?: string
}

export function ProgressBar({ ratio, tone = 'default', className = '' }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, ratio * 100))
  return (
    <div className={`ui-progress ${className}`.trim()} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`ui-progress-fill ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
```

创建 `apps/web/src/ui/Skeleton.tsx`：

```tsx
export interface SkeletonProps {
  width?: string
  height?: string
  className?: string
}

export function Skeleton({ width = '100%', height = '12px', className = '' }: SkeletonProps) {
  return <span className={`ui-skeleton ${className}`.trim()} style={{ width, height }} aria-hidden="true" />
}
```

创建 `apps/web/src/ui/index.ts`：

```tsx
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button.js'
export { Input, TextArea, type InputProps, type TextAreaProps } from './Input.js'
export { Badge, type BadgeProps, type BadgeVariant } from './Badge.js'
export { Modal, type ModalProps } from './Modal.js'
export { Toast, type ToastProps, type ToastItem, type ToastVariant } from './Toast.js'
export { Spinner, type SpinnerProps } from './Spinner.js'
export { Avatar, type AvatarProps } from './Avatar.js'
export { Chip, type ChipProps } from './Chip.js'
export { EmptyState, type EmptyStateProps } from './EmptyState.js'
export { ProgressBar, type ProgressBarProps } from './ProgressBar.js'
export { Skeleton, type SkeletonProps } from './Skeleton.js'
```

- [ ] **Step 2: 写 ui.css**

创建 `apps/web/src/ui/ui.css`：

```css
/* UI Kit 组件样式（基于 design/tokens.css） */
/* Button */
.ui-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ta-space-1);
  padding: var(--ta-space-2) var(--ta-space-4);
  border-radius: var(--ta-radius-md);
  font-size: var(--ta-font-md);
  font-weight: 500;
  line-height: 1;
  transition: background var(--ta-duration-fast) var(--ta-ease), box-shadow var(--ta-duration-fast) var(--ta-ease);
  white-space: nowrap;
}
.ui-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ui-btn.primary { background: var(--ta-color-brand); color: var(--ta-color-text-on-brand); }
.ui-btn.primary:hover:not(:disabled) { background: var(--ta-color-brand-hover); }
.ui-btn.secondary { background: var(--ta-color-bg-secondary); color: var(--ta-color-text-primary); }
.ui-btn.secondary:hover:not(:disabled) { background: var(--ta-color-border-soft); }
.ui-btn.ghost { background: transparent; color: var(--ta-color-text-secondary); box-shadow: inset 0 0 0 1px var(--ta-color-border); }
.ui-btn.ghost:hover:not(:disabled) { background: var(--ta-color-bg-secondary); color: var(--ta-color-text-primary); }
.ui-btn.danger { background: var(--ta-color-danger); color: #fff; }
.ui-btn.danger:hover:not(:disabled) { background: #d70015; }
.ui-btn.sm { padding: var(--ta-space-1) var(--ta-space-3); font-size: var(--ta-font-sm); border-radius: var(--ta-radius-sm); }
/* Input / TextArea */
.ui-input {
  width: 100%;
  padding: var(--ta-space-2) var(--ta-space-3);
  border: 1px solid var(--ta-color-border);
  border-radius: var(--ta-radius-md);
  font-size: var(--ta-font-md);
  color: var(--ta-color-text-primary);
  background: var(--ta-color-bg);
  transition: border-color var(--ta-duration-fast) var(--ta-ease), box-shadow var(--ta-duration-fast) var(--ta-ease);
}
.ui-input:focus {
  border-color: var(--ta-color-brand);
  box-shadow: 0 0 0 3px var(--ta-color-brand-soft);
  outline: none;
}
.ui-input.invalid { border-color: var(--ta-color-danger); }
.ui-input::placeholder { color: var(--ta-color-text-tertiary); }
/* Badge */
.ui-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--ta-space-2);
  border-radius: var(--ta-radius-full);
  font-size: var(--ta-font-xs);
  font-weight: 600;
  line-height: 1.6;
}
.ui-badge.brand { background: var(--ta-color-brand-soft); color: var(--ta-color-brand-text); }
.ui-badge.success { background: var(--ta-color-success-soft); color: var(--ta-color-success); }
.ui-badge.danger { background: var(--ta-color-danger-soft); color: var(--ta-color-danger); }
.ui-badge.warning { background: var(--ta-color-warning-soft); color: var(--ta-color-warning); }
.ui-badge.neutral { background: var(--ta-color-bg-secondary); color: var(--ta-color-text-secondary); }
/* Modal */
.ui-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: ui-fade-in var(--ta-duration-fast) var(--ta-ease);
}
.ui-modal {
  background: var(--ta-color-bg);
  border-radius: var(--ta-radius-lg);
  box-shadow: var(--ta-shadow-lg);
  padding: var(--ta-space-6);
  max-width: 90vw;
  max-height: 85vh;
  overflow: auto;
  animation: ui-pop-in var(--ta-duration-normal) var(--ta-ease);
}
.ui-modal-title {
  font-size: var(--ta-font-xl);
  font-weight: 600;
  margin-bottom: var(--ta-space-4);
}
/* Toast */
.ui-toast-stack {
  position: fixed;
  top: var(--ta-space-4);
  right: var(--ta-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ta-space-2);
  z-index: 1100;
}
.ui-toast {
  padding: var(--ta-space-3) var(--ta-space-4);
  border-radius: var(--ta-radius-md);
  box-shadow: var(--ta-shadow-md);
  font-size: var(--ta-font-md);
  color: var(--ta-color-text-primary);
  background: var(--ta-color-bg);
  border-left: 3px solid var(--ta-color-brand);
  animation: ui-slide-in var(--ta-duration-normal) var(--ta-ease);
}
.ui-toast.success { border-left-color: var(--ta-color-success); }
.ui-toast.danger { border-left-color: var(--ta-color-danger); }
.ui-toast.info { border-left-color: var(--ta-color-brand); }
/* Spinner */
.ui-spinner {
  display: inline-block;
  border: 2px solid var(--ta-color-brand-soft);
  border-top-color: var(--ta-color-brand);
  border-radius: 50%;
  animation: ui-spin 0.8s linear infinite;
}
.ui-spinner.sm { width: 14px; height: 14px; }
.ui-spinner.md { width: 20px; height: 20px; }
.ui-spinner.lg { width: 32px; height: 32px; }
/* Avatar */
.ui-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--ta-radius-full);
  font-size: var(--ta-font-sm);
  font-weight: 600;
  color: var(--ta-color-text-secondary);
  background: var(--ta-color-bg-secondary);
  flex-shrink: 0;
}
.ui-avatar.agent { background: var(--ta-color-brand-soft); color: var(--ta-color-brand-text); }
/* Chip */
.ui-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--ta-space-2);
  border-radius: var(--ta-radius-full);
  font-size: var(--ta-font-xs);
  font-weight: 500;
  color: var(--ta-color-text-secondary);
  background: var(--ta-color-bg-secondary);
  border: 1px solid var(--ta-color-border-soft);
}
/* EmptyState */
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ta-space-2);
  padding: var(--ta-space-6);
  color: var(--ta-color-text-tertiary);
  font-size: var(--ta-font-sm);
}
.ui-empty-icon { font-size: var(--ta-font-2xl); }
/* ProgressBar */
.ui-progress {
  height: 6px;
  border-radius: var(--ta-radius-full);
  background: var(--ta-color-bg-tertiary);
  overflow: hidden;
}
.ui-progress-fill {
  height: 100%;
  border-radius: var(--ta-radius-full);
  background: var(--ta-color-brand);
  transition: width var(--ta-duration-normal) var(--ta-ease);
}
.ui-progress-fill.warn { background: var(--ta-color-warning); }
.ui-progress-fill.danger { background: var(--ta-color-danger); }
/* Skeleton */
.ui-skeleton {
  display: inline-block;
  background: var(--ta-color-bg-tertiary);
  border-radius: var(--ta-radius-sm);
  animation: ui-pulse 1.2s ease-in-out infinite;
}
/* 动效 keyframes */
@keyframes ui-spin { to { transform: rotate(360deg); } }
@keyframes ui-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ui-pop-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
@keyframes ui-slide-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ui-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
```

- [ ] **Step 3: 写组件测试**

创建 `apps/web/src/ui/ui.test.tsx`：

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, Badge, Modal, ProgressBar, Spinner, Avatar, Chip, EmptyState, Toast, Skeleton, Input, TextArea } from './index.js'

describe('ui kit', () => {
  it('renders Button variants', () => {
    const { rerender } = render(<Button variant="primary">保存</Button>)
    expect(screen.getByRole('button', { name: '保存' }).className).toContain('primary')
    rerender(<Button variant="danger" size="sm">删除</Button>)
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('danger sm')
  })

  it('renders Badge with variant class', () => {
    render(<Badge variant="success">已通过</Badge>)
    expect(screen.getByText('已通过').className).toContain('success')
  })

  it('renders Modal only when open', () => {
    const { rerender } = render(<Modal open={false} title="测试">内容</Modal>)
    expect(screen.queryByText('内容')).toBeNull()
    rerender(<Modal open title="测试">内容</Modal>)
    expect(screen.getByText('内容')).toBeTruthy()
    expect(screen.getByText('测试')).toBeTruthy()
  })

  it('renders ProgressBar with clamped width', () => {
    render(<ProgressBar ratio={1.5} />)
    const fill = document.querySelector('.ui-progress-fill') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('renders Spinner, Avatar, Chip, EmptyState, Toast, Skeleton, Input, TextArea', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toBeTruthy()
    render(<Avatar name="Alice" />)
    expect(screen.getByText('A')).toBeTruthy()
    render(<Avatar name="Ta-PM" kind="agent" />)
    expect(screen.getByText('🤖')).toBeTruthy()
    render(<Chip>全栈</Chip>)
    expect(screen.getByText('全栈')).toBeTruthy()
    render(<EmptyState>暂无数据</EmptyState>)
    expect(screen.getByText('暂无数据')).toBeTruthy()
    render(<Toast toasts={[{ id: 1, variant: 'success', content: '保存成功' }]} />)
    expect(screen.getByText('保存成功')).toBeTruthy()
    render(<Skeleton />)
    expect(document.querySelector('.ui-skeleton')).toBeTruthy()
    render(<Input placeholder="搜索" />)
    expect(screen.getByPlaceholderText('搜索')).toBeTruthy()
    render(<TextArea placeholder="内容" />)
    expect(screen.getByPlaceholderText('内容')).toBeTruthy()
  })
})
```

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose src/ui/ui.test.tsx
pnpm --filter @ta/web test --reporter=verbose
```

Expected: typecheck exit 0；ui.test.tsx 5 用例 PASS；web 全量 26+5=31 用例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/ui
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ui): UI Kit 组件库（Button/Input/Badge/Modal/Toast/Spinner/Avatar/Chip/Empty/Progress/Skeleton）"
```

---

## Task 3: 全界面视觉落地（app.css 重构 + 页面）

**Files:**
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/src/pages/Login.tsx`
- Modify: `apps/web/src/pages/Chat.tsx`

- [ ] **Step 1: app.css 重构（保留全部类名，视觉引用 tokens）**

读 `apps/web/src/app.css` 全文（118 行），**重构为 tokens 引用版**——每个既有类名选择器保留，样式改为 `var(--ta-*)`，并补充设计规范要求的视觉（阴影/圆角/动效/空态）。**硬约束**：不删除任何类名选择器、不改变任何布局语义（flex/position/grid 结构保持），只升级视觉属性。重构后结构（保持类名全集）：

```css
/* ===== 布局 ===== */
.app-shell { display: flex; height: 100vh; }
.session-sidebar { width: 260px; background: var(--ta-color-bg-secondary); border-right: 1px solid var(--ta-color-border-soft); display: flex; flex-direction: column; }
.sidebar-head { padding: var(--ta-space-4); display: flex; justify-content: space-between; align-items: center; }
.new-session { color: var(--ta-color-brand); font-weight: 600; }
.session-item { padding: var(--ta-space-3) var(--ta-space-4); cursor: pointer; border-radius: var(--ta-radius-md); transition: background var(--ta-duration-fast) var(--ta-ease); }
.session-item:hover { background: var(--ta-color-border-soft); }
.session-item.active { background: var(--ta-color-brand-soft); }
.unread { background: var(--ta-color-brand); color: #fff; border-radius: var(--ta-radius-full); padding: 0 6px; font-size: var(--ta-font-xs); }
main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.message-list { flex: 1; overflow-y: auto; padding: var(--ta-space-4); display: flex; flex-direction: column; gap: var(--ta-space-2); }
.bubble-row { display: flex; }
.bubble-row.human { justify-content: flex-end; }
.bubble-row.agent { justify-content: flex-start; }
.bubble { max-width: 72%; padding: var(--ta-space-3) var(--ta-space-4); border-radius: var(--ta-radius-lg); font-size: var(--ta-font-lg); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.bubble-row.human .bubble { background: var(--ta-color-brand-soft); color: var(--ta-color-text-primary); border-bottom-right-radius: var(--ta-radius-sm); }
.bubble-row.agent .bubble { background: var(--ta-color-bg); border: 1px solid var(--ta-color-border-soft); border-bottom-left-radius: var(--ta-radius-sm); box-shadow: var(--ta-shadow-sm); }
.ai-badge { display: inline-block; background: var(--ta-color-brand); color: #fff; font-size: var(--ta-font-xs); padding: 1px 8px; border-radius: var(--ta-radius-full); margin-bottom: var(--ta-space-1); font-weight: 600; }
.input-area { display: flex; gap: var(--ta-space-2); padding: var(--ta-space-3) var(--ta-space-4); border-top: 1px solid var(--ta-color-border-soft); background: var(--ta-color-bg); align-items: center; }
.input-area input { flex: 1; padding: var(--ta-space-2) var(--ta-space-3); border: 1px solid var(--ta-color-border); border-radius: var(--ta-radius-full); font-size: var(--ta-font-md); }
.input-area input:focus { border-color: var(--ta-color-brand); box-shadow: 0 0 0 3px var(--ta-color-brand-soft); outline: none; }
.chat-panel { width: 300px; background: var(--ta-color-bg-secondary); border-left: 1px solid var(--ta-color-border-soft); overflow-y: auto; padding: var(--ta-space-4); }
.chat-panel.collapsed { display: none; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--ta-space-3); }
/* ===== 登录页 ===== */
.login-page { height: 100%; display: flex; align-items: center; justify-content: center; background: var(--ta-color-bg-secondary); }
.login-card { width: 380px; background: var(--ta-color-bg); padding: var(--ta-space-8); border-radius: var(--ta-radius-lg); box-shadow: var(--ta-shadow-lg); display: flex; flex-direction: column; gap: var(--ta-space-3); }
.login-card h1 { font-size: var(--ta-font-title); text-align: center; }
.login-sub { text-align: center; color: var(--ta-color-text-secondary); font-size: var(--ta-font-md); }
.login-card input { padding: var(--ta-space-3) var(--ta-space-4); border: 1px solid var(--ta-color-border); border-radius: var(--ta-radius-md); font-size: var(--ta-font-lg); }
.login-card button { background: var(--ta-color-brand); color: #fff; padding: var(--ta-space-3); border-radius: var(--ta-radius-md); font-size: var(--ta-font-lg); font-weight: 600; transition: background var(--ta-duration-fast) var(--ta-ease); }
.login-card button:hover:not(:disabled) { background: var(--ta-color-brand-hover); }
.login-card button:disabled { opacity: 0.4; }
.login-error { color: var(--ta-color-danger); font-size: var(--ta-font-sm); text-align: center; }
/* ===== 卡片（审批/任务） ===== */
.approval-card, .task-card { background: var(--ta-color-bg); border: 1px solid var(--ta-color-border-soft); border-radius: var(--ta-radius-lg); box-shadow: var(--ta-shadow-sm); padding: var(--ta-space-4); }
.approval-title { font-weight: 600; font-size: var(--ta-font-lg); margin-bottom: var(--ta-space-2); }
.approval-nodes { display: flex; flex-wrap: wrap; gap: var(--ta-space-2); margin-bottom: var(--ta-space-3); }
.approval-node { display: inline-flex; align-items: center; gap: var(--ta-space-1); padding: 2px var(--ta-space-2); border-radius: var(--ta-radius-full); font-size: var(--ta-font-xs); background: var(--ta-color-bg-secondary); color: var(--ta-color-text-secondary); }
.approval-node.active { background: var(--ta-color-brand-soft); color: var(--ta-color-brand-text); font-weight: 600; }
.approval-node.approved { background: var(--ta-color-success-soft); color: var(--ta-color-success); }
.approval-node.rejected { background: var(--ta-color-danger-soft); color: var(--ta-color-danger); }
.approval-version { font-size: var(--ta-font-xs); color: var(--ta-color-text-tertiary); }
.approval-actions, .task-actions { display: flex; gap: var(--ta-space-2); flex-wrap: wrap; margin-top: var(--ta-space-2); }
.approve { background: var(--ta-color-success); color: #fff; padding: var(--ta-space-1) var(--ta-space-3); border-radius: var(--ta-radius-sm); font-size: var(--ta-font-sm); font-weight: 600; }
.approve:hover { background: #228a3c; }
.reject { background: var(--ta-color-danger); color: #fff; padding: var(--ta-space-1) var(--ta-space-3); border-radius: var(--ta-radius-sm); font-size: var(--ta-font-sm); font-weight: 600; }
.reject:hover { background: #d70015; }
.ghost { padding: var(--ta-space-1) var(--ta-space-3); border-radius: var(--ta-radius-sm); font-size: var(--ta-font-sm); color: var(--ta-color-text-secondary); box-shadow: inset 0 0 0 1px var(--ta-color-border); transition: background var(--ta-duration-fast) var(--ta-ease); }
.ghost:hover { background: var(--ta-color-bg-secondary); }
.ghost.small { font-size: var(--ta-font-xs); padding: 2px var(--ta-space-2); }
/* ===== 看板 ===== */
.kanban-stats { display: flex; flex-wrap: wrap; gap: var(--ta-space-2); margin-bottom: var(--ta-space-3); }
.stat { background: var(--ta-color-bg); border: 1px solid var(--ta-color-border-soft); border-radius: var(--ta-radius-md); padding: var(--ta-space-2) var(--ta-space-3); font-size: var(--ta-font-sm); color: var(--ta-color-text-secondary); box-shadow: var(--ta-shadow-sm); }
.kanban-columns { display: flex; gap: var(--ta-space-3); overflow-x: auto; }
.kanban-column { flex: 1; min-width: 160px; background: var(--ta-color-bg-tertiary); border-radius: var(--ta-radius-md); padding: var(--ta-space-2); display: flex; flex-direction: column; gap: var(--ta-space-2); }
.kanban-column-head { font-size: var(--ta-font-sm); font-weight: 600; color: var(--ta-color-text-secondary); display: flex; justify-content: space-between; padding: var(--ta-space-1) var(--ta-space-2); }
.kanban-column-head .count { background: var(--ta-color-bg-secondary); border-radius: var(--ta-radius-full); padding: 0 6px; font-size: var(--ta-font-xs); }
.kanban-card { background: var(--ta-color-bg); border: 1px solid var(--ta-color-border-soft); border-radius: var(--ta-radius-md); box-shadow: var(--ta-shadow-sm); padding: var(--ta-space-3); }
.kanban-card.dragging { opacity: 0.4; }
.kanban-column.drag-over { outline: 2px dashed var(--ta-color-brand); background: var(--ta-color-brand-soft); }
.kanban-card-title { font-weight: 500; font-size: var(--ta-font-md); margin-bottom: var(--ta-space-1); }
.kanban-card-assignee { font-size: var(--ta-font-xs); color: var(--ta-color-text-secondary); margin-bottom: var(--ta-space-2); }
.kanban-card-actions { display: flex; flex-wrap: wrap; gap: var(--ta-space-1); }
.kanban-empty { color: var(--ta-color-text-tertiary); font-size: var(--ta-font-xs); text-align: center; padding: var(--ta-space-3); }
.kanban-report-actions { display: flex; gap: var(--ta-space-2); margin-bottom: var(--ta-space-3); }
/* ===== 技能包 / 配额 / 知识库 ===== */
.skill-panel { margin-bottom: var(--ta-space-4); }
.skill-list { display: flex; flex-wrap: wrap; gap: var(--ta-space-1); }
.skill-chip { display: inline-flex; padding: 2px var(--ta-space-2); border-radius: var(--ta-radius-full); font-size: var(--ta-font-xs); background: var(--ta-color-brand-soft); color: var(--ta-color-brand-text); }
.quota-bar { margin-top: var(--ta-space-2); display: flex; flex-direction: column; gap: var(--ta-space-1); }
.quota-bar span { font-size: var(--ta-font-xs); color: var(--ta-color-text-secondary); }
.quota-track { height: 6px; border-radius: var(--ta-radius-full); background: var(--ta-color-bg-tertiary); overflow: hidden; }
.quota-fill { height: 100%; border-radius: var(--ta-radius-full); background: var(--ta-color-brand); transition: width var(--ta-duration-normal) var(--ta-ease); }
.quota-fill.warn { background: var(--ta-color-warning); }
.quota-fill.tripped { background: var(--ta-color-danger); }
.kb-panel { margin-top: var(--ta-space-4); }
.kb-search { display: flex; gap: var(--ta-space-2); margin-bottom: var(--ta-space-2); }
.kb-search input { flex: 1; padding: var(--ta-space-1) var(--ta-space-2); border: 1px solid var(--ta-color-border); border-radius: var(--ta-radius-sm); font-size: var(--ta-font-xs); }
.kb-create { display: flex; flex-direction: column; gap: var(--ta-space-2); margin-bottom: var(--ta-space-2); }
.kb-create input, .kb-create textarea { padding: var(--ta-space-1) var(--ta-space-2); border: 1px solid var(--ta-color-border); border-radius: var(--ta-radius-sm); font-size: var(--ta-font-xs); }
.kb-list { display: flex; flex-direction: column; gap: var(--ta-space-1); }
.kb-doc { background: var(--ta-color-bg); border: 1px solid var(--ta-color-border-soft); border-radius: var(--ta-radius-md); padding: var(--ta-space-2) var(--ta-space-3); }
.kb-doc-title { font-weight: 500; font-size: var(--ta-font-sm); }
.kb-doc-snippet { font-size: var(--ta-font-xs); color: var(--ta-color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ===== 记忆 / 成员 / 提及 / 引用 ===== */
.memory-block { margin-top: var(--ta-space-4); }
.memory-head { display: flex; justify-content: space-between; align-items: center; }
.memory-title { font-weight: 600; font-size: var(--ta-font-md); }
.memory-item { background: var(--ta-color-bg); border: 1px solid var(--ta-color-border-soft); border-radius: var(--ta-radius-md); padding: var(--ta-space-2) var(--ta-space-3); margin-top: var(--ta-space-1); font-size: var(--ta-font-sm); }
.memory-modal, .mention-picker { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.memory-modal-box { background: var(--ta-color-bg); border-radius: var(--ta-radius-lg); box-shadow: var(--ta-shadow-lg); padding: var(--ta-space-6); min-width: 420px; max-width: 90vw; }
.memory-modal-box textarea { width: 100%; min-height: 120px; padding: var(--ta-space-2) var(--ta-space-3); border: 1px solid var(--ta-color-border); border-radius: var(--ta-radius-md); font-size: var(--ta-font-md); resize: vertical; }
.memory-modal-actions { display: flex; gap: var(--ta-space-2); justify-content: flex-end; margin-top: var(--ta-space-4); }
.member-row { display: flex; align-items: center; gap: var(--ta-space-2); padding: var(--ta-space-2); }
.mention-option { display: block; width: 100%; text-align: left; padding: var(--ta-space-2) var(--ta-space-3); border-radius: var(--ta-radius-sm); }
.mention-option:hover { background: var(--ta-color-brand-soft); }
.replying-bar { display: flex; justify-content: space-between; align-items: center; padding: var(--ta-space-2) var(--ta-space-4); background: var(--ta-color-bg-secondary); border-top: 1px solid var(--ta-color-border-soft); }
.reply-preview { font-size: var(--ta-font-xs); color: var(--ta-color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-bubble { display: flex; align-items: center; gap: var(--ta-space-2); padding: var(--ta-space-2) var(--ta-space-3); border: 1px solid var(--ta-color-border-soft); border-radius: var(--ta-radius-lg); background: var(--ta-color-bg-secondary); font-size: var(--ta-font-md); }
.voice-bubble { cursor: default; }
.voice-btn { touch-action: none; user-select: none; }
.recording { background: var(--ta-color-danger-soft) !important; }
```

> 注：重构必须**保留 app.css 现有全部类名选择器**（118 行内所有 `.xxx`），实现时先 `grep -oE '\.[a-z][a-z0-9-]*' app.css` 提取全集，重构后 diff 核对无缺失。布局语义（display/flex-direction/position 等）保持，仅视觉属性换 tokens + 增强。

- [ ] **Step 2: Login.tsx 视觉增强（保留类名/文本）**

读 `apps/web/src/pages/Login.tsx`，**仅增强视觉**（类名与文本不变）：登录按钮在 busy 时加 Spinner（保留 disabled 与文本「登录」——测试依赖），错误提示用 danger 色（已由 CSS 处理，不改 JSX 结构或仅加 Spinner）：

```tsx
import { Spinner } from '../ui/Spinner.js'
// ...
        <button type="submit" disabled={busy || !username.trim()}>
          {busy ? <Spinner size="sm" /> : '登录'}
        </button>
```

> 注：Login.test.tsx 若断言按钮文本「登录」在 busy 时——核对测试；若 busy 场景不测文本，此改动安全。**保守**：若不确定，保持 `{busy ? '登录…' : '登录'}` 或纯 CSS（不加 Spinner）——先读 Login.test.tsx。

- [ ] **Step 3: Chat.tsx 渐进替换（保留类名/文本）**

读 `apps/web/src/pages/Chat.tsx`，**低风险渐进增强**（不改变 DOM 语义与按钮文本）：
1. AI 标识：现有 `ai-badge` 文本「AI」——保持。
2. 会话项/成员行：可选加 `ui-avatar`（但会改变 DOM——测试用 getByRole button 或文本，加 Avatar 不影响文本断言；**保守**：本 Task 只替换视觉明确的重复元素，且 diff 后跑全量测试）。
3. 实际落地项（安全）：空态（kanban-empty 已存在）保持；看板列空用 EmptyState 组件替换 `kanban-empty` div（保留 className）：
```tsx
<EmptyState className="kanban-empty">空</EmptyState>
```
（保留类名 → 视觉/测试兼容；但 EmptyState 渲染 span 而原为 div——测试若 queryByText('空') 不受影响。）
4. 配额条用 ProgressBar 组件替换（保留 quota-bar/quota-track/quota-fill 类名语义——**保守**：本 Task 用 CSS 已覆盖，组件替换留到可选；若替换，保留外层类名）。
> 注：**原则**——Task 3 以 CSS 视觉落地为主，组件替换仅在「替换后类名/文本/角色完全不变」时执行，逐处跑 Chat.test.tsx 验证。若任何替换导致测试失败，回退该处（保留原 JSX），只靠 CSS 达成视觉。

- [ ] **Step 4: 验证**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm --filter @ta/web typecheck
pnpm --filter @ta/web test --reporter=verbose
pnpm --filter @ta/web build
```

Expected: typecheck exit 0；web 全量 31 用例全 PASS（24 既有 + tokens 2 + ui 5，无破坏）；build 产出 dist/。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/app.css apps/web/src/pages/Login.tsx apps/web/src/pages/Chat.tsx
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "feat(ui): 全界面视觉落地（tokens 化 + 组件接入）"
```

---

## Task 4: 浏览器 QA + 视觉验收 + 收尾

- [ ] **Step 1: 浏览器视觉 QA（headless）**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
# gateway + web dev 运行中
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto http://localhost:5173/
$B screenshot /tmp/ui-login.png
# 登录后三栏截图
$B snapshot -i | grep -E "登录"
$B fill @<user> "ui-qa"
$B click @<login-btn>
$B screenshot /tmp/ui-chat.png
# 检查：控制台无错误、布局关键元素可见（session-sidebar/message-list/chat-panel）
$B console --errors
$B js "getComputedStyle(document.querySelector('.session-sidebar')).backgroundColor"   # 应为 tokens 灰
```

Expected: 截图可见新视觉（tokens 色/圆角/阴影）；控制台无错误；`--ta-color-*` 变量在 computed style 生效。

- [ ] **Step 2: 全仓验收**

```bash
cd /Users/wanzichanpinjingli/Desktop/TuringAgent
pnpm build
pnpm test
pnpm install --frozen-lockfile
pnpm --filter @ta/gateway eval:silence
```

Expected: build 全过；test 全绿（contracts 2 + gateway 212 + web 31 ≈ 245）；frozen-lockfile 通过；eval:silence 门禁通过；`git status` 干净。

- [ ] **Step 3: README 更新**

在 README「### 语音输入（FR-DESK-07 / FR-CHAT-01）」节后追加：

```markdown
### UI Kit 与设计系统

设计规范见 [`docs/design/DESIGN.md`](docs/design/DESIGN.md)（色板/字体/间距/圆角/阴影/组件规范）。Design Tokens 定义于 `apps/web/src/design/tokens.css`（CSS 变量，Light 主题，暗色预留）；UI Kit 组件库在 `apps/web/src/ui/`（Button/Input/Badge/Modal/Toast/Spinner/Avatar/Chip/EmptyState/ProgressBar/Skeleton）。全界面按规范落地（登录页/三栏工作台/消息气泡/卡片/看板/面板）。
```

- [ ] **Step 4: 提交 + 推送**

```bash
git add README.md docs/superpowers/plans/2026-08-15-phase3-plan13-ui-kit.md
git -c user.name="TuringAgent" -c user.email="ta@local" commit -m "docs: 计划 31 全部勾选 + README UI Kit 说明"
git push
```

Expected: 推送成功（CI 应绿）。

---

## Self-Review 记录

- **Spec 覆盖**：完整 UI Kit（组件库 11 组件）→ Task 2；设计规范（色板/字体/间距/圆角/阴影/动效）→ Task 1 + DESIGN.md；全界面规范落地（登录/三栏/气泡/卡片/看板/面板）→ Task 3；视觉验收 → Task 4。测试兼容（保留类名/文本）→ 全 Task 约束。
- **占位符扫描**：无 TBD；代码逐字给出。
- **类型一致性**：组件 props（variant/size/ratio/tone 等）在组件定义/导出/测试一致；tokens 名在 tokens.css 与 DESIGN.md/测试一致；ui 类名（ui-btn/ui-badge 等）在组件与 ui.css 一致。
- **已知取舍**：Light 主题先行（暗色 tokens 预留）；组件库为展示层（页面渐进接入）；Storybook/文档站记后续；CSS 变量全局（无 CSS Modules——与现状一致，避免大规模重构）；动效克制（150-250ms）。
