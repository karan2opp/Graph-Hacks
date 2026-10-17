import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { TopBar } from '../components/TopBar'
import { Banner, EmptyState, Pagination, QueryView, Skeleton, SkeletonList } from '../components/ui'
import { errorMessage, inDays, longDate, plural, todayIST } from '../lib/format'
import { useMe } from '../lib/auth'
import { usePaged } from '../lib/paging'
import { shortTitle, useCaseCards, useDashboard } from '../lib/queries'
import type { CaseCard } from '../types/domain'

const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3600_000).getUTCHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function AttentionStrip() {
  const dash = useDashboard()
  if (dash.data === undefined) {
    if (dash.isError)
      return (
        <Banner tone="warn" action={<button type="button" className="btn btn-sm" onClick={() => dash.refetch()}>Try again</button>}>
          Couldn't load what needs you this week ({errorMessage(dash.error)}).
        </Banner>
      )
    return (
      <div className="grid-auto" aria-busy="true">
        <Skeleton height={150} />
        <Skeleton height={150} />
        <Skeleton height={150} />
      </div>
    )
  }
  const d = dash.data
  const contra = d.newContradictions.reduce((n, c) => n + c.count, 0)
  return (
    <section aria-labelledby="attn" className="stack">
      <h2 id="attn" className="eyebrow">
        Needs you before the next hearings
      </h2>
      <div className="grid-auto">
        <Link to={d.overdue[0] ? `/app/cases/${d.overdue[0].caseId}/directions` : '/app'} className="card stack" style={{ textDecoration: 'none', gap: 8, borderColor: d.overdue.length ? 'var(--red-line)' : undefined }}>
          <span className="row" style={{ fontSize: 13, fontWeight: 600, color: d.overdue.length ? 'var(--red)' : 'var(--ink-2)' }}>
            Overdue directions
          </span>
          <span className="serif" style={{ fontSize: 36, lineHeight: 1 }}>
            {d.overdue.length}
          </span>
          <span className="ink-2" style={{ fontSize: 14 }}>
            {d.overdue.length
              ? d.overdue
                  .slice(0, 2)
                  .map((o) => `${shortTitle(o.caseTitle)}: ${o.text.replace(/\.$/, '')}`)
                  .join('. ')
              : 'Nothing is past its deadline.'}
          </span>
        </Link>
        <Link to={d.nextHearing ? `/app/cases/${d.nextHearing.caseId}` : '/app'} className="card stack" style={{ textDecoration: 'none', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Next hearing</span>
          <span className="serif" style={{ fontSize: 36, lineHeight: 1 }}>
            {d.nextHearing ? inDays(d.nextHearing.date).replace(/^in /, '') : 'None listed'}
          </span>
          <span className="ink-2" style={{ fontSize: 14 }}>
            {d.nextHearing ? `${shortTitle(d.nextHearing.caseTitle)} · ${longDate(d.nextHearing.date)}${d.nextHearing.purpose ? ` · ${d.nextHearing.purpose}` : ''}` : 'Add a hearing date to a case to see it here.'}
          </span>
        </Link>
        <Link to={d.newContradictions[0] ? `/app/cases/${d.newContradictions[0].caseId}/drift` : '/app'} className="card stack" style={{ textDecoration: 'none', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: contra ? 'var(--red)' : 'var(--ink-2)' }}>New contradictions this week</span>
          <span className="serif" style={{ fontSize: 36, lineHeight: 1 }}>
            {contra}
          </span>
          <span className="ink-2" style={{ fontSize: 14 }}>
            {contra ? d.newContradictions.map((c) => `${c.count} in ${shortTitle(c.caseTitle)}`).join(', ') : 'No new changes in anyone’s story.'}
          </span>
        </Link>
      </div>
    </section>
  )
}

type Sort = 'next' | 'action' | 'recent'
const SORTS: [Sort, string][] = [
  ['next', 'Next hearing'],
  ['action', 'Needs action'],
  ['recent', 'Recently added'],
]

function CaseRow({ c }: { c: CaseCard }) {
  return (
    <li>
      <Link to={`/app/cases/${c.case.id}`} className="case-row">
        <span className="stack" style={{ gap: 3, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{c.case.title}</span>
          <span className="typed muted" style={{ fontSize: 13 }}>
            {c.case.caseNumber} · {c.case.court}
          </span>
          {c.linked.length > 0 && (
            <span className="blue" style={{ fontSize: 12 }}>
              Linked to {c.linked.map((l) => l.caseNumber).join(', ')}
            </span>
          )}
        </span>
        <span>
          <span className="tag">{c.case.stage}</span>
        </span>
        <span className="stack" style={{ gap: 2 }}>
          {c.nextHearing ? (
            <>
              <span style={{ fontWeight: 500 }}>{longDate(c.nextHearing.date)}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {inDays(c.nextHearing.date)}
              </span>
            </>
          ) : (
            <span className="muted">No date fixed</span>
          )}
        </span>
        <span className="ink-2" style={{ fontSize: 13 }}>
          {plural(c.documents, 'document')} · {plural(c.hearings, 'hearing')}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {c.overdue > 0 && <span className="tag tag-red">{c.overdue} overdue</span>}
          {c.newContradictions > 0 && <span className="tag tag-manila">{plural(c.newContradictions, 'contradiction')}</span>}
          {!c.overdue && !c.newContradictions && <span className="tag tag-green">All clear</span>}
        </span>
      </Link>
    </li>
  )
}

export function CasesPage() {
  const me = useMe().data!
  const cards = useCaseCards()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('next')

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = (cards.data ?? []).filter((c) => !term || [c.case.title, c.case.caseNumber, c.case.court].some((s) => s.toLowerCase().includes(term)))
    const byNext = (a: CaseCard, b: CaseCard) => (a.nextHearing?.date ?? '9999').localeCompare(b.nextHearing?.date ?? '9999')
    if (sort === 'action') return [...list].sort((a, b) => b.overdue + b.newContradictions - (a.overdue + a.newContradictions) || byNext(a, b))
    if (sort === 'recent') return [...list].sort((a, b) => b.case.createdAt.localeCompare(a.case.createdAt))
    return [...list].sort(byNext)
  }, [cards.data, q, sort])
  const paged = usePaged(shown, 10)

  return (
    <>
      <TopBar />
      <main className="page" id="main">
        <div className="row-between">
          <div className="stack" style={{ gap: 6 }}>
            <span className="typed muted" style={{ fontSize: 13 }}>
              {longDate(todayIST())} · IST
            </span>
            <h1 className="page-title" style={{ fontSize: 38 }}>
              {greeting()}, {me.name.split(' ')[0]}. Here is what your cases remember.
            </h1>
          </div>
          <div className="row">
            <label className="row" style={{ border: '1px solid var(--line)', borderRadius: 3, background: '#fff', padding: '0 12px', minHeight: 44, minWidth: 260, gap: 8, flexWrap: 'nowrap' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.6" aria-hidden="true">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3.5 3.5" />
              </svg>
              <span className="sr-only">Search cases</span>
              <input type="search" value={q} onChange={(e) => (setQ(e.target.value), paged.reset())} placeholder="Search by party, case no., court" style={{ border: 0, outline: 'none', font: 'inherit', fontSize: 14, flex: 1, background: 'transparent' }} />
            </label>
            <Link to="/app/cases/new" className="btn btn-primary">
              + New case
            </Link>
          </div>
        </div>

        {cards.data && cards.data.length > 0 && <AttentionStrip />}

        <QueryView query={cards} loading={<SkeletonList rows={5} />}>
          {(all) =>
            all.length === 0 ? (
              <EmptyState title="Start your first case" action={<Link to="/app/cases/new" className="btn btn-primary">Create a case</Link>}>
                Add the parties and the first hearing, then drop in the plaint, orders and transcripts. The agents will read them and keep the memory up to date.
              </EmptyState>
            ) : (
              <section aria-labelledby="all" className="card-flush" ref={paged.listRef}>
                <div className="row-between" style={{ alignItems: 'center', padding: '14px 20px' }}>
                  <h2 id="all" className="section-title">
                    All cases <span className="muted" style={{ fontSize: 15 }}>· {all.length} active</span>
                  </h2>
                  <div className="pills" role="group" aria-label="Sort cases">
                    {SORTS.map(([id, label]) => (
                      <button key={id} type="button" className="pill" aria-pressed={sort === id} onClick={() => (setSort(id), paged.reset())}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="case-row case-row-head" aria-hidden="true">
                  <span>Case</span>
                  <span>Stage</span>
                  <span>Next hearing</span>
                  <span>In memory</span>
                  <span>Flags</span>
                </div>
                {shown.length ? (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {paged.items.map((c) => (
                      <CaseRow key={c.case.id} c={c} />
                    ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ padding: 20 }}>
                    No case matches “{q}”.
                  </p>
                )}
                <div style={{ padding: '6px 20px 16px' }}>
                  <Pagination paged={paged} noun={['case', 'cases']} />
                </div>
              </section>
            )
          }
        </QueryView>
        <p className="muted" style={{ fontSize: 12 }}>
          A case organiser and memory aid for lawyers, not legal advice.
        </p>
      </main>
    </>
  )
}
