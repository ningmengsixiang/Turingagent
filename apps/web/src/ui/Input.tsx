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
