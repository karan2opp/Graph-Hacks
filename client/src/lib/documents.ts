import { plural } from './format'
import type { DocumentNode } from '../types/domain'

export const DOC_TYPES: Record<string, { label: string; abbr: string; group: 'pleading' | 'affidavit' | 'order' | 'evidence' | 'other' }> = {
  plaint: { label: 'Plaint', abbr: 'PL', group: 'pleading' },
  written_statement: { label: 'Written statement', abbr: 'WS', group: 'pleading' },
  replication: { label: 'Replication', abbr: 'REP', group: 'pleading' },
  application: { label: 'Application', abbr: 'APP', group: 'pleading' },
  reply: { label: 'Reply', abbr: 'RPL', group: 'pleading' },
  affidavit: { label: 'Affidavit', abbr: 'AFF', group: 'affidavit' },
  deposition: { label: 'Deposition', abbr: 'DEP', group: 'affidavit' },
  order: { label: 'Order', abbr: 'ORD', group: 'order' },
  judgment: { label: 'Judgment', abbr: 'JDG', group: 'order' },
  fir: { label: 'FIR', abbr: 'FIR', group: 'evidence' },
  chargesheet: { label: 'Chargesheet', abbr: 'CS', group: 'evidence' },
  police_statement: { label: 'Police statement', abbr: 'PS', group: 'evidence' },
  evidence: { label: 'Evidence exhibit', abbr: 'EX', group: 'evidence' },
  sale_deed: { label: 'Sale deed', abbr: 'SD', group: 'evidence' },
  agreement: { label: 'Agreement', abbr: 'AGR', group: 'evidence' },
  notice: { label: 'Notice', abbr: 'NTC', group: 'evidence' },
  note: { label: 'Private note', abbr: 'NOTE', group: 'other' },
  other: { label: 'Other', abbr: 'DOC', group: 'other' },
}

/** One line on where a document is in the pipeline, for the library and the viewer. */
export function docState(d: DocumentNode): { text: string; tone: 'ok' | 'wait' | 'bad'; detail: string } {
  if (d.status === 'failed') return { text: 'Could not be read', tone: 'bad', detail: d.error ?? 'Try uploading it again.' }
  if (d.status === 'stored') return { text: 'No readable text', tone: 'bad', detail: d.note ?? 'Stored safely. Upload a clearer copy or paste the text.' }
  if (d.analysis === 'failed') return { text: 'Reading failed', tone: 'bad', detail: d.analysisError ?? 'Use "Read again".' }
  if (d.analysisError === 'Waiting for OPENAI_API_KEY' || (d.analysis === 'pending' && d.note?.includes('OPENAI'))) return { text: 'Waiting for analysis', tone: 'wait', detail: 'Resumes when the AI agents are configured.' }
  if (d.analysis === 'pending' || d.analysis === 'running' || d.status === 'extracted' || d.status === 'embedding') return { text: 'Being read', tone: 'wait', detail: 'The agents are reading it now.' }
  return { text: 'Read', tone: 'ok', detail: d.claimCount ? plural(d.claimCount, 'statement') + ' recorded' : d.type === 'order' ? 'Directions recorded' : 'In memory' }
}
