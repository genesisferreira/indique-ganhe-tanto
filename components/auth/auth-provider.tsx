"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { performClientLogout } from "@/lib/auth/logout"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { AuthProfileBasics } from "@/types/auth-profile"

type AuthContextValue = {
  ready: boolean
  profile: AuthProfileBasics | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<AuthProfileBasics | null>(null)

  const refreshProfile = useCallback(async () => {
    if (isDataProviderMock()) {
      setProfile(null)
      setReady(true)
      return
    }

    const basics = await getAuthProfileBasicsFromSupabase()
    setProfile(basics)
    setReady(true)
  }, [])

  useEffect(() => {
    if (isDataProviderMock()) {
      setProfile(null)
      setReady(true)
      return
    }

    let cancelled = false
    const supabase = getSupabaseClient()

    const syncProfile = async () => {
      const basics = await getAuthProfileBasicsFromSupabase()
      if (cancelled) return
      setProfile(basics)
      setReady(true)
    }

    void syncProfile()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return

      if (event === "SIGNED_OUT") {
        setProfile(null)
        setReady(true)
        return
      }

      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED" ||
        event === "INITIAL_SESSION"
      ) {
        void syncProfile()
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    setProfile(null)
    setReady(true)

    if (isDataProviderMock()) {
      window.location.href = "/login?loggedOut=1"
      return
    }

    await performClientLogout()
    window.location.href = "/auth/logout"
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      profile,
      signOut,
      refreshProfile,
    }),
    [ready, profile, signOut, refreshProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider")
  }
  return ctx
}

export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext)
}
