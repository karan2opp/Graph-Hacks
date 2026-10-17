import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Crumb, TopBar } from '../components/TopBar'
import { Banner, ErrorState, Field, SkeletonList, Stamp, useToast } from '../components/ui'
import { courtDate, errorMessage } from '../lib/format'
import { api, ApiError } from '../lib/api'
import { useMe } from '../lib/auth'
import type { Health, Role } from '../types/domain'

interface FirmView {
  id: string
  name: string
  members: { id: string; name: string; email: string; role: Role; since: string }[]
  invites: { id: string; email: string; role: Role; expiresAt: string }[]
}

function Members() {
  const me = useMe().data!
  const qc = useQueryClient()
  const toast = useToast()
  const firm = useQuery({ queryKey: ['firm'], queryFn: () => api.get<FirmView>('/firm') })
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const invite = useMutation({
    mutationFn: () => api.post<{ token: string }>('/firm/invites', { email }),
    onSuccess: (r) => {
      setLink(`${window.location.origin}/invite/${r.token}`)
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['firm'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/firm/members/${id}`),
    onSuccess: () => {
      toast('Member removed')
      void qc.invalidateQueries({ queryKey: ['firm'] })
    },
  })

  if (firm.isPending) return <SkeletonList rows={3} />
  if (firm.isError) return <ErrorState error={firm.error} retry={() => firm.refetch()} />
  const owner = me.role === 'owner'
  const inviteErr = invite.error instanceof ApiError ? invite.error.fieldErrors().email ?? invite.error.message : invite.error ? errorMessage(invite.error) : undefined

  return (
    <section className="card stack" aria-labelledby="members-h" style={{ gap: 16 }}>
      <h2 id="members-h" className="section-title">
        People at {firm.data.name}
      </h2>
      <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 0 }}>
        {firm.data.members.map((m) => (
          <li key={m.id} className="row-between" style={{ alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--rule-2)' }}>
            <span className="stack" style={{ gap: 2 }}>
              <b style={{ fontWeight: 600 }}>
                {m.name} {m.id === me.id && <span className="muted">(you)</span>}
              </b>
              <span className="muted" style={{ fontSize: 13 }}>
                {m.email}
              </span>
            </span>
            <span className="row">
              <Stamp tone={m.role === 'owner' ? 'blue' : 'grey'}>{m.role}</Stamp>
              {owner && m.id !== me.id && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(`Remove ${m.name} from the firm? They will be signed out.`)) remove.mutate(m.id)
                  }}
                >
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {firm.data.invites.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 className="eyebrow">Waiting to join</h3>
          {firm.data.invites.map((i) => (
            <span key={i.id} className="ink-2" style={{ fontSize: 14 }}>
              {i.email} · invite expires {courtDate(i.expiresAt)}
            </span>
          ))}
        </div>
      )}

      {owner ? (
        <form
          className="stack"
          style={{ gap: 10, borderTop: '1px solid var(--rule-2)', paddingTop: 16 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            invite.mutate()
          }}
        >
          <Field label="Invite a colleague by email" error={inviteErr}>
            {(p) => (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input {...p} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firm.in" />
                <button className="btn btn-primary" type="submit" disabled={invite.isPending || !email}>
                  Create invite
                </button>
              </div>
            )}
          </Field>
          {link && (
            <Banner
              tone="info"
              action={
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link)
                    toast('Invite link copied')
                  }}
                >
                  Copy link
                </button>
              }
            >
              Send this link to them. It works once, for 7 days: <span className="typed" style={{ wordBreak: 'break-all' }}>{link}</span>
            </Banner>
          )}
        </form>
      ) : (
        <p className="muted" style={{ fontSize: 14 }}>
          Only owners can invite or remove people.
        </p>
      )}
    </section>
  )
}

function SystemStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      // A degraded API answers 503 with the same body; show it rather than an error.
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/v1/health`)
      return ((await res.json()) as { data: Health }).data
    },
    refetchInterval: 30_000,
  })
  const rows: [string, string, boolean, string][] = health.data
    ? [
        ['Case graph (FalkorDB)', health.data.services.falkordb === 'up' ? 'Connected' : 'Unavailable', health.data.services.falkordb === 'up', 'Nothing can be saved or read until it is back.'],
        ['AI agents (OpenAI)', health.data.services.openai === 'configured' ? 'Configured' : 'Not configured', health.data.services.openai === 'configured', 'Documents are saved, and reading, fact-checking and answers resume once a key is set.'],
        ['File storage (ImageKit)', health.data.services.imagekit === 'configured' ? 'Configured' : 'Not configured', health.data.services.imagekit === 'configured', 'Text is kept, but original files are not stored.'],
      ]
    : []
  return (
    <section className="card stack" aria-labelledby="status-h" style={{ gap: 12 }}>
      <h2 id="status-h" className="section-title">
        System status
      </h2>
      {health.isPending && <SkeletonList rows={3} />}
      {health.isError && <ErrorState error={health.error} retry={() => health.refetch()} />}
      {rows.map(([name, state, ok, why]) => (
        <div key={name} className="row-between" style={{ alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--rule-2)' }}>
          <span className="stack" style={{ gap: 2 }}>
            <b style={{ fontWeight: 600 }}>{name}</b>
            {!ok && (
              <span className="muted" style={{ fontSize: 13 }}>
                {why}
              </span>
            )}
          </span>
          <Stamp tone={ok ? 'green' : 'brown'}>{state}</Stamp>
        </div>
      ))}
    </section>
  )
}

export function SettingsPage() {
  return (
    <>
      <TopBar crumbs={<Crumb>Firm and settings</Crumb>} />
      <main className="page" style={{ maxWidth: 880 }}>
        <h1 className="page-title">Firm and settings</h1>
        <Members />
        <SystemStatus />
      </main>
    </>
  )
}
