import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Login from './components/Login'
import AuthorizedLayout from './components/AuthorizedLayout'
import NotFound from '@/pages/NotFound'
import Toaster from '@/components/Toaster'
import ProtectedRoute from './components/ProtectedRoute'

// Screens most visits never open load when they are opened. The first load used to carry all
// of them in one 2.2 MB script: Settings alone brings key management, recovery and the
// post-quantum setup, and Admin is for one person.
const Admin = lazy(() => import('@/pages/Admin'))
const Settings = lazy(() => import('@/pages/Settings'))
const ResetPassword = lazy(() => import('./components/ResetPassword'))
const RecoverAccount = lazy(() => import('./components/RecoverAccount'))

/** What shows for the moment a screen is loading: the page colour, no flash, no spinner. */
function ScreenLoading() {
  return <div className="min-h-dvh bg-background" aria-busy="true" />
}

function App() {
  return (
    <>
      <Suspense fallback={<ScreenLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Login />} />
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/recover" element={<RecoverAccount />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AuthorizedLayout />
              </ProtectedRoute>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Admin />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  )
}

export default App
