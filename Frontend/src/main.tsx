import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { ConfirmProvider } from './components/primitives/ConfirmDialog'
import { ToastProvider } from './components/primitives/Toast'
import { AuthProvider } from './context/AuthContext'
import { LanguageProvider } from './context/LanguageContext'
import './i18n'
import { queryClient } from './lib/queryClient'
import { router } from './routes/router'
import './theme/globals.css'
import './components/primitives/primitives.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <RouterProvider router={router} />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
)
