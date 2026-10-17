/** Shapes returned by the API (see server/src/module/*). */
export type Role = 'owner' | 'member'

export interface User {
  id: string
  email: string
  name: string
  firmId: string
  firmName: string
  role: Role
}

export interface Health {
  status: 'ok' | 'degraded'
  uptime: number
  services: { falkordb: 'up' | 'down'; imagekit: string; openai: string }
}

export interface CaseNode {
  id: string
  caseNumber: string
  title: string
  court: string
  caseType: 'civil' | 'criminal'
  stage: string
  status: 'open' | 'disposed'
  filedOn: string | null
  description: string | null
  createdAt: string
}

export interface CaseCard {
  case: CaseNode
  hearings: number
  documents: number
  nextHearing: { id: string; date: string; purpose: string | null } | null
  overdue: number
  newContradictions: number
  linked: { id: string; caseNumber: string; reason: string | null }[]
}

export interface Dashboard {
  today: string
  overdue: { caseId: string; caseTitle: string; text: string; dueDate: string; assignees: string[] }[]
  nextHearing: { caseId: string; caseTitle: string; date: string; purpose: string | null } | null
  newContradictions: { caseId: string; caseTitle: string; count: number }[]
}

export type PersonKind = 'Party' | 'Lawyer' | 'Judge' | 'Witness'
export interface Person {
  id: string
  name: string
  kind: PersonKind
  role: string | null
  code: string | null
  witnessType: string | null
  enrolmentNo: string | null
  represents: { id: string; name: string }[]
  calledBy: { id: string; name: string } | null
}

export interface ClaimSourceDoc {
  type: 'document'
  documentId: string
  title: string
  docType: string
  page: number
  para: number
  paraLabel: string | null
}
export interface ClaimSourceTurn {
  type: 'transcript'
  hearingId: string
  hearingDate: string
  turn: number
  speakerLabel: string
}
export interface ClaimView {
  claim: { id: string; text: string; quote: string; quoteVerified: boolean; kind: string; statedOn: string; superseded: boolean }
  madeBy: { id: string; name: string; kind: PersonKind } | null
  onBehalfOf: { id: string; name: string } | null
  subjects: { id: string; name: string; type: string }[]
  source: ClaimSourceDoc | ClaimSourceTurn
}

export type LinkType = 'CONTRADICTS' | 'DISPUTES' | 'SUPPORTS'
export interface Finding {
  id: string
  type: LinkType
  category: 'self' | 'same_side' | 'record' | 'opposite' | 'unclassified'
  severity: 'high' | 'medium' | 'low'
  reason: string
  subjects: string[]
  dismissed: boolean
  crossPrep: boolean
  note: string | null
  createdAt: string
  earlier: ClaimView
  later: ClaimView
}

export type DirectionState = 'pending' | 'overdue' | 'complied' | 'in_force' | 'vacated'
export interface DirectionView {
  direction: { id: string; text: string; kind: string; dueDate: string | null; dueText: string | null; orderDate: string | null }
  state: DirectionState
  assignedTo: { id: string; name: string }[]
  order: { documentId: string; title: string; page: number | null; paraLabel: string | null; hearingDate: string | null }
  compliedBy: { documentId: string; title: string; date: string | null; evidence: string | null; onTime: boolean | null; daysLate: number | null } | null
  vacatedBy: { documentId: string; title: string; date: string | null; reason: string | null } | null
  noncomplianceRecorded: { documentId: string; title: string; date: string | null; quote: string | null }[]
  manual: { status: string; note: string | null; at: string } | null
}

export interface ComplianceReport {
  nextHearing: { id: string; date: string; purpose: string | null } | null
  overdue: DirectionView[]
  dueBeforeNextHearing: DirectionView[]
  pending: DirectionView[]
  complied: DirectionView[]
  inForce: DirectionView[]
  vacated: DirectionView[]
  byParty: {
    party: { id: string; name: string; role: string }
    directions: number
    compliedOnTime: number
    compliedLate: number
    overdue: number
    pending: number
    adjournmentsSought: number
  }[]
}

