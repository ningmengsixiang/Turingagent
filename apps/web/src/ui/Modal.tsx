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
