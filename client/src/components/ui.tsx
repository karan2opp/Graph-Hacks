import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { errorMessage } from '../lib/format'

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

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
      <span className="row muted">
        <Spinner label={label} />
        {label}…
      </span>
    </div>
  )
}

export function Skeleton({ height = 18, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={64} />
      ))}
    </div>
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

export function ErrorState({ error, retry, title = 'This could not be loaded' }: { error: unknown; retry?: () => void; title?: string }) {
  const notFound = error instanceof ApiError && error.statusCode === 404
  return (
    <div className="empty" role="alert">
      <h2>{notFound ? 'Not found' : title}</h2>
      <p className="ink-2">{notFound ? 'It may have been removed, or it belongs to another firm.' : errorMessage(error)}</p>
      {retry && !notFound && (
        <button type="button" className="btn btn-sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
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
