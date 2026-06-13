import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { Spinner } from './Spinner'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  loading?: boolean
  block?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const className = [
    'btn',
    `btn--${variant}`,
    block ? 'btn--block' : '',
    rest.className ?? '',
  ].join(' ').trim()
  return (
    <button {...rest} type={type} className={className} disabled={disabled || loading}>
      {loading && <Spinner size={20} />}
      {children}
    </button>
  )
}
