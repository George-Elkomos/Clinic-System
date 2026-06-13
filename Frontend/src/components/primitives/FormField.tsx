import { useId, type ReactNode } from 'react'

interface FormFieldProps {
  label: string
  error?: string
  hint?: string
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}

// Renders a large always-visible label, wires aria-invalid / aria-describedby,
// and shows a plain-language inline error.
export function FormField({ label, error, hint, children }: FormFieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {hint && !error && (
        <div className="field__hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
      {error && (
        <div className="field__error" id={`${id}-error`} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
