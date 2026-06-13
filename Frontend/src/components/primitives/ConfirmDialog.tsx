import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from './Button'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

// Promise-based confirmation used for EVERY destructive action.
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (result: boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {options && (
        <div
          className="modal__backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onKeyDown={(e) => e.key === 'Escape' && close(false)}
        >
          <div className="modal">
            <h2 className="modal__title" id="confirm-title">
              {options.title}
            </h2>
            <p>{options.message}</p>
            <div className="modal__actions">
              <Button variant="secondary" onClick={() => close(false)}>
                {options.cancelLabel ?? t('common.keep')}
              </Button>
              <Button
                variant={options.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
                autoFocus
              >
                {options.confirmLabel ?? t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider')
  return ctx.confirm
}
