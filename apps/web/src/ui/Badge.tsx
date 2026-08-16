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
