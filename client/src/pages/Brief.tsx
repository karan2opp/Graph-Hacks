import { Link, useParams } from 'react-router'
import { EmptyState, ErrorState, Skeleton, StaleNotice } from '../components/ui'
import { courtDate, daysBetween, inDays, longDate, plural } from '../lib/format'
import { useBrief } from '../lib/queries'
import type { Brief } from '../types/domain'

const AGENT_LABEL = { intake: 'Intake', 'fact-check': 'Fact-check', compliance: 'Compliance', 'q&a': 'Q&A' } as const

function NextHearing({ b, caseId }: { b: Brief; caseId: string }) {
  const n = b.nextHearing
  const days = n ? daysBetween(b.today, n.date) : null
  return (
    <div className="wood stack" style={{ flex: '1 1 260px', padding: 24, gap: 8 }}>
      <h2 className="eyebrow" style={{ color: 'var(--brass-2)' }}>
        Next hearing
      </h2>
      {n ? (
        <>
          <span className="serif" style={{ fontSize: 56, lineHeight: 1, letterSpacing: '-0.03em' }}>
            {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`}
          </span>
          <span style={{ fontSize: 16 }}>{longDate(n.date)}</span>
          {n.purpose && <span style={{ fontSize: 14, color: 'var(--wood-text)' }}>Listed for: {n.purpose}</span>}
          <Link to={`/app/cases/${caseId}/hearings/${n.id}`} className="btn btn-on-wood btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }}>
            Open hearing
          </Link>
        </>
      ) : (
        <>
          <span className="serif" style={{ fontSize: 30 }}>No date fixed</span>
          <Link to={`/app/cases/${caseId}/hearings/new`} className="btn btn-brass btn-sm" style={{ alignSelf: 'flex-start' }}>
            Add the next date
          </Link>
        </>
      )}
    </div>
  )
}

function Prepared({ b, caseId }: { b: Brief; caseId: string }) {
  const items = [
    ...b.overdue.map((d) => ({
      key: d.direction.id,
      to: `/app/cases/${caseId}/directions`,
      tone: 'red' as const,
      title: `${d.assignedTo.map((a) => a.name).join(', ') || 'Someone'}: ${d.direction.text.replace(/\.$/, '')}`,
      sub: `${daysBetween(d.direction.dueDate!, b.today)} days overdue · was due ${courtDate(d.direction.dueDate)}`,
    })),
    ...b.dueBeforeNextHearing.map((d) => ({
      key: d.direction.id,
      to: `/app/cases/${caseId}/directions`,
      tone: 'plain' as const,
      title: d.direction.text,
      sub: `Due ${courtDate(d.direction.dueDate)} · binds ${d.assignedTo.map((a) => a.name).join(', ') || 'unassigned'}`,
    })),
  ]
  const cross = b.forCross
  return (
    <div className="stack" style={{ flex: '2 1 420px', padding: 24, gap: 12 }}>
      <h3 style={{ fontSize: 20 }}>Walk in prepared</h3>
      {items.length === 0 && cross.length === 0 && <p className="ink-2">Nothing outstanding. No deadlines are past, and no new contradictions came up this week.</p>}
      {items.map((i) => (
        <Link key={i.key} to={i.to} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12, padding: 12, borderRadius: 3, textDecoration: 'none', background: i.tone === 'red' ? 'var(--red-bg)' : 'var(--paper-2)' }}>
          <span aria-hidden="true" style={{ flex: 'none', marginTop: 2, width: 22, height: 22, borderRadius: 4, display: 'inline-grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: i.tone === 'red' ? 'var(--red)' : 'transparent', color: '#fff', border: i.tone === 'red' ? 0 : '2px solid var(--ink)' }}>
            {i.tone === 'red' ? '!' : ''}
          </span>
          <span className="stack" style={{ gap: 2 }}>
            <b style={{ fontWeight: 600 }}>{i.title}</b>
            <span className="ink-2" style={{ fontSize: 14 }}>
              {i.sub}
            </span>
          </span>
        </Link>
      ))}
      {cross.length > 0 && (
        <Link to={`/app/cases/${caseId}/drift`} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12, padding: 12, borderRadius: 3, textDecoration: 'none', background: 'var(--manila-bg)' }}>
          <span aria-hidden="true" style={{ flex: 'none', marginTop: 2, width: 22, height: 22, borderRadius: 4, display: 'inline-grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: 'var(--brown)', color: '#fff' }}>
            {cross.length}
          </span>
          <span className="stack" style={{ gap: 2 }}>
            <b style={{ fontWeight: 600 }}>{plural(cross.length, 'contradiction')} to raise</b>
            <span className="ink-2" style={{ fontSize: 14 }}>
              {[...new Set(cross.map((c) => c.later.madeBy?.name).filter(Boolean))].join(', ') || 'Against the record'}: {cross[0]!.reason}
            </span>
          </span>
        </Link>
      )}
    </div>
  )
}

function Timeline({ b, caseId }: { b: Brief; caseId: string }) {
  return (
    <section aria-labelledby="spine" className="card stack" style={{ gap: 16 }}>
      <div className="row-between" style={{ alignItems: 'center' }}>
        <h2 id="spine" className="section-title">
          The case so far
        </h2>
        <span className="row" style={{ gap: 14, fontSize: 12 }}>
          <span className="row" style={{ gap: 6 }}>
            <i className="dot dot-order" /> Order
          </span>
          <span className="row" style={{ gap: 6 }}>
            <i className="dot" /> Hearing
          </span>
          <span className="row" style={{ gap: 6 }}>
            <i style={{ width: 12, height: 4, background: 'var(--red)', display: 'inline-block' }} /> Contradiction arose
          </span>
        </span>
      </div>
      {b.timeline.length === 0 ? (
        <EmptyState title="No hearings yet" action={<Link className="btn btn-sm" to={`/app/cases/${caseId}/hearings/new`}>Add a hearing</Link>} />
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
          <ol className="spine" style={{ minWidth: Math.max(600, b.timeline.length * 104) }}>
            {b.timeline.map((h, i) => (
              <li key={h.id}>
                <div className="spine-rail">
                  <i className={`dot ${h.upcoming ? 'dot-next' : h.hasOrder ? 'dot-order' : ''}`} />
                  {i < b.timeline.length - 1 && <span className="spine-line" />}
                </div>
                {h.contradiction && <span className="spine-contra" title="A statement made here was later contradicted" />}
                <Link to={`/app/cases/${caseId}/hearings/${h.id}`} className="stack" style={{ gap: 2, textDecoration: 'none', paddingRight: 10 }}>
                  <span className="typed muted" style={{ fontSize: 12 }}>
                    {courtDate(h.date)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
                    {h.upcoming ? 'Next: ' : ''}
                    {h.purpose ?? 'Hearing'}
                    {h.adjourned ? ' (adjourned)' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

export function BriefPage() {
  const { caseId = '' } = useParams()
  const brief = useBrief(caseId)
  if (brief.data === undefined) {
    if (brief.isError) return <ErrorState error={brief.error} retry={() => brief.refetch()} />
    return (
      <div className="stack" style={{ gap: 24 }} aria-busy="true">
        <span className="sr-only" role="status">
          Loading the brief…
        </span>
        <div className="stack" style={{ gap: 10 }}>
          <Skeleton height={13} width="34%" />
          <Skeleton height={36} width="58%" />
          <Skeleton height={14} width="46%" />
        </div>
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <Skeleton height={200} />
          <Skeleton height={200} />
        </div>
        <Skeleton height={140} />
        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      </div>
    )
  }
  const b = brief.data
  const c = b.case
  const judge = b.people.find((p) => p.kind === 'Judge')
  const linkTo = (a: Brief['activity'][number]) =>
    a.link.kind === 'document' ? `documents/${a.link.id}` : a.link.kind === 'drift' ? 'drift' : a.link.kind === 'directions' ? 'directions' : `ask?c=${a.link.id}`

  return (
    <>
      {brief.isError && <StaleNotice error={brief.error} retry={() => brief.refetch()} />}
      <div className="row-between">
        <div className="stack" style={{ gap: 6 }}>
          <span className="typed muted" style={{ fontSize: 13 }}>
            {c.caseNumber} · {c.court}
            {judge ? ` · ${judge.name}` : ''}
          </span>
          <h1 className="page-title">{c.title.replace(/\s+v\.?\s+/i, ' v. ')}</h1>
          <span className="ink-2" style={{ fontSize: 14 }}>
            {c.description ? `${c.description.replace(/\.$/, '')} · ` : ''}Stage: <b>{c.stage}</b> · {plural(c.stats.documents, 'document')}, {plural(c.stats.hearings, 'hearing')} in memory
          </span>
        </div>
        <Link to="add" className="btn btn-primary">
          + Add to memory
        </Link>
      </div>

      <section aria-label="Next hearing" className="card-flush" style={{ display: 'flex', flexWrap: 'wrap' }}>
        <NextHearing b={b} caseId={caseId} />
        <Prepared b={b} caseId={caseId} />
      </section>

      <Timeline b={b} caseId={caseId} />

      <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section aria-labelledby="changed" className="card stack" style={{ gap: 14 }}>
          <h2 id="changed" className="section-title">
            What the agents did lately
          </h2>
          {b.activity.length === 0 ? (
            <p className="ink-2">Nothing yet. Add a document or transcript and the agents start reading.</p>
          ) : (
            b.activity.map((a, i) => (
              <Link key={i} to={linkTo(a)} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12, textDecoration: 'none' }}>
                <span className="typed" style={{ flex: 'none', width: 96, fontSize: 11, fontWeight: 700, padding: '4px 0', textAlign: 'center', borderRadius: 3, background: 'var(--chip)', textTransform: 'uppercase' }}>
                  {AGENT_LABEL[a.agent]}
                </span>
                <span className="stack" style={{ gap: 2, fontSize: 14 }}>
                  <span>{a.text}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {a.at.length > 10 ? `${longDate(a.at)}` : `${longDate(a.at)} · ${inDays(a.at)}`}
                  </span>
                </span>
              </Link>
            ))
          )}
        </section>
        <section aria-labelledby="dispute" className="card stack" style={{ gap: 12 }}>
          <h2 id="dispute" className="section-title">
            What the case is about
          </h2>
          {b.subjects.length === 0 ? (
            <p className="ink-2">The issues appear here once the intake agent has read the pleadings.</p>
          ) : (
            <>
              <p className="quote" style={{ fontSize: 17, lineHeight: 1.55 }}>
                {b.subjects.map((s) => s.subject.name).join(' · ')}
              </p>
              <div className="row" style={{ gap: 8 }}>
                {b.subjects.map((s, i) => (
                  <span key={s.subject.id} className={`tag ${i === 0 ? 'tag-blue' : i === 1 ? 'tag-violet' : ''}`}>
                    {s.subject.name} · {plural(s.claims, 'statement')}
                  </span>
                ))}
              </div>
            </>
          )}
          <Link to="ask" style={{ fontSize: 14, marginTop: 'auto', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
            Ask how the story has moved
          </Link>
        </section>
      </div>
    </>
  )
}
