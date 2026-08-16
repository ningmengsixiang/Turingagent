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
