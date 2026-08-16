export interface SkeletonProps {
  width?: string
  height?: string
  className?: string
}

export function Skeleton({ width = '100%', height = '12px', className = '' }: SkeletonProps) {
  return <span className={`ui-skeleton ${className}`.trim()} style={{ width, height }} aria-hidden="true" />
}
