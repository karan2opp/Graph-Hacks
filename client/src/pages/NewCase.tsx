import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Crumb, TopBar } from '../components/TopBar'
import { Banner, Field } from '../components/ui'
import { errorMessage } from '../lib/format'
import { api, ApiError } from '../lib/api'
import { keys } from '../lib/queries'
import type { CaseNode, Person } from '../types/domain'

const STAGES = ['Filing', 'Pleadings', 'Framing of issues', 'Evidence', 'Arguments', 'Judgment', 'Execution']
const FIRST_ROLES = ['plaintiff', 'petitioner', 'appellant', 'complainant', 'prosecution'] as const
const SECOND_ROLES = ['defendant', 'respondent', 'accused'] as const

function Steps({ at }: { at: 1 | 2 | 3 }) {
  const labels = ['Case details', 'People', 'First hearing']
  return (
    <ol aria-label="Steps" className="row" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const done = n < at
        const current = n === at
        return (
          <li
            key={l}
            aria-current={current ? 'step' : undefined}
            className="tag"
            style={{
              padding: '8px 14px',
              background: current ? 'var(--ink)' : done ? 'var(--green-bg)' : 'var(--paper)',
              color: current ? '#fff' : done ? 'var(--green)' : 'var(--ink-2)',
              border: current || done ? 0 : '1px solid var(--rule)',
              fontWeight: current || done ? 600 : 400,
            }}
          >
            {done ? '✓' : `${n} ·`} {l}
          </li>
        )
      })}
    </ol>
  )
}

interface Side {
  party: string
  role: string
  lawyer: string
  witnesses: string // "PW1 Ramesh Kumar" per line
}

/** "PW1 Ramesh Kumar" / "PW1 - Ramesh Kumar" -> { code: "PW1", name: "Ramesh Kumar" } */
function parseWitnesses(text: string) {
  return text
    .split(/\n|,/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([A-Z]{1,3}W\s?\d{1,3})\s*[-–:·.]?\s*(.+)$/i.exec(l)
      return m ? { code: m[1]!.replace(/\s/g, '').toUpperCase(), name: m[2]!.trim() } : { code: undefined, name: l }
    })
}

