import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Banner, ErrorState, SkeletonList } from '../components/ui'
import { courtDate, errorMessage } from '../lib/format'
import { api, ApiError } from '../lib/api'
import { keys } from '../lib/queries'
import type { AskResult, Citation, Conversation, ConversationListItem, GraphEdge, GraphNode, Health, Message } from '../types/domain'

const SUGGESTIONS = ['Has anyone contradicted themselves?', 'What is due before the next hearing?', 'Who has not complied with the court’s directions?', 'Summarise the last hearing']

function citationHref(caseId: string, c: Citation, conversationId?: string) {
  const back = `&from=ask${conversationId ? `&c=${conversationId}` : ''}`
  if (c.documentId) return `/app/cases/${caseId}/documents/${c.documentId}?${c.para ? `para=${encodeURIComponent(c.para)}` : `page=${c.page ?? 1}`}${back}`
  if (c.hearingId) return `/app/cases/${caseId}/hearings/${c.hearingId}${c.turn ? `?turn=${c.turn}` : ''}`
  if (c.kind === 'direction') return `/app/cases/${caseId}/directions`
  return `/app/cases/${caseId}`
}

/** Renders the agent's answer: paragraphs, "- " bullets, **bold**, and [S1, S2] refs as citation buttons. */
function AnswerText({ text, onCite, active }: { text: string; onCite: (ref: string) => void; active?: string }) {
  const inline = (line: string) =>
    line.split(/(\[S\d+(?:,\s*S\d+)*\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      const refs = /^\[(S\d+(?:,\s*S\d+)*)\]$/.exec(part)
      if (refs)
        return (
          <Fragment key={i}>
            {refs[1]!.split(/,\s*/).map((r) => (
              <button key={r} type="button" className="cite" aria-pressed={active === r} onClick={() => onCite(r)} aria-label={`Source ${r}`}>
                {r}
              </button>
            ))}
          </Fragment>
        )
      if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={i}>{part.slice(2, -2)}</b>
      return <Fragment key={i}>{part}</Fragment>
    })
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length)
      blocks.push(
        <ul key={blocks.length} style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>,
      )
    bullets = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (/^[-*•]\s+/.test(line)) bullets.push(line.replace(/^[-*•]\s+/, ''))
    else {
      flush()
      if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    }
  }
  flush()
  return <div className="stack" style={{ gap: 10, fontSize: 16, lineHeight: 1.6 }}>{blocks}</div>
}

