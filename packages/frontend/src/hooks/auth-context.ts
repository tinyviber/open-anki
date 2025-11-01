import React from 'react'
import type {
  Session,
  SignInWithPasswordCredentials,
  SignInWithPasswordResponse,
  User,
} from '@supabase/supabase-js'

export interface AuthContextValue {
  user: User | null
  session: Session | null
  isLoading: boolean
  getAccessToken: () => Promise<string | null>
  signIn: (
    credentials: SignInWithPasswordCredentials,
  ) => Promise<SignInWithPasswordResponse>
  signOut: () => Promise<void>
  requestReauthentication: () => void
}

export const AuthContext = React.createContext<AuthContextValue | undefined>(
  undefined,
)
