export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return <span className={`ui-spinner ${size} ${className}`.trim()} aria-label="加载中" role="status" />
}
