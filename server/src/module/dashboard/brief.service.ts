import { runQuery } from "../../common/db/index.js";
import { todayIST } from "../../common/utils/index.js";
import { getCaseOverview, listPeople } from "../case/index.js";
import { complianceReport } from "../compliance/index.js";
import { listContradictions } from "../factcheck/index.js";
import { listHearings } from "../hearing/index.js";
import { listSubjects } from "../intake/index.js";

const NEW_FOR_DAYS = 7;

export interface ActivityItem {
  agent: "intake" | "fact-check" | "compliance" | "q&a";
  text: string;
  at: string;
  link: { kind: "document" | "drift" | "directions" | "conversation"; id?: string };
}

/** What each agent did lately, newest first. Derived from timestamps the agents leave on the graph. */
async function recentActivity(caseId: string, today: string): Promise<ActivityItem[]> {
  const [read, found, lapsed, asked] = await Promise.all([
    runQuery<{ id: string; title: string; claims: number | null; at: string }>(
      `MATCH (d:Document {caseId: $caseId}) WHERE d.analyzedAt IS NOT NULL
       RETURN d.id AS id, d.title AS title, d.claimCount AS claims, d.analyzedAt AS at ORDER BY d.analyzedAt DESC LIMIT 3`,
      { caseId },
    ),
    runQuery<{ who: string | null; at: string; n: number }>(
      `MATCH (a:Claim {caseId: $caseId})-[r:CONTRADICTS]->(:Claim) WHERE coalesce(r.dismissed, false) = false
       OPTIONAL MATCH (a)-[:MADE_BY]->(p:Person)
       RETURN p.name AS who, left(r.createdAt, 10) AS at, count(r) AS n ORDER BY at DESC LIMIT 3`,
      { caseId },
    ),
    runQuery<{ text: string; due: string }>(
      `MATCH (d:Direction {caseId: $caseId}) WHERE d.dueDate IS NOT NULL AND toString(d.dueDate) < $today AND d.manualStatus IS NULL
       OPTIONAL MATCH (d)-[c:COMPLIED_BY|VACATED_BY]->()
       WITH d, count(c) AS done WHERE done = 0
       RETURN d.text AS text, d.dueDate AS due ORDER BY d.dueDate DESC LIMIT 2`,
      { caseId, today },
    ),
    runQuery<{ id: string; title: string; at: string }>(
      `MATCH (:Case {id: $caseId})-[:HAS_CONVERSATION]->(c:Conversation)
       RETURN c.id AS id, c.title AS title, c.updatedAt AS at ORDER BY c.updatedAt DESC LIMIT 2`,
      { caseId },
    ),
  ]);
  const items: ActivityItem[] = [
    ...read.map((d) => ({
      agent: "intake" as const,
      text: `Read ${d.title}${d.claims ? `: ${d.claims} statements recorded` : ""}.`,
      at: d.at,
      link: { kind: "document" as const, id: d.id },
    })),
    ...found.map((f) => ({
      agent: "fact-check" as const,
      text: `Found ${f.n} contradiction${f.n === 1 ? "" : "s"}${f.who ? ` by ${f.who}` : " against the record"}.`,
      at: f.at,
      link: { kind: "drift" as const },
    })),
    ...lapsed.map((l) => ({
      agent: "compliance" as const,
      text: `Deadline passed with nothing filed: ${l.text}`,
      at: l.due,
      link: { kind: "directions" as const },
    })),
    ...asked.map((c) => ({
      agent: "q&a" as const,
      text: `Saved your conversation “${c.title}”.`,
      at: c.at,
      link: { kind: "conversation" as const, id: c.id },
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

/** Hearings where a statement later found contradictory was made. */
async function hearingsWithContradictions(caseId: string) {
  const rows = await runQuery<{ hearingId: string }>(
    `MATCH (a:Claim {caseId: $caseId})-[r:CONTRADICTS]-(b:Claim) WHERE coalesce(r.dismissed, false) = false AND a.hearingId IS NOT NULL
     RETURN DISTINCT a.hearingId AS hearingId`,
    { caseId },
  );
  return new Set(rows.map((r) => r.hearingId));
}

/** Everything the case home needs in one call. */
export async function caseBrief(caseId: string) {
  const since = new Date(Date.now() - NEW_FOR_DAYS * 86_400_000).toISOString();
  const [overview, report, contradictions, hearings, flagged, subjects, people] = await Promise.all([
    getCaseOverview(caseId),
    complianceReport(caseId),
    listContradictions(caseId),
    listHearings(caseId),
    hearingsWithContradictions(caseId),
    listSubjects(caseId),
    listPeople(caseId),
  ]);
  const today = todayIST();

  return {
    case: overview,
    today,
    nextHearing: report.nextHearing,
    overdue: report.overdue,
    dueBeforeNextHearing: report.dueBeforeNextHearing,
    forCross: contradictions.filter((c) => c.crossPrep || (c.createdAt ?? "") >= since),
    contradictionCount: contradictions.length,
    timeline: hearings.map((h) => {
      const hearing = h.hearing as { id: string; date: string; purpose: string | null; adjourned: boolean };
      return {
        id: hearing.id,
        date: hearing.date,
        purpose: hearing.purpose,
        adjourned: hearing.adjourned,
        upcoming: hearing.date >= today,
        hasOrder: Number(h.orders) > 0,
        hasTranscript: Boolean(h.hasTranscript),
        contradiction: flagged.has(hearing.id),
      };
    }),
    activity: await recentActivity(caseId, today),
    subjects: subjects.slice(0, 4),
    people,
  };
}
