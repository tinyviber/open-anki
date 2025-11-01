import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom'

import { SyncProvider } from './hooks/SyncProvider'
import { AuthProvider } from './hooks/AuthProvider'
import { useAuth } from './hooks/useAuth'
import { Dashboard } from './pages/Dashboard'
import { DeckDetailPage } from './pages/DeckDetailPage'
import { DecksPage } from './pages/DecksPage'
import { LayoutWrapper } from './pages/Layout'
import { LoginPage } from './pages/LoginPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatsPage } from './pages/StatsPage'

function LoadingScreen(): JSX.Element {
  return (
    <div className="flex h-screen w-full items-center justify-center" role="status" aria-live="polite">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" aria-hidden="true" />
      <span className="sr-only">加载中...</span>
    </div>
  )
}

function ProtectedRoute(): JSX.Element {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user) {
    let redirectMessage: string | null = null
    if (typeof window !== 'undefined') {
      redirectMessage = window.sessionStorage.getItem('authRedirectMessage')
      if (redirectMessage) {
        window.sessionStorage.removeItem('authRedirectMessage')
      }
    }

    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
          message: redirectMessage ?? '登录状态已失效，请重新登录。',
        }}
      />
    )
  }

  return (
    <SyncProvider>
      <Outlet />
    </SyncProvider>
  )
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/',
        element: <LayoutWrapper />,
        children: [
          {
            path: '/',
            element: <Dashboard />,
          },
          {
            path: 'review',
            element: <ReviewPage />,
          },
          {
            path: 'decks',
            element: <DecksPage />,
          },
          {
            path: 'decks/:deckId',
            element: <DeckDetailPage />,
          },
          {
            path: 'stats',
            element: <StatsPage />,
          },
          {
            path: 'settings',
            element: <SettingsPage />,
          },
        ],
      },
    ],
  },
])

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
