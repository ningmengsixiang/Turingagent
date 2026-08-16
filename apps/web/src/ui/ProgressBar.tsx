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
