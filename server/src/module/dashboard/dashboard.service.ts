import { queryOne, runQuery } from "../../common/db/index.js";
import { todayIST } from "../../common/utils/index.js";
import type { CaseNode } from "../case/index.js";
import { listDirections } from "../compliance/index.js";

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
/** A contradiction counts as "new" for a week, until a lawyer dismisses it. */
const NEW_FOR_DAYS = 7;

type OverdueRow = { direction: { text: string; dueDate: string }; assignedTo: { name: string }[] };
/** Overdue comes from the compliance service, so the rule lives in one place. */
const overdueOf = async (caseId: string) => (await listDirections(caseId, "overdue")) as unknown as OverdueRow[];

/** Case cards for the home screen: what's next and what needs attention in each case. */
export async function listCaseCards(firmId: string) {
  const rows = await runQuery<{
    case: CaseNode;
    hearings: number;
    documents: number;
    nextHearing: { id: string; date: string; purpose: string | null } | null;
    newContradictions: number;
    linked: { id: string; caseNumber: string; reason: string | null }[];
  }>(
    `MATCH (c:Case {firmId: $firmId})
     OPTIONAL MATCH (c)-[:HAS_HEARING]->(h:Hearing)
     WITH c, count(h) AS hearings
     OPTIONAL MATCH (c)-[:HAS_HEARING]->(n:Hearing) WHERE n.date >= $today
     WITH c, hearings, n ORDER BY n.date
     WITH c, hearings, collect(n)[0] AS next
     OPTIONAL MATCH (doc:Document)-[:BELONGS_TO]->(c)
     WITH c, hearings, next, count(doc) AS documents
     OPTIONAL MATCH (a:Claim {caseId: c.id})-[r:CONTRADICTS]->(:Claim)
       WHERE r.createdAt >= $since AND coalesce(r.dismissed, false) = false AND a.superseded = false
     WITH c, hearings, next, documents, count(r) AS newContradictions
     OPTIONAL MATCH (c)-[l:LINKED_TO]-(o:Case)
     WITH c, hearings, next, documents, newContradictions,
          collect(CASE WHEN o IS NULL THEN NULL ELSE {id: o.id, caseNumber: o.caseNumber, reason: l.reason} END) AS linked
     RETURN c {.*} AS case, hearings, documents, newContradictions, [x IN linked WHERE x IS NOT NULL] AS linked,
            CASE WHEN next IS NULL THEN NULL ELSE {id: next.id, date: next.date, purpose: next.purpose} END AS nextHearing`,
    { firmId, today: todayIST(), since: daysAgoIso(NEW_FOR_DAYS) },
  );
  const overdue = await Promise.all(rows.map((r) => overdueOf(r.case.id)));
  return rows
    .map((r, i) => ({ ...r, overdue: overdue[i]!.length }))
    .sort((a, b) => (a.nextHearing?.date ?? "9999").localeCompare(b.nextHearing?.date ?? "9999"));
}

/** The "needs you before the next hearings" strip, across every case of the firm. */
export async function firmDashboard(firmId: string) {
  const today = todayIST();
  const cases = await runQuery<{ id: string; title: string }>("MATCH (c:Case {firmId: $firmId}) RETURN c.id AS id, c.title AS title", { firmId });
  const [overdueByCase, nextHearing, newContradictions] = await Promise.all([
    Promise.all(cases.map(async (c) => ({ c, rows: await overdueOf(c.id) }))),
    queryOne<{ caseId: string; caseTitle: string; date: string; purpose: string | null }>(
      `MATCH (c:Case {firmId: $firmId})-[:HAS_HEARING]->(h:Hearing) WHERE h.date >= $today
       RETURN c.id AS caseId, c.title AS caseTitle, h.date AS date, h.purpose AS purpose ORDER BY h.date LIMIT 1`,
      { firmId, today },
    ),
    runQuery<{ caseId: string; caseTitle: string; count: number }>(
      `MATCH (c:Case {firmId: $firmId}) MATCH (a:Claim {caseId: c.id})-[r:CONTRADICTS]->(:Claim)
       WHERE r.createdAt >= $since AND coalesce(r.dismissed, false) = false AND a.superseded = false
       RETURN c.id AS caseId, c.title AS caseTitle, count(r) AS count ORDER BY count DESC`,
      { firmId, since: daysAgoIso(NEW_FOR_DAYS) },
    ),
  ]);
  const overdue = overdueByCase
    .flatMap(({ c, rows }) =>
      rows.map((r) => ({ caseId: c.id, caseTitle: c.title, text: r.direction.text, dueDate: r.direction.dueDate, assignees: r.assignedTo.map((a) => a.name) })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { today, overdue, nextHearing, newContradictions };
}
