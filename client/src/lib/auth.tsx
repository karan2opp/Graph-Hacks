import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { api, ApiError, onUnauthorized } from './api'
import { keys } from './queries'
import type { User } from '../types/domain'
import { ErrorState, PageLoader } from '../components/ui'



/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<User>('/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.statusCode === 401) return null
        throw e
      }
    },
    staleTime: 5 * 60_000,
  })
}

/** Clears all cached data and returns to sign-in when the session ends. */
export function useSessionWatcher() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.clear()
        qc.setQueryData(keys.me, null)
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
      }),
    [qc, navigate, location],
  )
}

/** Route guard for /app. */
export function RequireAuth() {
  const me = useMe()
  const location = useLocation()
  useSessionWatcher()
  if (me.data === undefined) {
    // Only a 401 means signed out (useMe returns null). Offline or a server error must not bounce you to sign-in.
    if (me.isError)
      return (
        <main className="page">
          <ErrorState error={me.error} retry={() => me.refetch()} title="Couldn't open your account" />
        </main>
      )
    return <PageLoader label="Opening your cases" />
  }
  if (me.data === null) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

/** Sign-in pages bounce signed-in users straight into the app. */
export function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const me = useMe()
  if (me.isPending) return <PageLoader label="Loading" />
  if (me.data) return <Navigate to="/app" replace />
  return <>{children}</>
}
