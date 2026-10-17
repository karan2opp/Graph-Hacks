import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { keys } from '../lib/queries'
import type { ClaimView, Finding } from '../types/domain'
import { Stamp, useToast, type StampTone } from './ui'
import { courtDate, errorMessage } from '../lib/format'

/** Where a statement can be read in full: a document paragraph or a transcript turn. */
function sourceHref(caseId: string, c: ClaimView) {
  return c.source.type === 'document'
    ? `/app/cases/${caseId}/documents/${c.source.documentId}?para=${c.source.paraLabel ?? c.source.para}&page=${c.source.page}`
    : `/app/cases/${caseId}/hearings/${c.source.hearingId}?turn=${c.source.turn}`
}

function sourceLabel(c: ClaimView) {
  return c.source.type === 'document'
    ? `${c.source.title}, p${c.source.page} para ${c.source.paraLabel ?? c.source.para}`
    : `Hearing ${courtDate(c.source.hearingDate)}, turn ${c.source.turn}`
}

export function Ref({ caseId, claim }: { caseId: string; claim: ClaimView }) {
  return (
    <Link to={sourceHref(caseId, claim)} className="ref">
      [{sourceLabel(claim)}]
    </Link>
  )
}

const FINDING_LABEL: Record<string, { label: string; tone: StampTone }> = {
  'CONTRADICTS:self': { label: 'Same person', tone: 'red' },
  'CONTRADICTS:same_side': { label: 'Same side', tone: 'red' },
  'CONTRADICTS:record': { label: 'Against the record', tone: 'red' },
  'CONTRADICTS:unclassified': { label: 'Contradiction', tone: 'red' },
  DISPUTES: { label: 'Disputed by the other side', tone: 'violet' },
  SUPPORTS: { label: 'Supported by', tone: 'blue' },
}
const findingLabel = (f: Pick<Finding, 'type' | 'category'>) =>
  FINDING_LABEL[f.type === 'CONTRADICTS' ? `CONTRADICTS:${f.category}` : f.type] ?? FINDING_LABEL['CONTRADICTS:unclassified']!

function Statement({ caseId, c, when }: { caseId: string; c: ClaimView; when: string }) {
  return (
    <div className="stack" style={{ gap: 8, padding: '16px 20px', minWidth: 0 }}>
      <span className="typed muted" style={{ fontSize: 12 }}>
        {when}
      </span>
      <span className="quote" style={{ fontSize: 16, lineHeight: 1.55 }}>
        “{c.claim.quote}”
      </span>
      <span className="row-between" style={{ alignItems: 'center', fontSize: 13 }}>
        <span className="ink-2">{c.madeBy?.name ?? 'Document of record'}</span>
        <Ref caseId={caseId} claim={c} />
      </span>
    </div>
  )
}

/** Both statements side by side, why they clash, and the lawyer's actions. */
export function FindingCard({ f, caseId, compact = false, focusClaimId }: { f: Finding; caseId: string; compact?: boolean; focusClaimId?: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const update = useMutation({
    mutationFn: (patch: { dismissed?: boolean; crossPrep?: boolean }) => api.patch<Finding>(`/links/${f.id}`, patch),
    onSuccess: (_, patch) => {
      toast(patch.dismissed ? 'Marked as not a contradiction' : patch.crossPrep ? 'Added to cross prep' : 'Updated')
      void qc.invalidateQueries({ queryKey: keys.case(caseId) })
      void qc.invalidateQueries({ queryKey: keys.cases })
      void qc.invalidateQueries({ queryKey: keys.dashboard })
    },
  })
  const { label, tone } = findingLabel(f)

  if (compact) {
    const other = f.later.claim.id === focusClaimId ? f.earlier : f.later
    return (
      <Link to={sourceHref(caseId, other)} className="card stack" style={{ gap: 8, textDecoration: 'none' }}>
        <span>
          <Stamp tone={tone}>{f.type === 'SUPPORTS' ? label : f.type === 'DISPUTES' ? 'Disputed' : `Contradicts · ${label}`}</Stamp>
        </span>
        <span className="quote" style={{ fontSize: 15, lineHeight: 1.5 }}>
          “{other.claim.quote}”
        </span>
        <span className="row-between" style={{ fontSize: 13 }}>
          <span className="ink-2">{other.madeBy?.name ?? 'Document of record'}</span>
          <span className="ref">{sourceLabel(other)}</span>
        </span>
      </Link>
    )
  }

  return (
    <article className="card-flush ruled" style={{ backgroundColor: 'var(--paper)', opacity: f.dismissed ? 0.6 : 1 }} aria-label={`${label}: ${f.subjects.join(', ')}`}>
      <div className="row-between" style={{ alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--rule-2)' }}>
        <span className="row" style={{ gap: 10 }}>
          <Stamp tone={tone}>{label}</Stamp>
          <b style={{ fontWeight: 600 }}>{f.subjects[0] ?? 'Statement'}</b>
          {f.crossPrep && <span className="tag tag-blue">In cross prep</span>}
          {f.dismissed && <span className="tag">Dismissed</span>}
        </span>
        {f.type !== 'SUPPORTS' && (
          <span className="row" style={{ gap: 8 }}>
            {f.dismissed ? (
              <button type="button" className="btn btn-sm" disabled={update.isPending} onClick={() => update.mutate({ dismissed: false })}>
                Restore
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-sm" disabled={update.isPending} onClick={() => update.mutate({ dismissed: true })}>
                  Not a contradiction
                </button>
                <button type="button" className={`btn btn-sm ${f.crossPrep ? '' : 'btn-primary'}`} disabled={update.isPending} onClick={() => update.mutate({ crossPrep: !f.crossPrep })}>
                  {f.crossPrep ? 'Remove from cross prep' : 'Add to cross prep'}
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <div className="grid-auto" style={{ gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <Statement caseId={caseId} c={f.earlier} when={courtDate(f.earlier.claim.statedOn)} />
        <div style={{ borderLeft: '1px solid var(--rule-2)' }}>
          <Statement caseId={caseId} c={f.later} when={courtDate(f.later.claim.statedOn)} />
        </div>
      </div>
      <div style={{ padding: '12px 20px', background: 'var(--paper-2)', fontSize: 14 }} className="ink-2">
        {f.type === 'CONTRADICTS' && <b style={{ color: 'var(--ink)' }}>Can both be true? No. </b>}
        {f.reason}
        {update.error && <span className="red"> · {errorMessage(update.error)}</span>}
      </div>
    </article>
  )
}
