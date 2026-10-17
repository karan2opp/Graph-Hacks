import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Banner, Field, SkeletonList } from '../components/ui'
import { courtDate, errorMessage, todayIST } from '../lib/format'
import { api, ApiError } from '../lib/api'
import { keys, sideOf, useHearings, usePeople } from '../lib/queries'
import type { HearingDetail } from '../types/domain'

type Outcome = 'heard' | 'adjourned' | 'scheduled'
const PURPOSES = ['Appearance', 'Written statement', 'Framing of issues', 'Plaintiff evidence', 'Defendant evidence', 'Cross-examination', 'Arguments', 'Orders', 'Mention']

export function AddHearingPage() {
  const { caseId = '' } = useParams()
  const [params] = useSearchParams()
  const firstHearing = params.get('first') === '1'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const people = usePeople(caseId)
  const hearings = useHearings(caseId)

  const [date, setDate] = useState(todayIST())
  const [purpose, setPurpose] = useState('')
  const [itemNo, setItemNo] = useState('')
  const [judgeId, setJudgeId] = useState('')
  const [present, setPresent] = useState<Record<string, boolean>>({})
  const [outcome, setOutcome] = useState<Outcome>('heard')
  const [adjournedBy, setAdjournedBy] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [nextDate, setNextDate] = useState('')
  const [nextPurpose, setNextPurpose] = useState('')

  const list = people.data ?? []
  const judges = list.filter((p) => p.kind === 'Judge')
  const parties = list.filter((p) => p.kind === 'Party')
  const attendees = list.filter((p) => p.kind !== 'Judge')
  const isFuture = date > todayIST()
  const effectiveOutcome: Outcome = isFuture ? 'scheduled' : outcome

  const neighbours = useMemo(() => {
    const dates = (hearings.data ?? []).map((h) => h.hearing)
    const before = dates.filter((h) => h.date < date).at(-1)
    const after = dates.find((h) => h.date > date)
    return { before, after }
  }, [hearings.data, date])

  const save = useMutation({
    mutationFn: async (then: 'list' | 'add') => {
      const body = {
        date,
        purpose: purpose || undefined,
        courtRoom: itemNo ? `Item ${itemNo}` : undefined,
        judgeId: judgeId || judges[0]?.id || undefined,
        status: effectiveOutcome === 'scheduled' ? 'scheduled' : 'held',
        adjourned: effectiveOutcome === 'adjourned',
        adjournmentReason: effectiveOutcome === 'adjourned' && reason ? reason : undefined,
        adjournedAtRequestOfId: effectiveOutcome === 'adjourned' && adjournedBy ? adjournedBy : undefined,
        outcome: notes || undefined,
        appearances: effectiveOutcome === 'scheduled' ? undefined : Object.entries(present).filter(([, v]) => v).map(([personId]) => ({ personId, present: true })),
      }
      const created = await api.post<HearingDetail>(`/cases/${caseId}/hearings`, body)
      if (nextDate && nextDate > date) {
        await api.post(`/cases/${caseId}/hearings`, { date: nextDate, purpose: nextPurpose || undefined, judgeId: body.judgeId, status: 'scheduled' })
      }
      return { created, then }
    },
    onSuccess: ({ created, then }) => {
      void qc.invalidateQueries({ queryKey: keys.case(caseId) })
      void qc.invalidateQueries({ queryKey: keys.cases })
      void qc.invalidateQueries({ queryKey: keys.dashboard })
      navigate(then === 'add' ? `/app/cases/${caseId}/add?hearingId=${created.hearing.id}` : `/app/cases/${caseId}/hearings`)
    },
  })
  const errs = save.error instanceof ApiError ? save.error.fieldErrors() : {}
  const submit = (then: 'list' | 'add') => (e?: FormEvent) => {
    e?.preventDefault()
    save.mutate(then)
  }

  if (people.isPending) return <SkeletonList rows={4} />

  return (
    <div className="split">
      <form className="grow stack" style={{ gap: 18 }} noValidate onSubmit={submit('list')}>
        <div className="stack" style={{ gap: 6 }}>
          {firstHearing && <span className="typed muted" style={{ fontSize: 13 }}>New case · step 3 of 3</span>}
          <h1 className="page-title">{firstHearing ? 'Add the first hearing' : 'Add a hearing'}</h1>
          <p className="lede">Record the date the matter was listed. Orders and transcripts from this date can be added right after.</p>
        </div>
        {save.error && !(save.error instanceof ApiError && save.error.statusCode === 422) && <Banner tone="error">{errorMessage(save.error)}</Banner>}

        <fieldset>
          <legend>The listing</legend>
          <div className="form-grid">
            <Field label="Date" error={errs.date}>
              {(p) => <input {...p} className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Listed for" error={errs.purpose}>
              {(p) => (
                <>
                  <input {...p} className="input" list="purposes" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Cross-examination of DW1" />
                  <datalist id="purposes">
                    {PURPOSES.map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Item no. on the cause list">{(p) => <input {...p} className="input" inputMode="numeric" value={itemNo} onChange={(e) => setItemNo(e.target.value.replace(/\D/g, ''))} />}</Field>
            {judges.length > 0 && (
              <Field label="Bench">
                {(p) => (
                  <select {...p} className="select" value={judgeId || judges[0]!.id} onChange={(e) => setJudgeId(e.target.value)}>
                    {judges.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
        </fieldset>

        {isFuture ? (
          <Banner tone="info">This date is in the future, so it is saved as the next listing. Come back after the hearing to record what happened.</Banner>
        ) : (
          <>
            {attendees.length > 0 && (
              <fieldset>
                <legend>Who appeared</legend>
                <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  {attendees.map((p) => {
                    const side = sideOf(p, list)
                    return (
                      <label key={p.id} className="check">
                        <input type="checkbox" checked={!!present[p.id]} onChange={(e) => setPresent({ ...present, [p.id]: e.target.checked })} />
                        {p.name}
                        <span style={{ fontSize: 12, color: side === 'first' ? 'var(--blue)' : side === 'second' ? 'var(--violet)' : 'var(--muted)' }}>
                          {p.code ?? (p.kind === 'Party' ? p.role : p.kind.toLowerCase())}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}
            <fieldset>
              <legend>What happened</legend>
              <div className="pills" role="radiogroup" aria-label="Outcome">
                {(
                  [
                    ['heard', 'Heard'],
                    ['adjourned', 'Adjourned'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={outcome === id} className="pill" aria-pressed={outcome === id} onClick={() => setOutcome(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {outcome === 'adjourned' && (
                <div className="form-grid" style={{ marginTop: 14 }}>
                  <Field label="At the request of">
                    {(p) => (
                      <select {...p} className="select" value={adjournedBy} onChange={(e) => setAdjournedBy(e.target.value)}>
                        <option value="">The court (no time)</option>
                        {parties.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.role})
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Reason or costs">{(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Counsel sought time; costs Rs. 2,000" />}</Field>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <Field label="Note (optional)" hint="Anything the order or transcript will not say.">
                  {(p) => <textarea {...p} className="textarea" style={{ minHeight: 72 }} value={notes} onChange={(e) => setNotes(e.target.value)} />}
                </Field>
              </div>
            </fieldset>
            <fieldset>
              <legend>Next date</legend>
              <div className="form-grid">
                <Field label="Next hearing (optional)">{(p) => <input {...p} className="input" type="date" min={date} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />}</Field>
                <Field label="Listed for">{(p) => <input {...p} className="input" list="purposes" value={nextPurpose} onChange={(e) => setNextPurpose(e.target.value)} />}</Field>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                If the order fixes a different date, the intake agent corrects it when you add the order.
              </p>
            </fieldset>
          </>
        )}

        <div className="row-between">
          <button type="submit" className="btn" disabled={save.isPending}>
            Save hearing
          </button>
          <button type="button" className="btn btn-primary btn-lg" disabled={save.isPending} onClick={() => submit('add')()}>
            {save.isPending ? 'Saving…' : 'Save and add the order or transcript'}
          </button>
        </div>
        {firstHearing && (
          <Link to={`/app/cases/${caseId}`} className="muted" style={{ fontSize: 14 }}>
            Skip, I'll add hearings later
          </Link>
        )}
      </form>

      <aside className="side wood wood-panel stack" aria-labelledby="where" style={{ gap: 16 }}>
        <h2 id="where" style={{ fontSize: 20, color: 'var(--on-wood)' }}>
          Where it goes
        </h2>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
          {neighbours.before && (
            <li className="typed" style={{ color: 'var(--wood-text)', fontSize: 14 }}>
              {courtDate(neighbours.before.date)} · {neighbours.before.purpose ?? 'Hearing'}
            </li>
          )}
          <li>
            <span className="typed" style={{ color: 'var(--brass-2)', fontSize: 14 }}>
              {courtDate(date)} · this hearing
            </span>
            <div style={{ fontWeight: 600 }}>
              {purpose || 'Hearing'}
              {effectiveOutcome === 'adjourned' ? ', adjourned' : effectiveOutcome === 'scheduled' ? ', listed' : ''}
            </div>
          </li>
          {(nextDate || neighbours.after) && (
            <li className="typed" style={{ color: 'var(--wood-text)', fontSize: 14 }}>
              {courtDate(nextDate || neighbours.after!.date)} · next{nextPurpose ? ` · ${nextPurpose}` : ''}
            </li>
          )}
        </ol>
        <p className="muted" style={{ fontSize: 14 }}>
          The compliance agent checks which directions fall due before the next date and puts them on the brief.
        </p>
      </aside>
    </div>
  )
}
