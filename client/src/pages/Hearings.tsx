import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { FindingCard } from '../components/Findings'
import { Banner, EmptyState, ErrorState, SkeletonList, Stamp, useToast } from '../components/ui'
import { courtDate, errorMessage, inDays, longDate, plural, todayIST } from '../lib/format'
import { api } from '../lib/api'
import { keys, sideOf, useBrief, useHearings, usePeople } from '../lib/queries'
import type { ClaimView, Finding, HearingDetail, TranscriptView } from '../types/domain'

type Filter = 'all' | 'orders' | 'transcripts' | 'adjourned'

export function HearingsPage() {
  const { caseId = '' } = useParams()
  const hearings = useHearings(caseId)
  const brief = useBrief(caseId)
  const [filter, setFilter] = useState<Filter>('all')
  const today = todayIST()
  const contra = new Set(brief.data?.timeline.filter((t) => t.contradiction).map((t) => t.id))

  const all = hearings.data ?? []
  const upcoming = all.filter((h) => h.hearing.date >= today)
  const past = [...all.filter((h) => h.hearing.date < today)].reverse()
  const shown = past.filter((h) =>
    filter === 'orders' ? h.orders > 0 : filter === 'transcripts' ? h.hasTranscript : filter === 'adjourned' ? h.hearing.adjourned : true,
  )

  return (
    <>
      <div className="row-between">
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="page-title">Hearings</h1>
          <p className="lede">{all.length ? `${plural(all.length, 'date')} on record. Open one to read its transcript, orders and what was said.` : 'Every date the matter was listed.'}</p>
        </div>
        <Link to="new" className="btn btn-primary">
          + Add hearing
        </Link>
      </div>
      {hearings.isPending ? (
        <SkeletonList rows={5} />
      ) : hearings.isError ? (
        <ErrorState error={hearings.error} retry={() => hearings.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title="No hearings yet" action={<Link className="btn btn-primary" to="new">Add the first hearing</Link>}>
          Add each date the matter was listed. Orders and transcripts attach to a hearing.
        </EmptyState>
      ) : (
        <>
          <div className="pills" role="group" aria-label="Show">
            {(
              [
                ['all', `All ${past.length}`],
                ['orders', 'With orders'],
                ['transcripts', 'With transcripts'],
                ['adjourned', 'Adjourned'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className="pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <ol className="diary">
            {filter === 'all' &&
              upcoming.map((h) => (
                <li key={h.hearing.id}>
                  <Link to={h.hearing.id} className="diary-row">
                    <span className="diary-when">
                      <b className="typed blue">{courtDate(h.hearing.date)}</b>
                      <span className="muted">{inDays(h.hearing.date)}</span>
                    </span>
                    <span className="diary-rail">
                      <i className="dot dot-next" />
                    </span>
                    <span className="diary-card" style={{ background: 'var(--blue-bg)', border: '1.5px dashed var(--blue-line)' }}>
                      <span className="blue" style={{ fontSize: 12, fontWeight: 600 }}>
                        Next date
                      </span>
                      <span className="serif" style={{ fontSize: 19 }}>
                        {h.hearing.purpose ?? 'Hearing'}
                      </span>
                      {h.judge && <span className="ink-2" style={{ fontSize: 13 }}>Before {h.judge}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            {shown.map((h) => (
              <li key={h.hearing.id}>
                <Link to={h.hearing.id} className="diary-row">
                  <span className="diary-when">
                    <b className="typed">{courtDate(h.hearing.date)}</b>
                    <span className="muted">{longDate(h.hearing.date).slice(0, 3)}</span>
                  </span>
                  <span className="diary-rail">
                    <i className={`dot ${h.orders ? 'dot-order' : ''}`} />
                  </span>
                  <span className="diary-card">
                    <span className="row" style={{ gap: 10 }}>
                      <span className="serif" style={{ fontSize: 19 }}>
                        {h.hearing.purpose ?? 'Hearing'}
                      </span>
                      {h.hearing.adjourned && <Stamp tone="brown">Adjourned</Stamp>}
                    </span>
                    {h.hearing.outcome && <span className="ink-2" style={{ fontSize: 14 }}>{h.hearing.outcome}</span>}
                    {contra.has(h.hearing.id) && (
                      <span className="red" style={{ fontSize: 13, fontWeight: 600 }}>
                        A statement made here was later contradicted
                      </span>
                    )}
                  </span>
                  <span className="diary-added">
                    {h.orders > 0 && <span>{plural(h.orders, 'order')}</span>}
                    {h.documents - h.orders > 0 && <span>{plural(h.documents - h.orders, 'document')}</span>}
                    {h.hasTranscript && <span>Transcript</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {shown.length === 0 && <p className="muted">No past hearings match this filter.</p>}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------

function SpeakerMapping({ caseId, t, hearingId }: { caseId: string; t: TranscriptView; hearingId: string }) {
  const people = usePeople(caseId)
  const qc = useQueryClient()
  const toast = useToast()
  const [map, setMap] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => api.patch(`/transcripts/${t.id}/speakers`, { speakerMap: map }),
    onSuccess: () => {
      toast('Speakers updated')
      void qc.invalidateQueries({ queryKey: keys.transcript(caseId, hearingId) })
    },
  })
  if (!t.unmatchedSpeakers.length) return null
  return (
    <div className="banner banner-warn" role="status">
      <span>
        <b>{plural(t.unmatchedSpeakers.length, 'speaker')} not recognised.</b> Map them so their statements are attributed.
      </span>
      <div className="row">
        {t.unmatchedSpeakers.map((label) => (
          <label key={label} className="row" style={{ gap: 6 }}>
            <span className="typed">{label}</span>
            <select className="select" style={{ minHeight: 36, width: 'auto' }} value={map[label] ?? ''} onChange={(e) => setMap({ ...map, [label]: e.target.value })}>
              <option value="">Not a party (court staff)</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.code ? `(${p.code})` : `(${p.kind.toLowerCase()})`}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" className="btn btn-sm btn-primary" disabled={save.isPending || !Object.values(map).some(Boolean)} onClick={() => save.mutate()}>
          Save
        </button>
      </div>
      {save.error && <span className="red">{errorMessage(save.error)}</span>}
    </div>
  )
}

function RelatedPanel({ caseId, claims }: { caseId: string; claims: ClaimView[] }) {
  const first = claims[0]
  const related = useQuery({
    queryKey: ['case', caseId, 'related', first?.claim.id],
    queryFn: () => api.get<Finding[]>(`/claims/${first!.claim.id}/related`),
    enabled: !!first,
  })
  if (!first)
    return (
      <p className="empty" style={{ fontSize: 14 }}>
        No statement was recorded from this turn. Questions and procedure are kept as context only.
      </p>
    )
  return (
    <div className="stack" style={{ gap: 12 }}>
      {claims.map((c) => (
        <div key={c.claim.id} className="card stack" style={{ gap: 10 }}>
          <span className="eyebrow">Statement recorded</span>
          <p className="quote" style={{ fontSize: 17, lineHeight: 1.5 }}>
            “{c.claim.quote}”
          </p>
          <div className="row" style={{ gap: 8 }}>
            {c.madeBy && <span className="tag tag-blue">by {c.madeBy.name}</span>}
            {c.subjects.map((s) => (
              <span key={s.id} className="tag">
                about {s.name}
              </span>
            ))}
          </div>
        </div>
      ))}
      {related.isPending ? (
        <SkeletonList rows={2} />
      ) : related.isError ? (
        <ErrorState error={related.error} retry={() => related.refetch()} />
      ) : related.data.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          Nothing else in the case contradicts or supports this yet.
        </p>
      ) : (
        related.data.map((f) => <FindingCard key={f.id} f={f} caseId={caseId} compact focusClaimId={first.claim.id} />)
      )}
    </div>
  )
}

export function HearingPage() {
  const { caseId = '', hearingId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const version = params.get('v') ? Number(params.get('v')) : undefined
  const people = usePeople(caseId)
  const hearing = useQuery({ queryKey: keys.hearing(caseId, hearingId), queryFn: () => api.get<HearingDetail>(`/hearings/${hearingId}`) })
  const transcript = useQuery({
    queryKey: keys.transcript(caseId, hearingId, version),
    queryFn: () => api.get<TranscriptView>(`/hearings/${hearingId}/transcript${version ? `?version=${version}` : ''}`),
    enabled: !!hearing.data?.transcript,
  })
  const versions = useQuery({
    queryKey: ['case', caseId, 'transcript-versions', hearingId],
    queryFn: () => api.get<{ transcript: { id: string; version: number; current: boolean; createdAt: string } }[]>(`/hearings/${hearingId}/transcripts`),
    enabled: !!hearing.data?.transcript,
  })
  const claims = useQuery({
    queryKey: keys.claims(caseId, `source:${transcript.data?.id}`),
    queryFn: () => api.get<ClaimView[]>(`/cases/${caseId}/claims?sourceId=${transcript.data!.id}`),
    enabled: !!transcript.data,
  })
  const contradictions = useQuery({ queryKey: keys.contradictions(caseId), queryFn: () => api.get<Finding[]>(`/cases/${caseId}/contradictions`) })

  const byTurn = useMemo(() => {
    const m = new Map<number, ClaimView[]>()
    for (const c of claims.data ?? []) if (c.source.type === 'transcript') m.set(c.source.turn, [...(m.get(c.source.turn) ?? []), c])
    return m
  }, [claims.data])
  const contradicted = new Set((contradictions.data ?? []).flatMap((f) => [f.earlier.claim.id, f.later.claim.id]))
  const firstClaimTurn = [...byTurn.keys()].sort((a, b) => a - b)[0]
  const sel = params.get('turn') ? Number(params.get('turn')) : (firstClaimTurn ?? 1)
  const selectTurn = (n: number) => {
    const next = new URLSearchParams(params)
    next.set('turn', String(n))
    setParams(next, { replace: true })
  }

  if (hearing.isPending) return <SkeletonList rows={6} />
  if (hearing.isError) return <ErrorState error={hearing.error} retry={() => hearing.refetch()} />
  const h = hearing.data
  const list = people.data ?? []
  const sideColor = (personId?: string) => {
    const p = list.find((x) => x.id === personId)
    const side = p ? sideOf(p, list) : null
    return side === 'first' ? 'var(--blue)' : side === 'second' ? 'var(--violet)' : 'var(--ink-2)'
  }
  const selTurn = transcript.data?.segments.find((s) => s.seq === sel)

  return (
    <>
      <div className="row-between" style={{ alignItems: 'center' }}>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
          {h.previous ? (
            <Link to={`/app/cases/${caseId}/hearings/${h.previous.id}`} className="btn btn-sm" aria-label={`Previous hearing, ${courtDate(h.previous.date)}`}>
              ‹
            </Link>
          ) : (
            <span className="btn btn-sm" aria-disabled="true">
              ‹
            </span>
          )}
          <div className="stack" style={{ gap: 2 }}>
            <span className="typed muted" style={{ fontSize: 13 }}>
              {courtDate(h.hearing.date)} · {h.hearing.status === 'scheduled' ? `listed, ${inDays(h.hearing.date)}` : 'held'}
            </span>
            <h1 className="page-title" style={{ fontSize: 28 }}>
              {h.hearing.purpose ?? 'Hearing'}
            </h1>
          </div>
          {h.next ? (
            <Link to={`/app/cases/${caseId}/hearings/${h.next.id}`} className="btn btn-sm" aria-label={`Next hearing, ${courtDate(h.next.date)}`}>
              ›
            </Link>
          ) : (
            <span className="btn btn-sm" aria-disabled="true">
              ›
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8, fontSize: 13 }}>
          {h.judge && <span className="tag">Bench: {h.judge.name}</span>}
          {h.appearances.length > 0 && <span className="tag">Appeared: {h.appearances.filter((a) => a.present).length}</span>}
          {h.hearing.adjourned && <Stamp tone="brown">Adjourned</Stamp>}
          {(versions.data?.length ?? 0) > 1 && (
            <label className="row" style={{ gap: 6 }}>
              Version
              <select
                className="select"
                style={{ minHeight: 34, width: 'auto' }}
                value={version ?? ''}
                onChange={(e) => {
                  const next = new URLSearchParams(params)
                  if (e.target.value) next.set('v', e.target.value)
                  else next.delete('v')
                  setParams(next)
                }}
              >
                <option value="">Current</option>
                {versions.data!.map(({ transcript: v }) => (
                  <option key={v.id} value={v.version}>
                    v{v.version}{v.current ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {h.hearing.outcome && <p className="ink-2">{h.hearing.outcome}</p>}

      {h.documents.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 14 }}>
            Filed or passed at this hearing:
          </span>
          {h.documents.map((d) => (
            <Link key={d.id} to={`/app/cases/${caseId}/documents/${d.id}`} className="tag" style={{ textDecoration: 'none' }}>
              {d.title}
            </Link>
          ))}
        </div>
      )}

      {!h.transcript ? (
        <EmptyState
          title="No transcript for this hearing"
          action={
            <Link className="btn btn-primary" to={`/app/cases/${caseId}/add?tab=transcript&hearingId=${h.hearing.id}`}>
              Paste the transcript
            </Link>
          }
        >
          Paste the stenographer's record, one “Speaker: text” per line. Each turn is numbered and every statement is linked to who said it.
        </EmptyState>
      ) : transcript.isPending ? (
        <SkeletonList rows={6} />
      ) : transcript.isError ? (
        <ErrorState error={transcript.error} retry={() => transcript.refetch()} />
      ) : (
        <>
          <SpeakerMapping caseId={caseId} t={transcript.data} hearingId={hearingId} />
          {transcript.data.analysis !== 'done' && (
            <Banner tone={transcript.data.analysisError ? 'warn' : 'info'}>
              {transcript.data.analysisError === 'Waiting for OPENAI_API_KEY'
                ? 'Saved. Statements will be extracted once the AI agents are configured.'
                : transcript.data.analysisError ?? 'The intake agent is reading this transcript.'}
            </Banner>
          )}
          <div className="split">
            <section aria-labelledby="tx" className="grow sheet" style={{ padding: 12 }}>
              <div className="row-between" style={{ alignItems: 'center', padding: '8px 14px 12px' }}>
                <h2 id="tx" className="section-title">
                  Transcript <span className="muted typed" style={{ fontSize: 13 }}>v{transcript.data.version} · {transcript.data.segmentCount} turns</span>
                </h2>
                <span className="row" style={{ gap: 12, fontSize: 12 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <i style={{ width: 14, height: 3, background: 'var(--blue)', display: 'inline-block' }} />
                    Statement recorded
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <i style={{ width: 14, height: 3, background: 'var(--red)', display: 'inline-block' }} />
                    Contradiction
                  </span>
                </span>
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {transcript.data.segments.map((s) => {
                  const turnClaims = byTurn.get(s.seq) ?? []
                  const isContra = turnClaims.some((c) => contradicted.has(c.claim.id))
                  return (
                    <li key={s.id}>
                      <button type="button" className="turn" aria-pressed={s.seq === sel} onClick={() => selectTurn(s.seq)}>
                        <span className="typed muted" style={{ fontSize: 12, paddingTop: 2 }}>
                          T{s.seq}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: sideColor(s.speaker?.id) }}>{s.speaker?.name ?? s.speakerLabel}</span>
                        <span className={isContra ? 'mark-contra' : turnClaims.length ? 'mark-claim' : undefined} style={{ fontSize: 15, lineHeight: 1.6 }}>
                          {s.text}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </section>
            <aside className="side stack" aria-label={`Turn ${sel}`} style={{ gap: 12 }}>
              <div className="row-between" style={{ alignItems: 'center' }}>
                <h2 className="eyebrow">Turn {sel}</h2>
                {selTurn && <span className="ref">T{sel} · {courtDate(h.hearing.date)}</span>}
              </div>
              <RelatedPanel caseId={caseId} claims={byTurn.get(sel) ?? []} />
            </aside>
          </div>
        </>
      )}
    </>
  )
}
