import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Brief, CaseCard, Dashboard, DocumentListItem, HearingListItem, Person } from '../types/domain'

/** Query keys. Everything under a case starts with ['case', caseId] so one invalidate refreshes it all. */
export const keys = {
  me: ['me'] as const,
  cases: ['cases'] as const,
  dashboard: ['dashboard'] as const,
  case: (id: string) => ['case', id] as const,
  brief: (id: string) => ['case', id, 'brief'] as const,
  people: (id: string) => ['case', id, 'people'] as const,
  hearings: (id: string) => ['case', id, 'hearings'] as const,
  hearing: (id: string, hid: string) => ['case', id, 'hearing', hid] as const,
  transcript: (id: string, hid: string, v?: number) => ['case', id, 'transcript', hid, v ?? 'current'] as const,
  documents: (id: string) => ['case', id, 'documents'] as const,
  document: (id: string, did: string) => ['case', id, 'document', did] as const,
  claims: (id: string, filter: string) => ['case', id, 'claims', filter] as const,
  contradictions: (id: string, all = false) => ['case', id, 'contradictions', all] as const,
  disputes: (id: string) => ['case', id, 'disputes'] as const,
  directions: (id: string) => ['case', id, 'directions'] as const,
  compliance: (id: string) => ['case', id, 'compliance'] as const,
  subjects: (id: string) => ['case', id, 'subjects'] as const,
  conversations: (id: string) => ['case', id, 'conversations'] as const,
  conversation: (id: string, cid: string) => ['case', id, 'conversation', cid] as const,
}

export const useCaseCards = () => useQuery({ queryKey: keys.cases, queryFn: () => api.get<CaseCard[]>('/cases') })
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<Dashboard>('/dashboard') })
export const useBrief = (caseId: string) => useQuery({ queryKey: keys.brief(caseId), queryFn: () => api.get<Brief>(`/cases/${caseId}/brief`) })
export const usePeople = (caseId: string) =>
  useQuery({ queryKey: keys.people(caseId), queryFn: () => api.get<Person[]>(`/cases/${caseId}/people`) })
export const useHearings = (caseId: string) =>
  useQuery({ queryKey: keys.hearings(caseId), queryFn: () => api.get<HearingListItem[]>(`/cases/${caseId}/hearings`) })
export const useDocuments = (caseId: string) =>
  useQuery({ queryKey: keys.documents(caseId), queryFn: () => api.get<DocumentListItem[]>(`/cases/${caseId}/documents`) })

/** "Ramesh Kumar v. Suresh Gupta" -> "Kumar v. Gupta" (how lawyers say it out loud). */
export function shortTitle(title: string) {
  const parts = title.split(/\s+v(?:s)?\.?\s+/i)
  if (parts.length !== 2) return title
  const SUFFIX = /^(pvt|ltd|llp|inc|co|corp|&|ors|and|others|the)\.?$/i
  const last = (s: string) => s.split(/\s+/).filter((w) => /[a-z]/i.test(w) && !SUFFIX.test(w)).pop() ?? s
  return `${last(parts[0]!)} v. ${last(parts[1]!)}`
}

/** Which side a person is on, from their party role. */
export function sideOf(p: Pick<Person, 'kind' | 'role' | 'represents' | 'calledBy'>, people: Person[]): 'first' | 'second' | 'court' | null {
  const FIRST = ['plaintiff', 'petitioner', 'appellant', 'complainant', 'prosecution']
  const roleSide = (role: string | null) => (role ? (FIRST.includes(role) ? 'first' : 'second') : null)
  if (p.kind === 'Judge') return 'court'
  if (p.kind === 'Party') return roleSide(p.role)
  const partyId = p.kind === 'Lawyer' ? p.represents[0]?.id : p.calledBy?.id
  const party = people.find((x) => x.id === partyId)
  return party ? roleSide(party.role) : null
}
