import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Logo } from './Logo'
import { PublicLanguageToggle } from './PublicLanguageToggle'
import './public.css'

// Standalone centered auth-card shell shared by the auth flows that don't
// need the full PublicLayout navbar (forgot/reset/must-change password) —
// just the brand logo + language pill atop a centered white card.
export function AuthCardShell({ children }: { children: ReactNode }) {
  return (
    <div className="public-shell min-h-screen flex items-center justify-center bg-slate-50/50 p-4">
      <div className="w-full max-w-md mx-auto my-auto rounded-2xl border border-slate-100 bg-white p-6 shadow-xl shadow-slate-100/50 sm:p-8">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center shrink-0">
            <Logo className="h-8 w-auto" />
          </Link>
          <PublicLanguageToggle />
        </div>
        {children}
      </div>
    </div>
  )
}
