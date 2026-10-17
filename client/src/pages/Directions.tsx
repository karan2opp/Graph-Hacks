import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState, ErrorState, SkeletonList, Stamp, useToast, type StampTone } from '../components/ui'
import { courtDate, daysBetween, errorMessage, todayIST } from '../lib/format'
import { api } from '../lib/api'
import { keys } from '../lib/queries'
import type { ComplianceReport, DirectionState, DirectionView } from '../types/domain'

type Filter = 'all' | DirectionState
const ORDER: Record<DirectionState, number> = { overdue: 0, pending: 1, in_force: 2, complied: 3, vacated: 4 }
const TABS: [Filter, string][] = [
  ['all', 'All'],
  ['overdue', 'Overdue'],
  ['pending', 'Due'],
  ['in_force', 'In force'],
  ['complied', 'Complied'],
  ['vacated', 'Vacated'],
]

function stampFor(d: DirectionView): { tone: StampTone; label: string; when: string } {
  const today = todayIST()
  const due = d.direction.dueDate
  switch (d.state) {
    case 'overdue':
      return { tone: 'red', label: 'Overdue', when: due ? `${daysBetween(due, today)} days late · due ${courtDate(due)}` : '' }
    case 'pending':
      return { tone: 'brown', label: due ? `Due ${courtDate(due).slice(0, 5)}` : 'Pending', when: due ? `due ${courtDate(due)}` : d.direction.dueText ?? 'no date given' }
    case 'in_force':
      return { tone: 'blue', label: 'In force', when: d.direction.orderDate ? `since ${courtDate(d.direction.orderDate)}` : '' }
    case 'complied': {
      const late = d.compliedBy?.daysLate ?? 0
      return { tone: 'green', label: late > 0 ? `Complied late` : 'Complied', when: d.manual ? 'marked by you' : late > 0 ? `${late} days late` : 'on time' }
    }
    case 'vacated':
      return { tone: 'grey', label: 'Vacated', when: d.vacatedBy?.date ? `on ${courtDate(d.vacatedBy.date)}` : d.manual ? 'marked by you' : '' }
  }
}

function proof(d: DirectionView) {
  if (d.manual) return `Your call${d.manual.note ? `: ${d.manual.note}` : ''} (${courtDate(d.manual.at)})`
  if (d.compliedBy) return `${d.compliedBy.title}${d.compliedBy.evidence ? `: ${d.compliedBy.evidence}` : ''}`
  if (d.vacatedBy) return `${d.vacatedBy.title}${d.vacatedBy.reason ? `: ${d.vacatedBy.reason}` : ''}`
  if (d.noncomplianceRecorded.length) return `Non-compliance recorded in ${d.noncomplianceRecorded.map((n) => n.title).join(', ')}`
  if (d.state === 'overdue') return 'Nothing filed by the party since the order.'
  if (d.state === 'pending') return 'Waiting. The agent checks every new filing by this party.'
  if (d.state === 'in_force') return 'A standing order; it stays in force until vacated.'
  return ''
}

