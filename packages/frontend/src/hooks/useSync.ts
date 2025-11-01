import React from 'react'

import { SyncContext, type SyncContextValue } from './sync-context'

export function useSync(): SyncContextValue {
  const ctx = React.useContext(SyncContext)
  if (!ctx) {
    throw new Error('useSync must be used within a SyncProvider')
  }
  return ctx
}
