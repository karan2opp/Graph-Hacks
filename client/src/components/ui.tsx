import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ApiError } from '../lib/api'
import { errorMessage } from '../lib/format'
import { useOnline } from '../lib/online'
import { pageNumbers, type Paged } from '../lib/paging'

/** Label + control + hint/error, wired for screen readers. Pass the control as a render function. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: ReactNode
  error?: string
  hint?: ReactNode
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode
}) {
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <span id={`${id}-err`} className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label ?? 'Loading'} />
}

export function Skeleton({ height = 18, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />
}

/** Rows shaped like list items (a mark, a title, a line under it), shimmering while they load. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  const online = useOnline()
  return (
    <div className="stack" aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" aria-hidden="true">
          <Skeleton height={36} width={36} />
          <div className="stack" style={{ gap: 8, flex: 1 }}>
            <Skeleton height={14} width={`${[62, 48, 70, 55][i % 4]}%`} />
            <Skeleton height={11} width={`${[38, 30, 44, 26][i % 4]}%`} />
          </div>
        </div>
      ))}
      {!online && (
        <p className="muted" style={{ fontSize: 13 }}>
          Waiting for your connection. This will load when you're back online.
        </p>
      )}
    </div>
  )
}

/** A page-shaped shimmer while a whole page loads: a title, then a block and a few rows. */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <main className="page" aria-busy="true">
      <span className="sr-only" role="status">
        {label}…
      </span>
      <div className="stack" style={{ gap: 10 }}>
        <Skeleton height={14} width={120} />
        <Skeleton height={38} width="45%" />
      </div>
      <Skeleton height={120} />
      <SkeletonList rows={3} />
    </main>
  )
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {action}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p className="ink-2">{children}</p>}
      {action}
    </div>
  )
}

const isNetwork = (e: unknown) => e instanceof ApiError && (e.code === 'NETWORK_ERROR' || e.code === 'OFFLINE')

/** A failed load: what went wrong, in plain words, and a way to try again. */
export function ErrorState({ error, retry, title = 'This could not be loaded' }: { error: unknown; retry?: () => void; title?: string }) {
  const online = useOnline()
  const notFound = error instanceof ApiError && error.statusCode === 404
  const unreachable = !online || isNetwork(error)
  const heading = notFound ? 'Not found' : !online ? "You're offline" : unreachable ? "Can't reach Case Memory" : title
  const detail = notFound
    ? 'It may have been removed, or it belongs to another firm.'
    : !online
      ? "This will load again when you're back online."
      : errorMessage(error)
  return (
    <div className="empty" role="alert">
      <h2>{heading}</h2>
      <p className="ink-2">{detail}</p>
      {retry && !notFound && (
        <button type="button" className="btn btn-sm" onClick={retry} disabled={!online}>
          Try again
        </button>
      )}
    </div>
  )
}

/** Shown above data that is still on screen after a refresh failed. */
export function StaleNotice({ error, retry }: { error: unknown; retry: () => void }) {
  const online = useOnline()
  return (
    <Banner
      tone="warn"
      action={
        <button type="button" className="btn btn-sm" onClick={retry} disabled={!online}>
          Try again
        </button>
      }
    >
      {online ? `Couldn't refresh this (${errorMessage(error)}). Showing what was loaded before.` : "You're offline. Showing what was loaded before."}
    </Banner>
  )
}

/**
 * A query's states in one place: a skeleton while it first loads, an error with a retry if that
 * fails, and the content once there is data. Data already on screen stays when a later refresh
 * fails, with a notice above it.
 */
export function QueryView<T>({ query, loading, children }: { query: UseQueryResult<T>; loading?: ReactNode; children: (data: T) => ReactNode }) {
  const retry = () => void query.refetch()
  if (query.data === undefined) return query.isError ? <ErrorState error={query.error} retry={retry} /> : <>{loading ?? <SkeletonList />}</>
  return (
    <>
      {query.isError && <StaleNotice error={query.error} retry={retry} />}
      {children(query.data)}
    </>
  )
}

/** Previous, page numbers, next, and "11–20 of 34 documents". Hidden when everything fits on one page. */
export function Pagination({ paged, noun }: { paged: Paged; noun: [one: string, many: string] }) {
  const { page, pages, size, total, setPage } = paged
  if (pages <= 1) return null
  const from = (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <nav className="pager" aria-label={`Pages of ${noun[1]}`}>
      <span className="pager-count">
        {from}–{to} of {total} {total === 1 ? noun[0] : noun[1]}
      </span>
      <div className="pager-buttons">
        <button type="button" className="btn btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
          <span aria-hidden="true">‹</span> Previous
        </button>
        {pageNumbers(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={n === page ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
              aria-current={n === page ? 'page' : undefined}
              aria-label={`Page ${n}`}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className="btn btn-sm" disabled={page === pages} onClick={() => setPage(page + 1)}>
          Next <span aria-hidden="true">›</span>
        </button>
      </div>
    </nav>
  )
}

export type StampTone = 'red' | 'green' | 'blue' | 'brown' | 'grey' | 'violet'
export function Stamp({ tone, children }: { tone: StampTone; children: ReactNode }) {
  return <span className={`stamp stamp-${tone}`}>{children}</span>
}

// ---- toasts -----------------------------------------------------------------------------
const ToastCtx = createContext<(msg: string) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3500)
    return () => clearTimeout(t)
  }, [msg])
  const show = useCallback((m: string) => setMsg(m), [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite">{msg && <div className="toast">{msg}</div>}</div>
    </ToastCtx.Provider>
  )
}

/** A bar at the top of the screen while the connection is down, and a note when it comes back. */
export function OfflineBanner() {
  const online = useOnline()
  const toast = useToast()
  const wasOffline = useRef(false)
  useEffect(() => {
    if (!online) wasOffline.current = true
    else if (wasOffline.current) {
      wasOffline.current = false
      toast("You're back online. Catching up…")
    }
  }, [online, toast])
  if (online) return null
  return (
    <div className="offline-bar" role="status">
      <span className="offline-dot" aria-hidden="true" />
      You're offline. What's loaded stays readable, and anything you save is sent when you reconnect.
    </div>
  )
}