export interface Brief {
  case: CaseNode & {
    linkedCases: { case: Pick<CaseNode, 'id' | 'caseNumber' | 'title'>; reason: string | null }[]
    stats: { hearings: number; documents: number; people: number; nextHearing: string | null }
  }
  today: string
  nextHearing: { id: string; date: string; purpose: string | null } | null
  overdue: DirectionView[]
  dueBeforeNextHearing: DirectionView[]
  forCross: Finding[]
  contradictionCount: number
  timeline: { id: string; date: string; purpose: string | null; adjourned: boolean; upcoming: boolean; hasOrder: boolean; hasTranscript: boolean; contradiction: boolean }[]
  activity: { agent: 'intake' | 'fact-check' | 'compliance' | 'q&a'; text: string; at: string; link: { kind: string; id?: string } }[]
  subjects: { subject: { id: string; name: string; type: string }; claims: number; mentionedBy: string[] }[]
  people: Person[]
}

export interface HearingNode {
  id: string
  caseId: string
  date: string
  purpose: string | null
  status: 'scheduled' | 'held'
  courtRoom: string | null
  adjourned: boolean
  adjournmentReason: string | null
  outcome: string | null
}

export interface HearingListItem {
  hearing: HearingNode
  judge: string | null
  documents: number
  orders: number
  hasTranscript: boolean
}

export interface HearingDetail {
  hearing: HearingNode
  case: { id: string; caseNumber: string; title: string }
  judge: { id: string; name: string } | null
  adjournedAtRequestOf: { id: string; name: string } | null
  previous: { id: string; date: string } | null
  next: { id: string; date: string } | null
  appearances: { id: string; name: string; kind: PersonKind; present: boolean }[]
  documents: DocumentNode[]
  transcript: { id: string; version: number; status: string; segmentCount: number; createdAt: string } | null
}

export interface Segment {
  id: string
  seq: number
  speakerLabel: string
  time: string | null
  text: string
  speaker: { id: string; name: string; kind: PersonKind } | null
}

export interface TranscriptView {
  id: string
  version: number
  status: string
  analysis: string
  analysisError: string | null
  segmentCount: number
  speakers: { label: string; personId: string | null; name: string | null }[]
  unmatchedSpeakers: string[]
  segments: Segment[]
}

export type DocStatus = 'extracted' | 'embedding' | 'ready' | 'stored' | 'failed'
export type Analysis = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export interface DocumentNode {
  id: string
  caseId?: string
  title: string
  type: string
  date: string | null
  filedOn: string | null
  orderKind: string | null
  private?: boolean
  status: DocStatus
  analysis?: Analysis
  analysisError?: string | null
  note?: string | null
  error?: string | null
  pageCount?: number
  chunkCount?: number
  claimCount?: number
  fileUrl: string | null
  mimeType?: string
  createdAt: string
}

export interface DocumentListItem {
  document: DocumentNode
  hearing: { id: string; date: string } | null
  filedBy: { id: string; name: string } | null
}

export interface DocumentDetail extends DocumentNode {
  hearing: { id: string; date: string } | null
  filedBy: { id: string; name: string } | null
  chunks: number
  embedded: number
}

export interface Chunk {
  id: string
  seq: number
  page: number
  para: number
  paraLabel: string | null
  text: string
}

export interface Subject {
  subject: { id: string; name: string; type: string }
  claims: number
  mentionedBy: string[]
}

export interface Citation {
  ref: string
  kind: "claim" | "chunk" | "segment" | "direction" | "document" | "hearing"
  nodeId: string
  label: string
  quote: string | null
  date: string | null
  documentId: string | null
  hearingId: string | null
  page: number | null
  para: string | null
  turn: number | null
  speaker: string | null
}

export interface TraceStep {
  tool: string
  args: Record<string, unknown>
  pattern: string
  found: number
}

export interface GraphNode {
  id: string
  label: string
  name: string
  ref?: string
}
export interface GraphEdge {
  from: string
  to: string
  type: string
  label?: string
}

export interface AskResult {
  conversationId: string
  messageId: string
  answer: string
  citations: Citation[]
  trace: TraceStep[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
}

export interface Message {
  id: string
  seq: number
  role: "user" | "assistant"
  text: string
  citations: Citation[]
  trace: TraceStep[]
  createdAt: string
}

export interface Conversation {
  id: string
  caseId: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export interface ConversationListItem {
  conversation: { id: string; title: string; createdAt: string; updatedAt: string }
  messages: number
}
