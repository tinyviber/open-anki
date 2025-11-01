import React from 'react'

import {
  SyncConflictError,
  SyncNetworkError,
  getSyncStateSnapshot,
  runSyncWorkflow,
} from '@/core/sync/syncClient'
import { useAuth } from '@/hooks/useAuth'

import { SyncContext, type SyncContextValue } from './sync-context'

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SyncContextValue['status']>('idle')
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [conflicts, setConflicts] = React.useState<unknown>(null)
  const syncInFlight = React.useRef(false)
  const { getAccessToken, requestReauthentication } = useAuth()

  React.useEffect(() => {
    let cancelled = false
    void getSyncStateSnapshot()
      .then(state => {
        if (!cancelled) {
          setLastSyncedAt(state.lastSyncedAt ?? null)
        }
      })
      .catch(() => {
        // ignore state hydration failures and allow sync to recover
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sync = React.useCallback<SyncContextValue['sync']>(async () => {
    if (syncInFlight.current) {
      return undefined
    }

    syncInFlight.current = true
    setStatus('syncing')
    setError(null)
    setConflicts(null)

    try {
      const result = await runSyncWorkflow({
        getAccessToken,
        requestReauthentication,
      })
      setLastSyncedAt(result.lastSyncedAt)
      setStatus('idle')
      return result
    } catch (err) {
      if (err instanceof SyncConflictError) {
        setError(err.message)
        setConflicts(err.conflicts)
      } else if (err instanceof SyncNetworkError) {
        if (err.status === 401) {
          setError('登录状态已过期，请重新登录。')
        } else {
          setError('同步请求失败，请检查网络连接后重试。')
        }
        setConflicts(null)
      } else {
        setError(err instanceof Error ? err.message : '未知的同步错误。')
        setConflicts(null)
      }
      setStatus('error')
      return undefined
    } finally {
      syncInFlight.current = false
    }
  }, [getAccessToken, requestReauthentication])

  React.useEffect(() => {
    void sync()
  }, [sync])

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
  )

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
