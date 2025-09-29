import {
  createBrowserRouter,
  RouterProvider,
} from 'react-router-dom';
import { LayoutWrapper } from './pages/Layout';
import { Dashboard } from './pages/Dashboard';
import { ReviewPage } from './pages/ReviewPage';
import { StatsPage } from './pages/StatsPage';
import { DecksPage } from './pages/DecksPage';
import { SettingsPage } from './pages/SettingsPage';
import { DeckDetailPage } from './pages/DeckDetailPage';
import { SyncProvider } from './hooks/useSyncEngine';
import { AuthProvider, useAuth } from './hooks/useAuth';

const router = createBrowserRouter([
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
]);

function ProtectedApp(): JSX.Element {
  const { user, isLoading } = useAuth();

  if (isLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center" role="status" aria-live="polite">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" aria-hidden="true" />
        <span className="sr-only">加载中...</span>
      </div>
    );
  }

  return (
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>
  );
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <ProtectedApp />
    </AuthProvider>
  );
}
