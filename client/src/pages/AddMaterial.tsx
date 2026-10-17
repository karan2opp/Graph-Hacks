import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Banner, Field, QueryView, Skeleton } from '../components/ui'
import { courtDate, errorMessage, plural } from '../lib/format'
import { api, ApiError } from '../lib/api'
import { keys, useDocuments, useHearings, usePeople } from '../lib/queries'
import type { DocumentDetail, DocumentNode, TranscriptView } from '../types/domain'
import { DOC_TYPES, docState } from '../lib/documents'

type Tab = 'file' | 'paste' | 'transcript'
const MAX_MB = 100
const ACCEPT = 'application/pdf,image/*,text/plain'

type Step = { title: string; detail: string; state: 'done' | 'run' | 'wait' | 'bad' }

/** The reading pipeline for one document, worked out from its status fields. */
function pipeline(d: DocumentDetail): Step[] {
  const ai = d.analysisError !== 'Waiting for OPENAI_API_KEY'
  const read = d.status !== 'stored' && d.status !== 'failed'
  const indexed = d.status === 'ready'
  const analysed = d.analysis === 'done'
  const raw = d as DocumentDetail & { contradictionCount?: number; directionCount?: number; complianceLinks?: number; factcheckError?: string | null }
  const later = (on: boolean, label: string): Step['state'] => (on ? 'done' : !ai ? 'wait' : label === 'run' ? 'run' : 'wait')
  return [
    { title: 'Stored', detail: d.fileUrl ? 'Original kept; the memory keeps a link to it.' : 'Saved to the case.', state: 'done' },
    { title: 'Read', detail: read ? `${plural(d.pageCount ?? 1, 'page')} of text.` : d.note ?? 'No readable text.', state: read ? 'done' : 'bad' },
    { title: 'Split into paragraphs', detail: read ? `${plural(d.chunkCount ?? d.chunks ?? 0, 'paragraph')}, each citable by page and number.` : 'Skipped.', state: read ? 'done' : 'bad' },
    { title: 'Indexed for search', detail: indexed ? 'Searchable by meaning.' : ai ? 'Working…' : 'Waiting for the AI agents.', state: later(indexed, read && !indexed ? 'run' : '') },
    {
      title: 'Intake agent',
      detail: analysed ? (d.type === 'order' ? `${plural(raw.directionCount ?? 0, 'direction')} recorded.` : `${plural(d.claimCount ?? 0, 'statement')} recorded.`) : d.analysis === 'failed' ? (d.analysisError ?? 'Failed.') : ai ? 'Reading who said what…' : 'Waiting for the AI agents.',
      state: d.analysis === 'failed' ? 'bad' : later(analysed, d.analysis === 'running' ? 'run' : ''),
    },
    {
      title: 'Fact-check agent',
      detail: analysed ? (raw.factcheckError ? `Failed: ${raw.factcheckError}` : `${plural(raw.contradictionCount ?? 0, 'contradiction')} found.`) : 'Compares each statement with earlier ones.',
      state: analysed ? (raw.factcheckError ? 'bad' : 'done') : 'wait',
    },
    {
      title: 'Compliance agent',
      detail: analysed ? `${plural(raw.complianceLinks ?? 0, 'direction')} checked against this.` : 'Checks whether this satisfies a pending direction.',
      state: analysed ? 'done' : 'wait',
    },
  ]
}

function Pipeline({ caseId, documentId }: { caseId: string; documentId: string }) {
  const doc = useQuery({
    queryKey: keys.document(caseId, documentId),
    queryFn: () => api.get<DocumentDetail>(`/documents/${documentId}`),
    refetchInterval: (q) => (q.state.data && docState(q.state.data).text === 'Being read' ? 2000 : false),
  })
  return (
    <QueryView
      query={doc}
      loading={
        <div className="card stack" style={{ gap: 12 }} aria-busy="true">
          <Skeleton height={20} width="70%" />
          {[80, 64, 72, 58, 66].map((w, i) => (
            <Skeleton key={i} height={14} width={`${w}%`} />
          ))}
        </div>
      }
    >
      {(d) => <PipelineSteps caseId={caseId} d={d} />}
    </QueryView>
  )
}

