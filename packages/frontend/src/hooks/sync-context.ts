import React from 'react'

import type { SyncResult } from '@/core/sync/syncClient'

export interface SyncContextValue {
  status: 'idle' | 'syncing' | 'error'
  isSyncing: boolean
  lastSyncedAt: number | null
  error: string | null
  conflicts: unknown
  sync: () => Promise<SyncResult | void>
}

export const SyncContext = React.createContext<SyncContextValue | undefined>(
  undefined,
)
