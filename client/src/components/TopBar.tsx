import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { keys } from '../lib/queries'
import { initials } from '../lib/format'

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="6" cy="7" r="3" />
      <circle cx="22" cy="7" r="3" />
      <circle cx="14" cy="21" r="3" />
      <path d="M8.5 9l4 9.5M19.5 9l-4 9.5" stroke="var(--brass-2)" />
      <path d="M9 7h10" />
    </svg>
  )
}

function UserMenu() {
  const me = useMe().data
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!me) return null
  const signOut = async () => {
    await api.post('/auth/logout').catch(() => undefined)
    qc.clear()
    qc.setQueryData(keys.me, null)
    navigate('/login', { replace: true })
  }
  return (
    <div className="user-menu" ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${me.name}`} onClick={() => setOpen((o) => !o)}>
        {initials(me.name)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div style={{ padding: '8px 12px 10px', borderBottom: '1px solid var(--rule)', marginBottom: 4 }}>
            <div style={{ fontWeight: 600 }}>{me.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {me.firmName}
            </div>
          </div>
          <Link role="menuitem" to="/app" onClick={() => setOpen(false)}>
            All cases
          </Link>
          <Link role="menuitem" to="/app/settings" onClick={() => setOpen(false)}>
            Firm and settings
          </Link>
          <button role="menuitem" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** The mahogany bench across the top of every signed-in page, with its brass rule. */
export function TopBar({ crumbs, right }: { crumbs?: ReactNode; right?: ReactNode }) {
  return (
    <>
      <header className="topbar wood">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/app" className="brand">
            <Logo />
            Case Memory
          </Link>
          {crumbs}
        </nav>
        <div className="row" style={{ gap: 14 }}>
          {right}
          <UserMenu />
        </div>
      </header>
      <div className="brass-rule" />
    </>
  )
}

export function Crumb({ to, children }: { to?: string; children: ReactNode }) {
  return (
    <>
      <span className="sep" aria-hidden="true">
        /
      </span>
      {to ? (
        <Link to={to} style={{ fontSize: 14, fontWeight: 500 }}>
          {children}
        </Link>
      ) : (
        <span style={{ fontSize: 14, fontWeight: 500 }} aria-current="page">
          {children}
        </span>
      )}
    </>
  )
}
