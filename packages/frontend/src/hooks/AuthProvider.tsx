import React from 'react'
import type {
  SignInWithPasswordCredentials,
  SignInWithPasswordResponse,
} from '@supabase/supabase-js'

import { supabaseClient } from '@/core/auth/supabaseClient'
import { db } from '@/core/db/db'
import { clearStoredDeviceId } from '@/core/sync/syncClient'

import { AuthContext, type AuthContextValue } from './auth-context'

async function clearDatabase(): Promise<void> {
  try {
    await db.transaction(
      'rw',
      db.decks,
      db.noteTypes,
      db.notes,
      db.cards,
      db.reviewLogs,
      db.syncMeta,
      db.syncState,
      async () => {
        await Promise.all([
          db.decks.clear(),
          db.noteTypes.clear(),
          db.notes.clear(),
          db.cards.clear(),
          db.reviewLogs.clear(),
          db.syncMeta.clear(),
          db.syncState.clear(),
        ])
      },
    )
  } catch (error) {
    console.error('Failed to clear local database during sign-out', error)
  } finally {
    clearStoredDeviceId()
  }
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode
}): JSX.Element {
  const [session, setSession] = React.useState<AuthContextValue['session']>(null)
  const [user, setUser] = React.useState<AuthContextValue['user']>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true

    void supabaseClient.auth
      .getSession()
      .then(({ data }) => {
        if (!active) {
          return
        }
        setSession(data.session ?? null)
        setUser(data.session?.user ?? null)
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    const { data: listener } = supabaseClient.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession)
        setUser(nextSession?.user ?? null)
        if (!nextSession) {
          void clearDatabase()
        }
      },
    )

    return () => {
      active = false
      listener?.subscription.unsubscribe()
    }
  }, [])

  const getAccessToken = React.useCallback<
    AuthContextValue['getAccessToken']
  >(async () => {
    const { data, error } = await supabaseClient.auth.getSession()
    if (error) {
      throw error
    }
    if (data.session) {
      setSession(data.session)
      setUser(data.session.user ?? null)
    }
    return data.session?.access_token ?? null
  }, [])

  const signOut = React.useCallback<AuthContextValue['signOut']>(async () => {
    try {
      const { error } = await supabaseClient.auth.signOut()
      if (error) {
        throw error
      }
    } finally {
      await clearDatabase()
      setSession(null)
      setUser(null)
    }
  }, [])

  const signIn = React.useCallback<AuthContextValue['signIn']>(
    async (
      credentials: SignInWithPasswordCredentials,
    ): Promise<SignInWithPasswordResponse> => {
      const result = await supabaseClient.auth.signInWithPassword(credentials)
      if (result.error) {
        throw result.error
      }
      if (result.data.session) {
        setSession(result.data.session)
        setUser(result.data.session.user ?? null)
      }
      return result
    },
    [],
  )

  const requestReauthentication = React.useCallback<
    AuthContextValue['requestReauthentication']
  >(() => {
    void signOut().catch(() => {
      // Ignore sign-out errors triggered by forced reauthentication
    })
  }, [signOut])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isLoading,
      getAccessToken,
      signIn,
      signOut,
      requestReauthentication,
    }),
    [getAccessToken, isLoading, requestReauthentication, session, signIn, signOut, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
