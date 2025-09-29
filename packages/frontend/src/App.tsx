import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from 'react-router-dom';
import { LayoutWrapper } from './pages/Layout';
import { Dashboard } from './pages/Dashboard';
import { ReviewPage } from './pages/ReviewPage';
import { StatsPage } from './pages/StatsPage';
import { DecksPage } from './pages/DecksPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeckDetailPage } from './pages/DeckDetailPage';
import { SyncProvider } from './hooks/useSyncEngine';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { LoginPage } from './pages/LoginPage';

function LoadingScreen(): JSX.Element {
  return (
    <div className="flex h-screen w-full items-center justify-center" role="status" aria-live="polite">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" aria-hidden="true" />
      <span className="sr-only">加载中...</span>
    </div>
  );
}

function ProtectedRoute(): JSX.Element {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    let redirectMessage: string | null = null;
    if (typeof window !== 'undefined') {
      redirectMessage = window.sessionStorage.getItem('authRedirectMessage');
      if (redirectMessage) {
        window.sessionStorage.removeItem('authRedirectMessage');
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
    );
  }

  return (
    <SyncProvider>
      <Outlet />
    </SyncProvider>
  );
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
]);

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