function Override({ caseId, d }: { caseId: string; d: DirectionView }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState(d.manual?.status ?? 'auto')
  const [note, setNote] = useState(d.manual?.note ?? '')
  const save = useMutation({
    mutationFn: () => api.patch(`/directions/${d.direction.id}`, { status, note: status === 'auto' ? undefined : note || undefined }),
    onSuccess: () => {
      toast(status === 'auto' ? 'Handed back to the agent' : 'Your call is saved')
      void qc.invalidateQueries({ queryKey: keys.case(caseId) })
      void qc.invalidateQueries({ queryKey: keys.cases })
      void qc.invalidateQueries({ queryKey: keys.dashboard })
    },
  })
  const dirty = status !== (d.manual?.status ?? 'auto') || (status !== 'auto' && note !== (d.manual?.note ?? ''))
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="field">
        <span className="sr-only">Your call</span>
        <select className="select" style={{ minHeight: 40 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="auto">Let the agent decide</option>
          <option value="complied">Mark complied</option>
          <option value="not_complied">Mark not complied</option>
          <option value="vacated">Mark vacated</option>
        </select>
      </label>
      {status !== 'auto' && <input className="input" style={{ minHeight: 36, fontSize: 13 }} aria-label="Reason (optional)" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
      {dirty && (
        <button type="button" className="btn btn-sm btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </button>
      )}
      {save.error && <span className="field-error">{errorMessage(save.error)}</span>}
    </div>
  )
}

export function DirectionsPage() {
  const { caseId = '' } = useParams()
  const [filter, setFilter] = useState<Filter>('all')
  const directions = useQuery({ queryKey: keys.directions(caseId), queryFn: () => api.get<DirectionView[]>(`/cases/${caseId}/directions`) })
  const report = useQuery({ queryKey: keys.compliance(caseId), queryFn: () => api.get<ComplianceReport>(`/cases/${caseId}/compliance`) })

  const all = [...(directions.data ?? [])].sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.direction.dueDate ?? '9').localeCompare(b.direction.dueDate ?? '9'))
  const shown = filter === 'all' ? all : all.filter((d) => d.state === filter)
  const count = (f: Filter) => (f === 'all' ? all.length : all.filter((d) => d.state === f).length)

  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="page-title">What the court directed</h1>
        <p className="lede">Every direction from every order, who it binds, and the filing or order that shows it was followed. Only filings and later orders count as proof, never what was said at a hearing.</p>
      </div>

      {directions.isPending ? (
        <SkeletonList rows={5} />
      ) : directions.isError ? (
        <ErrorState error={directions.error} retry={() => directions.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState title="No directions yet" action={<Link className="btn" to={`/app/cases/${caseId}/add`}>Add an order</Link>}>
          When you add an order, the intake agent reads its directions and due dates, and the compliance agent watches for the filings that satisfy them.
        </EmptyState>
      ) : (
        <>
          <div className="grid-auto" role="group" aria-label="Filter by status" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className="stack"
                style={{
                  gap: 2,
                  padding: '12px 16px',
                  borderRadius: 3,
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                  border: `1px solid ${filter === id ? 'var(--ink)' : id === 'overdue' && count(id) ? 'var(--red-line)' : 'var(--rule)'}`,
                  background: filter === id ? 'var(--ink)' : id === 'overdue' && count(id) ? 'var(--red-bg)' : 'var(--paper)',
                  color: filter === id ? '#fff' : id === 'overdue' && count(id) ? 'var(--red)' : 'var(--ink)',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                <span className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>
                  {count(id)}
                </span>
              </button>
            ))}
          </div>

          <section aria-labelledby="ledger" className="card-flush">
            <div className="row-between" style={{ alignItems: 'center', padding: '14px 20px' }}>
              <h2 id="ledger" className="section-title">
                {filter === 'all' ? 'All directions, most urgent first' : TABS.find((t) => t[0] === filter)![1]}
              </h2>
              {report.data?.nextHearing && <span className="muted" style={{ fontSize: 13 }}>Next hearing {courtDate(report.data.nextHearing.date)}</span>}
            </div>
            <div className="drow drow-head" aria-hidden="true">
              <span>Status</span>
              <span>Direction</span>
              <span>Binds</span>
              <span>Proof</span>
              <span>Your call</span>
            </div>
            {shown.length === 0 && <p className="muted" style={{ padding: 20 }}>Nothing in this group.</p>}
            {shown.map((d) => {
              const s = stampFor(d)
              return (
                <div key={d.direction.id} className="drow">
                  <span className="stack" style={{ gap: 6 }}>
                    <span>
                      <Stamp tone={s.tone}>{s.label}</Stamp>
                    </span>
                    <span className="ink-2" style={{ fontSize: 12 }}>
                      {s.when}
                    </span>
                  </span>
                  <span className="stack" style={{ gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.4 }}>{d.direction.text}</span>
                    <span className="row" style={{ gap: 8, fontSize: 12 }}>
                      <span className="muted">{d.direction.kind}</span>
                      <Link className="ref" to={`/app/cases/${caseId}/documents/${d.order.documentId}${d.order.paraLabel ? `?para=${d.order.paraLabel}` : ''}`}>
                        [{d.order.title}
                        {d.order.paraLabel ? ` para ${d.order.paraLabel}` : ''}]
                      </Link>
                    </span>
                  </span>
                  <span style={{ fontSize: 14 }}>{d.assignedTo.map((a) => a.name).join(', ') || <span className="muted">Not assigned</span>}</span>
                  <span className="ink-2" style={{ fontSize: 14 }}>
                    {proof(d)}
                  </span>
                  <Override caseId={caseId} d={d} />
                </div>
              )
            })}
          </section>

          {report.data && report.data.byParty.length > 0 && (
            <section aria-label="Compliance record by party" className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              {report.data.byParty.map((p) => (
                <div key={p.party.id} className="card stack" style={{ gap: 10 }}>
                  <span className="eyebrow">
                    {p.party.name} · {p.party.role}
                  </span>
                  <div className="row" style={{ gap: 24 }}>
                    {(
                      [
                        [p.compliedOnTime, 'on time', false],
                        [p.compliedLate, 'complied late', p.compliedLate > 0],
                        [p.overdue, 'overdue now', p.overdue > 0],
                        [p.pending, 'still due', false],
                        [p.adjournmentsSought, 'adjournments sought', p.adjournmentsSought > 1],
                      ] as const
                    ).map(([n, label, bad]) => (
                      <span key={label} className="stack" style={{ gap: 0 }}>
                        <b className="serif" style={{ fontSize: 26, fontWeight: 500, color: bad ? 'var(--red)' : undefined }}>
                          {n}
                        </b>
                        <span className="ink-2" style={{ fontSize: 13 }}>
                          {label}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}
