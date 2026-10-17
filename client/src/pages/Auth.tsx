import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Logo } from '../components/TopBar'
import { Banner, ErrorState, Field, PageLoader } from '../components/ui'
import { errorMessage } from '../lib/format'
import { api, ApiError } from '../lib/api'
import { keys } from '../lib/queries'
import type { User } from '../types/domain'

/** Optional one-click demo sign-in, for hackathon judges. Set both in client/.env to show it. */
const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL as string | undefined
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD as string | undefined

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side wood">
        <Link to="/" className="brand" style={{ color: 'var(--on-wood)', textDecoration: 'none' }}>
          <Logo />
          Case Memory
        </Link>
        <div className="stack" style={{ gap: 24 }}>
          <h1>Your case file, with a memory.</h1>
          <div className="ruled typed" style={{ background: 'var(--paper)', color: 'var(--ink)', padding: '22px 24px', borderRadius: 2, maxWidth: 440, transform: 'rotate(-1deg)', lineHeight: '28px' }}>
            <div className="muted" style={{ fontSize: 13 }}>Written statement, 18.05.2021</div>
            <div>
              1. The defendant <mark style={{ background: 'var(--red-bg)' }}>denies having received any payment</mark> of Rs. 5,00,000.
            </div>
          </div>
        </div>
        <p style={{ color: 'var(--wood-text)', fontSize: 14 }}>A memory aid for lawyers, not legal advice.</p>
      </aside>
      <main className="auth-form">
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h2 className="page-title">{title}</h2>
          {children}
        </div>
      </main>
    </div>
  )
}

function useSignedIn() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (user: User) => {
    qc.setQueryData(keys.me, user)
    const next = params.get('next')
    navigate(next && next.startsWith('/app') ? next : '/app', { replace: true })
  }
}

const fieldsOf = (e: unknown) => (e instanceof ApiError ? e.fieldErrors() : {})
/** Field errors go next to the field; anything else goes in the banner. */
const generalError = (e: unknown) => (e && !(e instanceof ApiError && e.statusCode === 422) ? errorMessage(e) : null)

export function LoginPage() {
  const done = useSignedIn()
  const [form, setForm] = useState({ email: '', password: '' })
  const login = useMutation({ mutationFn: (creds: typeof form = form) => api.post<User>('/auth/login', creds), onSuccess: done })
  const errs = fieldsOf(login.error)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate(form)
  }
  return (
    <AuthLayout title="Sign in">
      <form onSubmit={submit} noValidate className="stack" style={{ gap: 16 }}>
        {generalError(login.error) && <Banner tone="error">{generalError(login.error)}</Banner>}
        <Field label="Email" error={errs.email}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password" error={errs.password}>
          {(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <button className="btn btn-primary btn-lg" type="submit" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        {DEMO_EMAIL && DEMO_PASSWORD && (
          <button
            type="button"
            className="btn"
            disabled={login.isPending}
            onClick={() => {
              setForm({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
              login.mutate({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
            }}
          >
            Use the demo account (synthetic case)
          </button>
        )}
        <p className="ink-2" style={{ fontSize: 14 }}>
          New here? <Link to="/register">Create an account for your firm</Link>
        </p>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const done = useSignedIn()
  const [form, setForm] = useState({ name: '', email: '', password: '', firmName: '' })
  const register = useMutation({ mutationFn: () => api.post<User>('/auth/register', form), onSuccess: done })
  const errs = fieldsOf(register.error)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })
  return (
    <AuthLayout title="Create your firm">
      <form
        noValidate
        className="stack"
        style={{ gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          register.mutate()
        }}
      >
        {generalError(register.error) && <Banner tone="error">{generalError(register.error)}</Banner>}
        <Field label="Firm or chambers name" error={errs.firmName}>
          {(p) => <input {...p} className="input" autoComplete="organization" value={form.firmName} onChange={set('firmName')} />}
        </Field>
        <Field label="Your name" error={errs.name}>
          {(p) => <input {...p} className="input" autoComplete="name" value={form.name} onChange={set('name')} />}
        </Field>
        <Field label="Email" error={errs.email}>
          {(p) => <input {...p} className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Password" error={errs.password} hint="At least 10 characters, with letters and numbers.">
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <button className="btn btn-primary btn-lg" type="submit" disabled={register.isPending}>
          {register.isPending ? 'Creating…' : 'Create account'}
        </button>
        <p className="ink-2" style={{ fontSize: 14 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  )
}

export function InvitePage() {
  const { token = '' } = useParams()
  const done = useSignedIn()
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ firmName: string; email: string; role: string }>(`/invites/${token}`), retry: false })
  const [form, setForm] = useState({ name: '', password: '' })
  const join = useMutation({
    mutationFn: () => api.post<User>('/auth/register', { ...form, email: invite.data!.email, inviteToken: token }),
    onSuccess: done,
  })
  const errs = fieldsOf(join.error)
  if (invite.isPending) return <PageLoader label="Checking your invite" />
  if (invite.isError)
    return (
      <AuthLayout title="Join a firm">
        <ErrorState error={invite.error} title="This invite can't be used" />
        <Link to="/login">Go to sign in</Link>
      </AuthLayout>
    )
  return (
    <AuthLayout title={`Join ${invite.data.firmName}`}>
      <p className="ink-2">
        You were invited as <b>{invite.data.email}</b>.
      </p>
      <form
        noValidate
        className="stack"
        style={{ gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          join.mutate()
        }}
      >
        {generalError(join.error) && <Banner tone="error">{generalError(join.error)}</Banner>}
        <Field label="Your name" error={errs.name}>
          {(p) => <input {...p} className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="Choose a password" error={errs.password} hint="At least 10 characters, with letters and numbers.">
          {(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <button className="btn btn-primary btn-lg" type="submit" disabled={join.isPending}>
          {join.isPending ? 'Joining…' : 'Join the firm'}
        </button>
      </form>
    </AuthLayout>
  )
}
