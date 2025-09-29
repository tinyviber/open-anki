import React from 'react';
import type {
  Session,
  SignInWithPasswordCredentials,
  SignInWithPasswordResponse,
  User,
} from '@supabase/supabase-js';
import { supabaseClient } from '@/core/auth/supabaseClient';
import { db } from '@/core/db/db';
import { clearStoredDeviceId } from '@/core/sync/syncClient';

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
        ]);
      },
    );
  } catch (error) {
    console.error('Failed to clear local database during sign-out', error);
  } finally {
    clearStoredDeviceId();
  }
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  getAccessToken: () => Promise<string | null>;
  signIn: (
    credentials: SignInWithPasswordCredentials,
  ) => Promise<SignInWithPasswordResponse>;
  signOut: () => Promise<void>;
  requestReauthentication: () => void;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [session, setSession] = React.useState<Session | null>(null);
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;

    void supabaseClient.auth
      .getSession()
      .then(({ data }) => {
        if (!active) {
          return;
        }
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    const { data: listener } = supabaseClient.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        if (!nextSession) {
          void clearDatabase();
        }
      },
    );

    return () => {
      active = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  const getAccessToken = React.useCallback(async (): Promise<string | null> => {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      throw error;
    }
    if (data.session) {
      setSession(data.session);
      setUser(data.session.user ?? null);
    }
    return data.session?.access_token ?? null;
  }, []);

  const signOut = React.useCallback(async (): Promise<void> => {
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) {
        throw error;
      }
    } finally {
      await clearDatabase();
      setSession(null);
      setUser(null);
    }
  }, []);

  const signIn = React.useCallback(
    async (
      credentials: SignInWithPasswordCredentials,
    ): Promise<SignInWithPasswordResponse> => {
      const result = await supabaseClient.auth.signInWithPassword(credentials);
      if (result.error) {
        throw result.error;
      }
      if (result.data.session) {
        setSession(result.data.session);
        setUser(result.data.session.user ?? null);
      }
      return result;
    },
    [],
  );

  const requestReauthentication = React.useCallback(() => {
    void signOut().catch(() => {
      // Ignore sign-out errors triggered by forced reauthentication
    });
  }, [signOut]);

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
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
