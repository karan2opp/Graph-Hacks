import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { FindingCard } from '../components/Findings'
import { Banner, EmptyState, ErrorState, Pagination, QueryView, Skeleton, SkeletonList, StaleNotice, useToast } from '../components/ui'
import { courtDate, errorMessage, plural } from '../lib/format'
import { api } from '../lib/api'
import { DOC_TYPES, docState } from '../lib/documents'
import { usePaged } from '../lib/paging'
import { keys, useDocuments } from '../lib/queries'
import type { Chunk, ClaimView, DocumentDetail, DocumentListItem, Finding } from '../types/domain'

const TONE_COLOR = { ok: 'var(--green)', wait: 'var(--brown)', bad: 'var(--red)' }

type Group = 'all' | 'pleading' | 'affidavit' | 'order' | 'evidence' | 'attention'

export function DocumentsPage() {
  const { caseId = '' } = useParams()
  const docs = useDocuments(caseId)
  const [group, setGroup] = useState<Group>('all')
  const [q, setQ] = useState('')

  const all = useMemo(() => [...(docs.data ?? [])].sort((a, b) => (b.document.filedOn ?? b.document.date ?? '').localeCompare(a.document.filedOn ?? a.document.date ?? '')), [docs.data])
  const attention = all.filter((d) => docState(d.document).tone !== 'ok')
  const shown = all.filter((d) => {
    if (group === 'attention' && docState(d.document).tone === 'ok') return false
    if (group !== 'all' && group !== 'attention' && DOC_TYPES[d.document.type]?.group !== group) return false
    return !q.trim() || d.document.title.toLowerCase().includes(q.trim().toLowerCase())
  })
  const paged = usePaged(shown, 8)
  const show = (g: Group) => (setGroup(g), paged.reset())
  // Keep polling while anything is still being read.
  const busy = all.some((d) => docState(d.document).text === 'Being read')
  const qc = useQueryClient()
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: keys.documents(caseId) }), 3000)
    return () => clearInterval(t)
  }, [busy, qc, caseId])

  return (
    <>
      <div className="row-between">
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="page-title">Documents</h1>
          <p className="lede">Everything on file, newest first.</p>
        </div>
        <div className="row">
          <label className="row" style={{ border: '1px solid var(--line)', borderRadius: 3, background: '#fff', padding: '0 12px', minHeight: 44, gap: 8 }}>
            <span className="sr-only">Search documents</span>
            <input type="search" value={q} onChange={(e) => (setQ(e.target.value), paged.reset())} placeholder="Search titles" style={{ border: 0, outline: 'none', font: 'inherit', fontSize: 14, background: 'transparent' }} />
          </label>
          <Link to={`/app/cases/${caseId}/add`} className="btn btn-primary">
            + Add document
          </Link>
        </div>
      </div>
      <QueryView query={docs} loading={<SkeletonList rows={6} />}>
        {() =>
      all.length === 0 ? (
        <EmptyState title="Nothing on file yet" action={<Link className="btn btn-primary" to={`/app/cases/${caseId}/add`}>Add the plaint or an order</Link>}>
          Upload a PDF or scan, or paste the text. Each numbered paragraph is kept with its page so every citation points to the exact place.
        </EmptyState>
      ) : (
        <>
          {attention.length > 0 && group !== 'attention' && (
            <Banner tone="warn" action={<button type="button" className="btn btn-sm" onClick={() => show('attention')}>Show them</button>}>
              <b>{plural(attention.length, 'document')} need your attention.</b> {attention.map((d) => `${d.document.title}: ${docState(d.document).text.toLowerCase()}`).join('. ')}.
            </Banner>
          )}
          <div className="pills" role="group" aria-label="Type">
            {(
              [
                ['all', `All ${all.length}`],
                ['pleading', 'Pleadings'],
                ['affidavit', 'Affidavits'],
                ['order', 'Orders'],
                ['evidence', 'Evidence'],
                ...(attention.length ? [['attention', `Needs attention ${attention.length}`]] : []),
              ] as [Group, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" className="pill" aria-pressed={group === id} onClick={() => show(id)}>
                {label}
              </button>
            ))}
          </div>
          <section className="card-flush" aria-label="Documents" ref={paged.listRef}>
            <div className="docrow docrow-head" aria-hidden="true">
              <span />
              <span>Document</span>
              <span>Filed by</span>
              <span>Filed on</span>
              <span>Memory</span>
            </div>
            {shown.length === 0 && <p className="muted" style={{ padding: 20 }}>No document matches.</p>}
            {paged.items.map((d) => (
              <DocRow key={d.document.id} caseId={caseId} d={d} />
            ))}
          </section>
          <Pagination paged={paged} noun={['document', 'documents']} />
        </>
      )
        }
      </QueryView>
    </>
  )
}