export function NewCasePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [created, setCreated] = useState<CaseNode | null>(null)
  const [details, setDetails] = useState({ caseNumber: '', title: '', court: '', caseType: 'civil', stage: 'Filing', filedOn: '', description: '' })
  const [first, setFirst] = useState<Side>({ party: '', role: 'plaintiff', lawyer: '', witnesses: '' })
  const [second, setSecond] = useState<Side>({ party: '', role: 'defendant', lawyer: '', witnesses: '' })
  const [judge, setJudge] = useState('')

  const createCase = useMutation({
    mutationFn: () =>
      api.post<CaseNode>('/cases', {
        ...details,
        filedOn: details.filedOn || undefined,
        description: details.description || undefined,
      }),
    onSuccess: (c) => {
      setCreated(c)
      void qc.invalidateQueries({ queryKey: keys.cases })
      // Pre-fill the parties from "A v. B".
      const [a, b] = c.title.split(/\s+v(?:s)?\.?\s+/i)
      if (a && b) {
        setFirst((s) => ({ ...s, party: s.party || a.trim() }))
        setSecond((s) => ({ ...s, party: s.party || b.trim() }))
      }
      setStep(2)
    },
  })

  const addPeople = useMutation({
    mutationFn: async () => {
      const id = created!.id
      const add = (body: object) => api.post<Person>(`/cases/${id}/people`, body)
      for (const side of [first, second]) {
        if (!side.party.trim()) continue
        const party = await add({ kind: 'party', name: side.party.trim(), role: side.role })
        if (side.lawyer.trim()) await add({ kind: 'lawyer', name: side.lawyer.trim(), representsId: party.id })
        for (const w of parseWitnesses(side.witnesses)) await add({ kind: 'witness', name: w.name, code: w.code, calledById: party.id })
      }
      if (judge.trim()) await add({ kind: 'judge', name: judge.trim() })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.case(created!.id) })
      navigate(`/app/cases/${created!.id}/hearings/new?first=1`)
    },
  })

  const errs = createCase.error instanceof ApiError ? createCase.error.fieldErrors() : {}
  const setD = (k: keyof typeof details) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDetails({ ...details, [k]: e.target.value })

  const submitDetails = (e: FormEvent) => {
    e.preventDefault()
    createCase.mutate()
  }
  const submitPeople = (e: FormEvent) => {
    e.preventDefault()
    addPeople.mutate()
  }

  const sideFields = (label: string, side: Side, set: (s: Side) => void, roles: readonly string[], tone: string) => (
    <fieldset>
      <legend style={{ color: tone }}>{label}</legend>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Party">{(p) => <input {...p} className="input" value={side.party} onChange={(e) => set({ ...side, party: e.target.value })} />}</Field>
        <Field label="Role">
          {(p) => (
            <select {...p} className="select" value={side.role} onChange={(e) => set({ ...side, role: e.target.value })}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r[0]!.toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Lawyer (optional)">{(p) => <input {...p} className="input" placeholder="Adv. …" value={side.lawyer} onChange={(e) => set({ ...side, lawyer: e.target.value })} />}</Field>
        <Field label="Witnesses (optional)" hint="One per line, with the court's code: PW1 Ramesh Kumar">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: 72 }} value={side.witnesses} onChange={(e) => set({ ...side, witnesses: e.target.value })} />}
        </Field>
      </div>
    </fieldset>
  )

  return (
    <>
      <TopBar crumbs={<Crumb>New case</Crumb>} right={<Link to="/app" className="btn btn-on-wood btn-sm">Cancel</Link>} />
      <main className="page" id="main">
        <div className="split">
          <div className="grow stack" style={{ gap: 22 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="typed muted" style={{ fontSize: 13 }}>
                New case · step {step} of 3
              </span>
              <h1 className="page-title">{step === 1 ? 'Which case is this?' : 'Who is in this case?'}</h1>
              <p className="lede">
                {step === 1
                  ? 'The case number and court as they appear on the cause list.'
                  : 'The agents use these people to know whose side every statement is on. You can add more later; unknown speakers in transcripts are flagged for you to map.'}
              </p>
            </div>
            <Steps at={step} />

            {step === 1 ? (
              <form onSubmit={submitDetails} noValidate className="stack" style={{ gap: 16 }}>
                {createCase.error && !(createCase.error instanceof ApiError && createCase.error.statusCode === 422) && <Banner tone="error">{errorMessage(createCase.error)}</Banner>}
                <fieldset>
                  <legend>The case</legend>
                  <div className="form-grid">
                    <Field label="Case number" error={errs.caseNumber}>
                      {(p) => <input {...p} className="input typed" placeholder="CS 412/2020" value={details.caseNumber} onChange={setD('caseNumber')} />}
                    </Field>
                    <Field label="Court" error={errs.court}>
                      {(p) => <input {...p} className="input" placeholder="Civil Judge (Senior Division)" value={details.court} onChange={setD('court')} />}
                    </Field>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <Field label="Title" error={errs.title} hint="As in the cause list: Ramesh Kumar v. Suresh Gupta">
                      {(p) => <input {...p} className="input" value={details.title} onChange={setD('title')} />}
                    </Field>
                  </div>
                  <div className="form-grid" style={{ marginTop: 14 }}>
                    <Field label="Type" error={errs.caseType}>
                      {(p) => (
                        <select {...p} className="select" value={details.caseType} onChange={setD('caseType')}>
                          <option value="civil">Civil</option>
                          <option value="criminal">Criminal</option>
                        </select>
                      )}
                    </Field>
                    <Field label="Stage" error={errs.stage}>
                      {(p) => (
                        <select {...p} className="select" value={details.stage} onChange={setD('stage')}>
                          {STAGES.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label="Filed on (optional)" error={errs.filedOn}>
                      {(p) => <input {...p} className="input" type="date" value={details.filedOn} onChange={setD('filedOn')} />}
                    </Field>
                  </div>
                </fieldset>
                <div className="row-between">
                  <Link to="/app" className="btn">
                    Cancel
                  </Link>
                  <button type="submit" className="btn btn-primary btn-lg" disabled={createCase.isPending}>
                    {createCase.isPending ? 'Creating…' : 'Next: people'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitPeople} noValidate className="stack" style={{ gap: 16 }}>
                <div className="card row-between" style={{ alignItems: 'center' }}>
                  <span className="stack" style={{ gap: 2 }}>
                    <b className="serif" style={{ fontSize: 18 }}>
                      {created!.title}
                    </b>
                    <span className="typed muted" style={{ fontSize: 13 }}>
                      {created!.caseNumber} · {created!.court} · {created!.stage}
                    </span>
                  </span>
                </div>
                {addPeople.error && <Banner tone="error">{errorMessage(addPeople.error)}</Banner>}
                <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                  {sideFields('Plaintiff side', first, setFirst, FIRST_ROLES, 'var(--blue)')}
                  {sideFields('Defendant side', second, setSecond, SECOND_ROLES, 'var(--violet)')}
                </div>
                <fieldset>
                  <legend>Bench</legend>
                  <Field label="Presiding judge (optional)">{(p) => <input {...p} className="input" value={judge} onChange={(e) => setJudge(e.target.value)} />}</Field>
                </fieldset>
                <div className="row-between">
                  <Link to={`/app/cases/${created!.id}`} className="btn">
                    Skip for now
                  </Link>
                  <button type="submit" className="btn btn-primary btn-lg" disabled={addPeople.isPending || !first.party.trim() || !second.party.trim()}>
                    {addPeople.isPending ? 'Saving…' : 'Next: first hearing'}
                  </button>
                </div>
              </form>
            )}
          </div>

          <aside className="side wood wood-panel stack" aria-labelledby="preview" style={{ gap: 14 }}>
            <h2 id="preview" style={{ fontSize: 20, color: 'var(--on-wood)' }}>
              The memory, so far
            </h2>
            <p className="muted" style={{ fontSize: 14 }}>
              Every person becomes a node. Sides come from who represents or calls whom.
            </p>
            <div className="stack" style={{ gap: 10 }}>
              <span className="typed" style={{ fontSize: 13, color: 'var(--brass-2)' }}>
                {details.caseNumber || 'Case number'} · {details.court || 'Court'}
              </span>
              {[
                { side: first, tone: '#9fb0d3', label: 'For the plaintiff' },
                { side: second, tone: '#c9b2e3', label: 'For the defendant' },
              ].map(({ side, tone, label }) => (
                <div key={label} className="stack" style={{ gap: 4, borderLeft: `3px solid ${tone}`, paddingLeft: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--wood-text)' }}>{label}</span>
                  <b style={{ fontWeight: 600 }}>{side.party || '—'}</b>
                  {side.lawyer && <span style={{ fontSize: 14 }}>{side.lawyer}</span>}
                  {parseWitnesses(side.witnesses).map((w) => (
                    <span key={w.name + w.code} className="typed" style={{ fontSize: 13 }}>
                      {w.code ?? 'Witness'} {w.name}
                    </span>
                  ))}
                </div>
              ))}
              {judge && (
                <span style={{ fontSize: 14 }}>
                  Bench: <b>{judge}</b>
                </span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Next: add the first hearing, then the plaint, written statement or an order. The intake agent starts reading immediately.
            </p>
          </aside>
        </div>
      </main>
    </>
  )
}
