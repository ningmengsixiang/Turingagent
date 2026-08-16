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