function PipelineSteps({ caseId, d }: { caseId: string; d: DocumentDetail }) {
  return (
    <section className="card stack" aria-live="polite" aria-labelledby="live" style={{ gap: 14 }}>
      <div className="row-between" style={{ alignItems: 'center' }}>
        <h2 id="live" className="section-title">
          Reading “{d.title}”
        </h2>
        <span className="typed muted" style={{ fontSize: 12 }}>
          {d.pageCount ? plural(d.pageCount, 'page') : ''}
        </span>
      </div>
      <ol className="pipeline">
        {pipeline(d).map((s, i, all) => (
          <li key={s.title}>
            <span className="pipe-rail">
              <i className={`pipe-dot pipe-${s.state}`} aria-hidden="true">
                {s.state === 'done' ? '✓' : s.state === 'bad' ? '!' : ''}
              </i>
              {i < all.length - 1 && <span />}
            </span>
            <span className="stack" style={{ gap: 2, paddingBottom: 14 }}>
              <b style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</b>
              <span className="ink-2" style={{ fontSize: 13 }}>
                {s.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="row">
        <Link to={`/app/cases/${caseId}/documents/${d.id}`} className="btn btn-sm">
          Open the document
        </Link>
        <Link to={`/app/cases/${caseId}/drift`} className="btn btn-sm">
          See story drift
        </Link>
      </div>
    </section>
  )
}

export function AddMaterialPage() {
  const { caseId = '' } = useParams()
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const people = usePeople(caseId)
  const hearings = useHearings(caseId)
  const docs = useDocuments(caseId)
  const fileRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'file')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [text, setText] = useState('')
  const [type, setType] = useState('order')
  const [title, setTitle] = useState('')
  const [filedById, setFiledById] = useState('')
  const [date, setDate] = useState('')
  const [filedOn, setFiledOn] = useState('')
  const [hearingId, setHearingId] = useState(params.get('hearingId') ?? '')
  const [created, setCreated] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const parties = (people.data ?? []).filter((p) => p.kind === 'Party')
  const heard = [...(hearings.data ?? [])].reverse()

  const pickFile = (f: File | undefined | null) => {
    if (!f) return
    if (f.size > MAX_MB * 1024 * 1024) {
      setNotice(`That file is over ${MAX_MB} MB. Split it or compress it first.`)
      return
    }
    setNotice(null)
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '))
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (tab === 'transcript') {
        if (!hearingId) throw new ApiError(422, 'Choose the hearing this transcript is from', 'VALIDATION_ERROR', [{ field: 'body.hearingId', message: 'Choose the hearing' }])
        await api.post<TranscriptView>(`/hearings/${hearingId}/transcripts`, { text })
        return { kind: 'transcript' as const }
      }
      const fields = { title: title.trim(), type, date: date || undefined, filedOn: filedOn || undefined, hearingId: hearingId || undefined, filedById: filedById || undefined }
      const doc =
        tab === 'file'
          ? await api.upload<DocumentNode>(`/cases/${caseId}/documents`, file!, fields as Record<string, string | undefined>)
          : await api.post<DocumentNode>(`/cases/${caseId}/documents`, { ...fields, text })
      return { kind: 'document' as const, doc }
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.case(caseId) })
      void qc.invalidateQueries({ queryKey: keys.cases })
      if (r.kind === 'document') {
        setCreated(r.doc.id)
        setNotice(null)
      } else {
        setNotice('Transcript saved. Open the hearing to see the numbered turns.')
      }
      setFile(null)
      setText('')
      setTitle('')
    },
  })
  const errs = submit.error instanceof ApiError ? submit.error.fieldErrors() : {}
  const canSubmit = tab === 'file' ? !!file && !!title.trim() : tab === 'paste' ? !!text.trim() && !!title.trim() : !!text.trim()

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit.mutate()
  }

  return (
    <div className="split">
      <form className="grow stack" style={{ gap: 18 }} onSubmit={onSubmit} noValidate>
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="page-title">Add to the case memory</h1>
          <p className="lede">Drop a filing, an order or a hearing transcript. The agents read it, link it to people and earlier statements, and update deadlines.</p>
        </div>

        <div role="tablist" aria-label="Source" className="row" style={{ gap: 4, padding: 4, background: 'var(--hover)', borderRadius: 4, alignSelf: 'flex-start' }}>
          {(
            [
              ['file', 'Upload file'],
              ['paste', 'Paste text'],
              ['transcript', 'Hearing transcript'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className="btn btn-sm"
              style={{ border: 0, background: tab === id ? 'var(--paper)' : 'transparent', fontWeight: tab === id ? 600 : 400, boxShadow: tab === id ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}
            >
              {label}
            </button>
          ))}
        </div>

        {(people.isError || hearings.isError) && (
          <Banner tone="warn" action={<button type="button" className="btn btn-sm" onClick={() => (people.refetch(), hearings.refetch())}>Try again</button>}>
            This case's hearings and parties couldn't be loaded, so those lists are empty.
          </Banner>
        )}
        {notice && <Banner tone="info">{notice}</Banner>}
        {submit.error && !(submit.error instanceof ApiError && submit.error.statusCode === 422 && Object.keys(errs).length) && <Banner tone="error">{errorMessage(submit.error)}</Banner>}

        {tab === 'file' && (
          <label
            className="dropzone"
            data-over={dragOver || undefined}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              pickFile(e.dataTransfer.files[0])
            }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 4h12l8 8v24H12z" />
              <path d="M24 4v8h8" />
              <path d="M22 30V18M17 23l5-5 5 5" />
            </svg>
            {file ? (
              <>
                <b>{file.name}</b>
                <span className="muted">{(file.size / 1024 / 1024).toFixed(1)} MB · click to choose another</span>
              </>
            ) : (
              <>
                <b style={{ fontSize: 17 }}>Drop a PDF, image or scan here</b>
                <span className="muted">or click to browse · scans are read with OCR · the same file twice is recognised</span>
              </>
            )}
            <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>
        )}
        {tab === 'paste' && (
          <Field label="Paste the text" hint="Keep the paragraph numbers. A blank line separates paragraphs." error={errs.text}>
            {(p) => <textarea {...p} className="textarea typed" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1. That the defendant denies having received any payment of Rs. 5,00,000 from the plaintiff.\n\n2. That the alleged promissory note dated 12.03.2019 is forged.'} />}
          </Field>
        )}
        {tab === 'transcript' && (
          <>
            <Field label="Paste the transcript" hint="One “Speaker: text” per line. Speakers are matched to people in the case: “Court”, “Ld. Counsel for Defendant”, “PW1”." error={errs.text}>
              {(p) => <textarea {...p} className="textarea typed" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Court: Is the witness present?\nLd. Counsel for Defendant: Yes, Your Honour.\nDW1: I received the amount as a friendly loan.'} />}
            </Field>
            <Field label="From the hearing of" error={errs.hearingId}>
              {(p) => (
                <select {...p} className="select" value={hearingId} onChange={(e) => setHearingId(e.target.value)}>
                  <option value="">Choose a hearing…</option>
                  {heard.map((h) => (
                    <option key={h.hearing.id} value={h.hearing.id}>
                      {courtDate(h.hearing.date)} · {h.hearing.purpose ?? 'Hearing'}
                      {h.hasTranscript ? ' (replaces current transcript)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}

        {tab !== 'transcript' && (
          <fieldset>
            <legend>About this document</legend>
            <div className="form-grid">
              <Field label="What is it?" error={errs.type}>
                {(p) => (
                  <select {...p} className="select" value={type} onChange={(e) => setType(e.target.value)}>
                    {Object.entries(DOC_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Title" error={errs.title}>
                {(p) => <input {...p} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Affidavit of DW1" />}
              </Field>
              {type !== 'order' && type !== 'judgment' && (
                <Field label="Filed by" error={errs.filedById}>
                  {(p) => (
                    <select {...p} className="select" value={filedById} onChange={(e) => setFiledById(e.target.value)}>
                      <option value="">Not filed by a party</option>
                      {parties.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} ({x.role})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <Field label={type === 'order' ? 'Passed at hearing' : 'At hearing (optional)'} error={errs.hearingId ?? errs[''] }>
                {(p) => (
                  <select {...p} className="select" value={hearingId} onChange={(e) => setHearingId(e.target.value)}>
                    <option value="">{type === 'order' ? 'Choose the hearing…' : 'Not linked to a hearing'}</option>
                    {heard.map((h) => (
                      <option key={h.hearing.id} value={h.hearing.id}>
                        {courtDate(h.hearing.date)} · {h.hearing.purpose ?? 'Hearing'}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Date of the document" error={errs.date} hint={type === 'order' ? 'Defaults to the hearing date.' : undefined}>
                {(p) => <input {...p} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
              </Field>
              <Field label="Filed in court on" error={errs.filedOn} hint="Used to check deadlines.">
                {(p) => <input {...p} className="input" type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />}
              </Field>
            </div>
            {type === 'order' && hearings.data && heard.length === 0 && (
              <p className="field-error" style={{ marginTop: 10 }}>
                An order belongs to a hearing. <Link to={`/app/cases/${caseId}/hearings/new`}>Add the hearing first</Link>.
              </p>
            )}
          </fieldset>
        )}

        <div className="row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={!canSubmit || submit.isPending}>
            {submit.isPending ? 'Saving…' : tab === 'transcript' ? 'Add transcript' : 'Add & read'}
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Usually under a minute. You can keep working.
          </span>
        </div>
      </form>

      <aside className="side stack" style={{ gap: 16 }}>
        {created ? (
          <Pipeline caseId={caseId} documentId={created} />
        ) : (
          <div className="card stack" style={{ gap: 8 }}>
            <h2 className="section-title">What happens next</h2>
            <p className="ink-2" style={{ fontSize: 14 }}>
              The file is stored, its text read page by page, and every numbered paragraph kept with its page. Then the intake agent records who said what, the fact-check agent compares it with earlier statements, and the compliance agent checks deadlines.
            </p>
          </div>
        )}
        <div className="card stack" style={{ gap: 10 }}>
          <h3 style={{ fontSize: 16 }}>Recently added</h3>
          {docs.isPending && [70, 55, 62].map((w, i) => <Skeleton key={i} height={14} width={`${w}%`} />)}
          {docs.isError && !docs.data && (
            <p className="muted" style={{ fontSize: 14 }}>
              Couldn't load the documents.{' '}
              <button type="button" className="link-btn" onClick={() => docs.refetch()}>
                Try again
              </button>
            </p>
          )}
          {docs.data?.length === 0 && <p className="muted" style={{ fontSize: 14 }}>Nothing on file yet.</p>}
          {(docs.data ?? [])
            .slice()
            .sort((a, b) => b.document.createdAt.localeCompare(a.document.createdAt))
            .slice(0, 4)
            .map((d) => {
              const s = docState(d.document)
              return (
                <Link key={d.document.id} to={`/app/cases/${caseId}/documents/${d.document.id}`} className="row-between" style={{ textDecoration: 'none', alignItems: 'center', fontSize: 14 }}>
                  <span>{d.document.title}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: s.tone === 'ok' ? 'var(--green)' : s.tone === 'wait' ? 'var(--brown)' : 'var(--red)' }}>{s.text}</span>
                </Link>
              )
            })}
        </div>
      </aside>
    </div>
  )
}
