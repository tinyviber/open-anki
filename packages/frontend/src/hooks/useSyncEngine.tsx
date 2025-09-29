import React from 'react';
import {
  SyncConflictError,
  SyncNetworkError,
  getSyncStateSnapshot,
  runSyncWorkflow,
  type SyncResult,
} from '@/core/sync/syncClient';

interface SyncContextValue {
  status: 'idle' | 'syncing' | 'error';
  isSyncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
  conflicts: unknown;
  sync: () => Promise<SyncResult | void>;
}

const SyncContext = React.createContext<SyncContextValue | undefined>(undefined);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [conflicts, setConflicts] = React.useState<unknown>(null);
  const syncInFlight = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    void getSyncStateSnapshot()
      .then(state => {
        if (!cancelled) {
          setLastSyncedAt(state.lastSyncedAt ?? null);
        }
      })
      .catch(() => {
        // ignore state hydration failures and allow sync to recover
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sync = React.useCallback(async (): Promise<SyncResult | void> => {
    if (syncInFlight.current) {
      return undefined;
    }

    syncInFlight.current = true;
    setStatus('syncing');
    setError(null);
    setConflicts(null);

    try {
      const result = await runSyncWorkflow();
      setLastSyncedAt(result.lastSyncedAt);
      setStatus('idle');
      return result;
    } catch (err) {
      if (err instanceof SyncConflictError) {
        setError(err.message);
        setConflicts(err.conflicts);
      } else if (err instanceof SyncNetworkError) {
        setError('同步请求失败，请检查网络连接后重试。');
        setConflicts(null);
      } else {
        setError(err instanceof Error ? err.message : '未知的同步错误。');
        setConflicts(null);
      }
      setStatus('error');
      return undefined;
    } finally {
      syncInFlight.current = false;
    }
  }, []);

  React.useEffect(() => {
    void sync();
  }, [sync]);

  const value = React.useMemo<SyncContextValue>(
    () => ({
      status,
      isSyncing: status === 'syncing',
      lastSyncedAt,
      error,
      conflicts,
      sync,
    }),
    [conflicts, error, lastSyncedAt, status, sync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = React.useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return ctx;
}