const ROWS = ['Person', 'Claim', 'Direction', 'Subject', 'Document', 'Hearing']
/** The evidence behind an answer, laid out in rows by kind: who → what they said → where. */
function EvidenceGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  if (!nodes.length) return <p className="muted" style={{ padding: 16 }}>No graph for this answer.</p>
  const kind = (n: GraphNode) => (['Party', 'Lawyer', 'Judge', 'Witness'].includes(n.label) ? 'Person' : n.label)
  const rows = ROWS.map((r) => nodes.filter((n) => kind(n) === r)).filter((r) => r.length)
  const W = 360
  const rowH = 92
  const pos = new Map<string, { x: number; y: number }>()
  rows.forEach((row, ri) => row.forEach((n, i) => pos.set(n.id, { x: ((i + 0.5) * W) / row.length, y: 36 + ri * rowH })))
  const H = 36 + (rows.length - 1) * rowH + 40
  const fill = (n: GraphNode) => (kind(n) === 'Person' ? 'var(--violet)' : kind(n) === 'Claim' ? '#fff' : kind(n) === 'Subject' ? 'var(--chip)' : kind(n) === 'Direction' ? 'var(--manila-bg)' : 'var(--ink)')
  const ink = (n: GraphNode) => (kind(n) === 'Person' || kind(n) === 'Document' || kind(n) === 'Hearing' ? '#fff' : 'var(--ink)')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Evidence graph: ${nodes.length} records and how they connect`} style={{ background: 'var(--paper-2)', borderRadius: 3 }}>
      {edges.map((e, i) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        const red = e.type === 'CONTRADICTS'
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={red ? 'var(--red)' : e.type === 'DISPUTES' ? 'var(--violet)' : '#9aa1ab'} strokeWidth={red ? 2.5 : 1.3} strokeDasharray={e.type === 'ABOUT' ? '3 3' : undefined} />
            {red && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--red)" fontFamily="var(--typed)">
                CONTRADICTS
              </text>
            )}
          </g>
        )
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!
        const label = (n.ref ? `${n.ref} · ` : '') + (n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name)
        const w = Math.min(W / Math.max(1, rows.find((r) => r.includes(n))!.length) - 6, label.length * 6 + 16)
        return (
          <g key={n.id}>
            <rect x={p.x - w / 2} y={p.y - 13} width={w} height={26} rx={kind(n) === 'Person' ? 13 : 4} fill={fill(n)} stroke={kind(n) === 'Claim' ? 'var(--blue)' : 'none'} strokeWidth={1.4} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10.5" fill={ink(n)} fontFamily="var(--sans)" fontWeight={n.ref ? 600 : 400}>
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Without the stored graph (older answers), sketch one from the citations: each source under its document or hearing. */
function graphFromCitations(cites: Citation[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  for (const c of cites) {
    nodes.set(c.nodeId, { id: c.nodeId, label: c.kind === 'claim' || c.kind === 'chunk' || c.kind === 'segment' ? 'Claim' : c.kind === 'direction' ? 'Direction' : c.kind === 'document' ? 'Document' : 'Hearing', name: c.label, ref: c.ref })
    const home = c.documentId ?? c.hearingId
    if (home && home !== c.nodeId) {
      if (!nodes.has(home)) nodes.set(home, { id: home, label: c.documentId ? 'Document' : 'Hearing', name: c.label.split(',')[0]! })
      edges.push({ from: c.nodeId, to: home, type: 'IN' })
    }
  }
  return { nodes: [...nodes.values()], edges }
}

type PanelTab = 'sources' | 'graph' | 'trace'

export function AskPage() {
  const { caseId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const conversationId = params.get('c') ?? undefined
  const qc = useQueryClient()
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('sources')
  const [activeRef, setActiveRef] = useState<string>()
  const [last, setLast] = useState<AskResult | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => ((await (await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/v1/health`)).json()) as { data: Health }).data,
    // Re-check often so the page notices as soon as the AI key is set and the API restarted.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })
  const aiOff = health.data?.services.openai === 'not_configured'
  const conversations = useQuery({ queryKey: keys.conversations(caseId), queryFn: () => api.get<ConversationListItem[]>(`/cases/${caseId}/conversations`) })
  const conversation = useQuery({
    queryKey: keys.conversation(caseId, conversationId ?? ''),
    queryFn: () => api.get<Conversation>(`/conversations/${conversationId}`),
    enabled: !!conversationId,
  })

  const ask = useMutation({
    mutationFn: (q: string) => api.post<AskResult>(`/cases/${caseId}/ask`, { question: q, conversationId }),
    onMutate: (q) => setPending(q),
    onSuccess: (r) => {
      setLast(r)
      setTab('sources')
      setActiveRef(r.citations[0]?.ref)
      setQuestion('')
      void qc.invalidateQueries({ queryKey: keys.conversations(caseId) })
      void qc.invalidateQueries({ queryKey: keys.conversation(caseId, r.conversationId) })
      if (r.conversationId !== conversationId) setParams({ c: r.conversationId }, { replace: true })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.statusCode === 503) void health.refetch()
    },
    onSettled: () => setPending(null),
  })
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [conversation.data, pending])

  const messages: Message[] = conversation.data?.messages ?? []
  const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant')
  const citations = (last && last.conversationId === conversationId ? last.citations : lastAnswer?.citations) ?? []
  const trace = (last && last.conversationId === conversationId ? last.trace : lastAnswer?.trace) ?? []
  const graph = last && last.conversationId === conversationId ? last.graph : graphFromCitations(citations)
  const send = (q: string) => {
    const t = q.trim()
    if (t.length < 2 || ask.isPending) return
    setQuestion(t)
    ask.mutate(t)
  }
  const askError = ask.error instanceof ApiError && ask.error.statusCode === 503 ? 'The Q&A agent needs the AI service. Ask your firm owner to set OPENAI_API_KEY.' : ask.error ? errorMessage(ask.error) : null

  return (
    <>
      <div className="row-between" style={{ alignItems: 'center' }}>
        <h1 className="page-title">Ask the case</h1>
        <div className="row">
          <label className="row" style={{ gap: 8, fontSize: 14 }}>
            Conversation
            <select className="select" style={{ width: 'auto', minWidth: 220 }} value={conversationId ?? ''} onChange={(e) => (e.target.value ? setParams({ c: e.target.value }) : setParams({}))}>
              <option value="">New conversation</option>
              {conversations.data?.map((c) => (
                <option key={c.conversation.id} value={c.conversation.id}>
                  {c.conversation.title} · {courtDate(c.conversation.updatedAt)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {aiOff && <Banner tone="warn">Answers need the AI agents, which are not configured yet: set OPENAI_API_KEY in server/.env and restart the API. You can still type a question; past conversations and the rest of the case work as normal.</Banner>}

      <div className="split">
        <section aria-label="Conversation" className="grow stack" style={{ gap: 16 }}>
          {conversationId && conversation.isPending && <SkeletonList rows={3} />}
          {conversation.isError && <ErrorState error={conversation.error} retry={() => conversation.refetch()} />}
          {!conversationId && !pending && (
            <div className="card stack" style={{ gap: 10 }}>
              <h2 className="section-title">Ask in plain words</h2>
              <p className="ink-2">Every answer is built only from this case's record, and every sentence carries a source you can open. Follow-up questions remember the conversation.</p>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="bubble-q">
                {m.text}
              </div>
            ) : (
              <article key={m.id} className="sheet ruled" style={{ padding: 22 }}>
                <AnswerText
                  text={m.text}
                  active={activeRef}
                  onCite={(r) => {
                    setActiveRef(r)
                    setTab('sources')
                  }}
                />
                {m.citations.length > 0 && (
                  <p className="green" style={{ fontSize: 13, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule-2)' }}>
                    ✓ {m.citations.length} of {m.citations.length} sources resolve to real records
                  </p>
                )}
              </article>
            ),
          )}
          {pending && (
            <>
              <div className="bubble-q">{pending}</div>
              <div className="card row" aria-live="polite">
                <span className="spinner" aria-hidden="true" /> Searching the case memory…
              </div>
            </>
          )}
          {askError && <Banner tone="error">{askError}</Banner>}
          <div ref={endRef} />

          <div className="stack" style={{ gap: 10 }}>
            {!messages.length && (
              <div className="pills" aria-label="Suggested questions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="pill" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              className="ask-form"
              onSubmit={(e) => {
                e.preventDefault()
                send(question)
              }}
            >
              <label htmlFor="q" className="sr-only">
                Ask a question
              </label>
              <textarea
                id="q"
                rows={2}
                maxLength={2000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(question)
                  }
                }}
                placeholder="Ask about people, dates, what was said, what is due…"
              />
              <button type="submit" className="btn btn-primary" disabled={ask.isPending || question.trim().length < 2} aria-label="Send">
                Ask
              </button>
            </form>
          </div>
        </section>

        <aside className="side card-flush" aria-label="Evidence" style={{ alignSelf: 'flex-start' }}>
          <div role="tablist" className="row" style={{ gap: 0, borderBottom: '1px solid var(--rule-2)', flexWrap: 'nowrap' }}>
            {(
              [
                ['sources', 'Sources'],
                ['graph', 'Evidence graph'],
                ['trace', 'How I found this'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className="panel-tab" onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ padding: 16 }} className="stack">
            {!citations.length && tab !== 'trace' && <p className="muted">Sources for the latest answer appear here.</p>}
            {tab === 'sources' &&
              citations.map((c) => (
                <div key={c.ref} className="stack" style={{ gap: 6, padding: 14, borderRadius: 3, border: `1px solid ${activeRef === c.ref ? 'var(--blue)' : 'var(--rule-2)'}`, background: activeRef === c.ref ? 'var(--blue-bg)' : 'var(--paper)' }}>
                  <span className="row-between" style={{ alignItems: 'center' }}>
                    <b className="typed blue" style={{ fontSize: 13 }}>
                      {c.ref}
                    </b>
                    <span className="typed muted" style={{ fontSize: 12 }}>
                      {c.label}
                    </span>
                  </span>
                  {c.quote && <span className="quote" style={{ fontSize: 15, lineHeight: 1.5 }}>“{c.quote}”</span>}
                  <span className="row-between" style={{ fontSize: 13 }}>
                    <span className="ink-2">
                      {c.speaker ?? ''}
                      {c.date ? ` · ${courtDate(c.date)}` : ''}
                    </span>
                    <Link to={citationHref(caseId, c, conversationId)} className="blue" style={{ fontWeight: 600 }}>
                      Open in {c.documentId ? 'document' : c.hearingId ? 'transcript' : 'case'}
                    </Link>
                  </span>
                </div>
              ))}
            {tab === 'graph' && citations.length > 0 && <EvidenceGraph nodes={graph.nodes} edges={graph.edges} />}
            {tab === 'trace' &&
              (trace.length ? (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
                  {trace.map((t, i) => (
                    <li key={i} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12, padding: 12, background: 'var(--paper-2)', borderRadius: 3 }}>
                      <span className="typed" style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', background: 'var(--ink)', color: '#fff', fontSize: 11, display: 'grid', placeItems: 'center' }}>
                        {i + 1}
                      </span>
                      <span className="stack" style={{ gap: 4, minWidth: 0 }}>
                        <b style={{ fontWeight: 600, fontSize: 14 }}>{t.tool.replace(/_/g, ' ')}</b>
                        <span className="typed" style={{ fontSize: 11, color: 'var(--ink-2)', wordBreak: 'break-word' }}>
                          {t.pattern}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {t.found} found
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">The graph queries the agent ran appear here.</p>
              ))}
          </div>
        </aside>
      </div>
    </>
  )
}
