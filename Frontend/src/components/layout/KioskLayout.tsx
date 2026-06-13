import type { ReactNode } from 'react'

import { LanguageSwitcher } from '../primitives/LanguageSwitcher'

// Fullscreen, no-nav, large-type layout for the public waiting-room display.
export function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-5)', borderBottom: '2px solid var(--border)',
        }}
      >
        <h1 style={{ margin: 0, color: 'var(--primary)' }}>{/* brand set by page */}</h1>
        <LanguageSwitcher />
      </header>
      <main style={{ padding: 'var(--space-6)' }}>{children}</main>
    </div>
  )
}
