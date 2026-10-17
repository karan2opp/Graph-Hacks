import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { FindingCard, Ref } from '../components/Findings'
import { EmptyState, ErrorState, SkeletonList } from '../components/ui'
import { courtDate, plural } from '../lib/format'
import { api } from '../lib/api'
import { keys, usePeople } from '../lib/queries'
import type { ClaimView, Finding, Subject } from '../types/domain'

type Filter = 'all' | 'self' | 'same_side' | 'record' | 'disputes'

/** One person's statements on one subject, oldest first, with the breaks in the story marked. */
function Drift({ caseId, contradictions }: { caseId: string; contradictions: Finding[] }) {
  const people = usePeople(caseId)
  const subjects = useQuery({ queryKey: keys.subjects(caseId), queryFn: () => api.get<Subject[]>(`/cases/${caseId}/subjects`) })
  const lead = contradictions.find((f) => f.category === 'self') ?? contradictions[0]
  const [personId, setPersonId] = useState<string>('')
  const [subjectId, setSubjectId] = useState<string>('')
  const pid = personId || lead?.later.madeBy?.id || ''
  const sid = subjectId || lead?.later.subjects[0]?.id || ''

  const claims = useQuery({
    queryKey: keys.claims(caseId, `person:${pid}:subject:${sid}`),
    queryFn: () => api.get<ClaimView[]>(`/cases/${caseId}/claims?personId=${pid}${sid ? `&subjectId=${sid}` : ''}`),
    enabled: !!pid,
  })
  const breaks = useMemo(() => {
    const pairs = new Set(contradictions.map((f) => `${f.earlier.claim.id}|${f.later.claim.id}`))
    return (a: string, b: string) => pairs.has(`${a}|${b}`) || pairs.has(`${b}|${a}`)
  }, [contradictions])

  const speakers = (people.data ?? []).filter((p) => p.kind === 'Party' || p.kind === 'Witness')
  const person = speakers.find((p) => p.id === pid)
  const subject = subjects.data?.find((s) => s.subject.id === sid)
  const list = claims.data ?? []
  // A statement breaks the story if it contradicts any earlier one shown here.
  const brokeAt = (i: number) => list.slice(0, i).some((prev) => breaks(prev.claim.id, list[i]!.claim.id))

  return (
    <section aria-labelledby="drift" className="wood stack" style={{ borderRadius: 4, padding: 24, gap: 18 }}>
      <div className="row-between" style={{ alignItems: 'flex-end' }}>
        <h2 id="drift" style={{ fontSize: 22, color: 'var(--on-wood)' }}>
          {person ? `${person.name}` : 'Choose a person'}
          {subject ? ` on “${subject.subject.name}”` : ''}
        </h2>
        <div className="row">
          <label className="field" style={{ color: 'var(--wood-text)' }}>
            Person
            <select className="select" value={pid} onChange={(e) => setPersonId(e.target.value)} style={{ minWidth: 220 }}>
              {speakers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.kind === 'Party' ? p.role : p.code ?? 'witness'})
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ color: 'var(--wood-text)' }}>
            Subject
            <select className="select" value={sid} onChange={(e) => setSubjectId(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Everything they said</option>
              {subjects.data?.map((s) => (
                <option key={s.subject.id} value={s.subject.id}>
                  {s.subject.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {claims.isPending && pid ? (
        <SkeletonList rows={2} />
      ) : list.length === 0 ? (
        <p style={{ color: 'var(--wood-text)' }}>No recorded statements by this person{subject ? ' on this subject' : ''} yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <ol className="drift" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(240px, 1fr))`, minWidth: list.length * 250 }}>
            {list.map((c, i) => {
              const broke = brokeAt(i)
              const nextBreaks = i < list.length - 1 && list.slice(0, i + 2).some((p) => breaks(p.claim.id, list[i + 1]!.claim.id))
              return (
                <li key={c.claim.id}>
                  <span className="drift-rail">
                    <i style={{ background: broke ? '#e0806f' : 'var(--on-wood)' }} />
                    {i < list.length - 1 && <span style={{ background: nextBreaks ? '#e0806f' : 'var(--wood-line)' }} />}
                  </span>
                  <span className="typed" style={{ fontSize: 12, color: 'var(--wood-text)' }}>
                    {courtDate(c.claim.statedOn)} · {c.source.type === 'document' ? c.source.title : `hearing, turn ${c.source.turn}`}
                  </span>
                  <span className="serif" style={{ fontSize: 20, color: broke ? '#f2b3a8' : 'var(--on-wood)' }}>
                    {c.claim.text}
                  </span>
                  <span className="quote" style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--wood-text)' }}>
                    “{c.claim.quote}”
                  </span>
                  <span>
                    <Ref caseId={caseId} claim={c} />
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      <p style={{ fontSize: 14, color: 'var(--wood-text)' }}>A red line means the story changed: the later statement cannot be true if the earlier one was.</p>
    </section>
  )
}

export function StoryDriftPage() {
  const { caseId = '' } = useParams()
  const [filter, setFilter] = useState<Filter>('all')
  const [showDismissed, setShowDismissed] = useState(false)
  const contradictions = useQuery({
    queryKey: keys.contradictions(caseId, showDismissed),
    queryFn: () => api.get<Finding[]>(`/cases/${caseId}/contradictions${showDismissed ? '?includeDismissed=true' : ''}`),
  })
  const disputes = useQuery({ queryKey: keys.disputes(caseId), queryFn: () => api.get<Finding[]>(`/cases/${caseId}/disputes`) })

  const all = contradictions.data ?? []
  const count = (c: Filter) => (c === 'disputes' ? (disputes.data?.length ?? 0) : c === 'all' ? all.length : all.filter((f) => f.category === c).length)
  const shown = filter === 'disputes' ? (disputes.data ?? []) : filter === 'all' ? all : all.filter((f) => f.category === filter)
  const active = all.filter((f) => !f.dismissed)

  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="page-title">Story drift</h1>
        <p className="lede">How each person's account has moved over time. A contradiction is only shown when both statements cannot be true together.</p>
      </div>

      {contradictions.isPending ? (
        <SkeletonList rows={3} />
      ) : contradictions.isError ? (
        <ErrorState error={contradictions.error} retry={() => contradictions.refetch()} />
      ) : active.length === 0 && !showDismissed ? (
        <EmptyState title="No contradictions found yet" action={<Link className="btn" to={`/app/cases/${caseId}/add`}>Add a document</Link>}>
          The fact-check agent compares every new statement with what the same person, their side, and the record said before. Findings appear here.
        </EmptyState>
      ) : (
        <Drift caseId={caseId} contradictions={active} />
      )}

      <section aria-labelledby="findings" className="stack" style={{ gap: 14 }}>
        <div className="row-between" style={{ alignItems: 'center' }}>
          <h2 id="findings" className="section-title">
            Findings
          </h2>
          <div className="pills" role="group" aria-label="Filter findings">
            {(
              [
                ['all', 'All'],
                ['self', 'Same person'],
                ['same_side', 'Same side'],
                ['record', 'Against the record'],
                ['disputes', 'Disputes'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className="pill" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label} · {count(id)}
              </button>
            ))}
          </div>
        </div>
        <label className="row" style={{ fontSize: 14, gap: 8 }}>
          <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
          Show findings marked “not a contradiction”
        </label>
        {shown.length === 0 ? (
          <p className="empty ink-2" style={{ fontSize: 15 }}>
            {filter === 'disputes'
              ? 'No points of dispute recorded yet. Disputes are where the two sides simply disagree, which is the case itself rather than a contradiction.'
              : filter === 'same_side'
                ? 'No one has contradicted their own side.'
                : 'Nothing here.'}
          </p>
        ) : (
          shown.map((f) => <FindingCard key={f.id} f={f} caseId={caseId} />)
        )}
        {filter !== 'disputes' && active.length > 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            {plural(active.filter((f) => f.crossPrep).length, 'finding')} in cross prep.
          </p>
        )}
      </section>
    </>
  )
}