function DocIcon({ type }: { type: string }) {
  const t = DOC_TYPES[type] ?? DOC_TYPES.other!
  const style =
    t.group === 'order'
      ? { background: 'var(--ink)', color: 'var(--paper)' }
      : t.group === 'evidence'
        ? { background: 'var(--manila)', color: '#2a1711' }
        : { background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }
  return (
    <span aria-hidden="true" className="typed" style={{ width: 36, height: 44, borderRadius: 2, display: 'inline-flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 5, fontSize: 10, fontWeight: 700, ...style }}>
      {t.abbr}
    </span>
  )
}

function DocRow({ caseId, d }: { caseId: string; d: DocumentListItem }) {
  const s = docState(d.document)
  return (
    <Link to={`/app/cases/${caseId}/documents/${d.document.id}`} className="docrow">
      <DocIcon type={d.document.type} />
      <span className="stack" style={{ gap: 3, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{d.document.title}</span>
        <span className="typed muted" style={{ fontSize: 12 }}>
          {DOC_TYPES[d.document.type]?.label ?? d.document.type}
          {d.document.pageCount ? ` · ${plural(d.document.pageCount, 'page')}` : ''}
          {d.hearing ? ` · hearing ${courtDate(d.hearing.date)}` : ''}
        </span>
      </span>
      <span style={{ fontSize: 14 }}>{d.filedBy?.name ?? (d.document.type === 'order' ? 'Court' : '—')}</span>
      <span className="typed" style={{ fontSize: 14 }}>
        {courtDate(d.document.filedOn ?? d.document.date)}
      </span>
      <span className="stack" style={{ gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TONE_COLOR[s.tone] }}>{s.text}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {s.detail}
        </span>
      </span>
    </Link>
  )
}

// ---------------------------------------------------------------------------------------------

export function DocViewerPage() {
  const { caseId = '', documentId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const qc = useQueryClient()
  const toast = useToast()
  const doc = useQuery({
    queryKey: keys.document(caseId, documentId),
    queryFn: () => api.get<DocumentDetail>(`/documents/${documentId}`),
    refetchInterval: (q) => (q.state.data && docState(q.state.data).text === 'Being read' ? 2500 : false),
  })
  const chunks = useQuery({ queryKey: [...keys.document(caseId, documentId), 'chunks'], queryFn: () => api.get<Chunk[]>(`/documents/${documentId}/chunks`) })
  const claims = useQuery({ queryKey: keys.claims(caseId, `source:${documentId}`), queryFn: () => api.get<ClaimView[]>(`/cases/${caseId}/claims?sourceId=${documentId}`) })
  const reread = useMutation({
    mutationFn: () => api.post(`/documents/${documentId}/analyze`),
    onSuccess: () => {
      toast('Reading again')
      void qc.invalidateQueries({ queryKey: keys.document(caseId, documentId) })
    },
    onError: (e) => toast(errorMessage(e)),
  })

  const paraKey = (c: Pick<Chunk, 'page' | 'para' | 'paraLabel'>) => c.paraLabel ?? `${c.page}.${c.para}`
  const claimsByChunk = useMemo(() => {
    const m = new Map<string, ClaimView[]>()
    for (const c of claims.data ?? []) if (c.source.type === 'document') {
      const k = c.source.paraLabel ?? `${c.source.page}.${c.source.para}`
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return m
  }, [claims.data])

  const wanted = params.get('para')
  const list = chunks.data ?? []
  const pages = [...new Set(list.map((c) => c.page))]
  const selected = list.find((c) => paraKey(c) === wanted) ?? list.find((c) => claimsByChunk.has(paraKey(c))) ?? list[0]
  const page = selected?.page ?? 1
  const selRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [wanted, chunks.data])

  const select = (c: Chunk) => {
    const next = new URLSearchParams(params)
    next.set('para', paraKey(c))
    next.delete('from')
    setParams(next, { replace: true })
  }

  if (doc.data === undefined) {
    if (doc.isError) return <ErrorState error={doc.error} retry={() => doc.refetch()} />
    return (
      <div className="stack" style={{ gap: 20 }} aria-busy="true">
        <span className="sr-only" role="status">
          Loading the document…
        </span>
        <div className="stack" style={{ gap: 8 }}>
          <Skeleton height={13} width="36%" />
          <Skeleton height={30} width="52%" />
        </div>
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="stack" style={{ flex: '999 1 520px', gap: 14 }}>
            {[96, 88, 92, 70, 84].map((w, i) => (
              <Skeleton key={i} height={54} width={`${w}%`} />
            ))}
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <Skeleton height={160} />
          </div>
        </div>
      </div>
    )
  }
  const d = doc.data
  const state = docState(d)
  const selClaims = selected ? (claimsByChunk.get(paraKey(selected)) ?? []) : []

  return (
    <>
      {doc.isError && <StaleNotice error={doc.error} retry={() => doc.refetch()} />}
      {claims.isError && (
        <Banner tone="warn" action={<button type="button" className="btn btn-sm" onClick={() => claims.refetch()}>Try again</button>}>
          The statements recorded from this document couldn't be loaded, so paragraphs aren't highlighted.
        </Banner>
      )}
      {params.get('from') === 'ask' && wanted && (
        <Banner tone="info" action={<Link to={`/app/cases/${caseId}/ask${params.get('c') ? `?c=${params.get('c')}` : ''}`} className="btn btn-sm">Back to the answer</Link>}>
          Opened from your answer: paragraph {wanted}{selected ? ` on page ${selected.page}` : ''}.
        </Banner>
      )}
      <div className="row-between" style={{ alignItems: 'center' }}>
        <div className="stack" style={{ gap: 4 }}>
          <span className="typed muted" style={{ fontSize: 13 }}>
            {DOC_TYPES[d.type]?.label ?? d.type} · {courtDate(d.filedOn ?? d.date)}
            {d.filedBy ? ` · filed by ${d.filedBy.name}` : ''}
            {d.hearing ? ` · hearing ${courtDate(d.hearing.date)}` : ''}
          </span>
          <h1 className="page-title" style={{ fontSize: 28 }}>
            {d.title}
          </h1>
        </div>
        <div className="row">
          {d.fileUrl && (
            <a className="btn btn-sm" href={d.fileUrl} target="_blank" rel="noreferrer">
              Open original
            </a>
          )}
          <button type="button" className="btn btn-sm" disabled={reread.isPending || state.text === 'Being read'} onClick={() => reread.mutate()}>
            Read again
          </button>
        </div>
      </div>
      {state.tone !== 'ok' && <Banner tone={state.tone === 'bad' ? 'error' : 'warn'}>{state.text}. {state.detail}</Banner>}

      <QueryView query={chunks} loading={<SkeletonList rows={5} />}>
        {() =>
      list.length === 0 ? (
        <EmptyState title="No text to show">This document has no readable text. Upload a clearer copy or paste the text as a new document.</EmptyState>
      ) : (
        <div className="row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          {pages.length > 1 && (
            <nav aria-label="Pages" className="stack" style={{ flex: '0 0 72px', gap: 6 }}>
              {pages.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn btn-sm"
                  aria-current={p === page ? 'page' : undefined}
                  style={{ height: 64, borderColor: p === page ? 'var(--ink)' : undefined, borderWidth: p === page ? 2 : 1 }}
                  onClick={() => select(list.find((c) => c.page === p)!)}
                >
                  p{p}
                </button>
              ))}
            </nav>
          )}
          <article className="sheet ruled" aria-label={d.title} style={{ flex: '999 1 520px', minWidth: 0, padding: '32px 36px 40px' }}>
            {list.map((c, i) => {
              const isSel = c.id === selected?.id
              const hasClaims = claimsByChunk.has(paraKey(c))
              const newPage = i > 0 && c.page !== list[i - 1]!.page
              return (
                <div key={c.id}>
                  {newPage && <div className="typed muted" style={{ fontSize: 12, textAlign: 'center', margin: '14px 0' }}>— page {c.page} —</div>}
                  {splitPara(c).caption && <div className="doc-caption">{splitPara(c).caption}</div>}
                  <button ref={isSel ? selRef : undefined} type="button" className="para" aria-pressed={isSel} onClick={() => select(c)}>
                    <span className="typed" style={{ fontWeight: 700 }}>
                      {c.paraLabel ? `${c.paraLabel}.` : ''}
                    </span>
                    <span className={hasClaims ? 'para-text has-claims' : 'para-text'}>{splitPara(c).body}</span>
                  </button>
                </div>
              )
            })}
          </article>
          <aside className="stack" aria-label="Selected paragraph" style={{ flex: '1 1 320px', minWidth: 0, gap: 12 }}>
            <div className="card stack" style={{ gap: 8 }}>
              <h2 className="section-title">{selected?.paraLabel ? `Paragraph ${selected.paraLabel}` : `Page ${page}`}</h2>
              <span className="ink-2" style={{ fontSize: 14 }}>
                {selClaims.length ? `${plural(selClaims.length, 'statement')} recorded from here.` : 'No statement recorded from this paragraph.'}
              </span>
              {selClaims.map((c) => (
                <div key={c.claim.id} className="row" style={{ gap: 6 }}>
                  {c.madeBy && <span className="tag tag-violet">by {c.madeBy.name}</span>}
                  {c.subjects.map((s) => (
                    <span key={s.id} className="tag">
                      about {s.name}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            {selClaims[0] && <Related caseId={caseId} claimId={selClaims[0].claim.id} />}
          </aside>
        </div>
      )
        }
      </QueryView>
    </>
  )
}

/**
 * A paragraph chunk can carry the heading printed above it ("IN THE COURT OF ..."), because the
 * chunker folds short unnumbered blocks into the next paragraph. Show that heading as a caption.
 */
function splitPara(c: Chunk): { caption: string; body: string } {
  if (!c.paraLabel) return { caption: '', body: c.text }
  const label = c.paraLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(^|\\n)\\s*(?:para(?:graph)?\\s*)?\\(?${label}[.)]\\s+`, 'i').exec(c.text)
  if (!m) return { caption: '', body: c.text }
  return { caption: c.text.slice(0, m.index).trim(), body: c.text.slice(m.index + m[0].length).trim() }
}

function Related({ caseId, claimId }: { caseId: string; claimId: string }) {
  const related = useQuery({ queryKey: ['case', caseId, 'related', claimId], queryFn: () => api.get<Finding[]>(`/claims/${claimId}/related`) })
  return (
    <QueryView query={related} loading={<SkeletonList rows={2} />}>
      {(found) =>
        found.length ? (
          found.map((f) => <FindingCard key={f.id} f={f} caseId={caseId} compact focusClaimId={claimId} />)
        ) : (
          <p className="empty ink-2" style={{ fontSize: 14 }}>
            Nothing else in the case contradicts or supports this paragraph yet. The fact-check agent looks again when new material is added.
          </p>
        )
      }
    </QueryView>
  )
}

