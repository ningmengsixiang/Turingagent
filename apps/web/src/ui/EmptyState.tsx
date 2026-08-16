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
