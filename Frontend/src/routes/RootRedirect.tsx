import { Navigate } from 'react-router-dom'

import { CenteredSpinner } from '../components/primitives/Spinner'
import { useAuth } from '../hooks/useAuth'
import { LandingPage } from '../pages/public/LandingPage'
import { roleHome } from './roleHome'

// '/' sends a signed-in user to their role home; anonymous visitors see the clinic landing page.
export function RootRedirect() {
  const { status, user } = useAuth()
  if (status === 'loading') return <CenteredSpinner />
  if (status === 'anon' || !user) return <LandingPage />
  return <Navigate to={roleHome(user.role)} replace />
}
