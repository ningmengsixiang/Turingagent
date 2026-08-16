import type { ReactNode } from 'react'

export interface ChipProps {
  children: ReactNode
  title?: string
  className?: string
}

export function Chip({ children, title, className = '' }: ChipProps) {
  return <span className={`ui-chip ${className}`.trim()} title={title}>{children}</span>
}
