import { randomUUID } from "node:crypto";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import type { CreateCaseInput, UpdateCaseInput } from "./case.schema.js";

export interface CaseNode {
  id: string;
  caseNumber: string;
  title: string;
  court: string;
  caseType: "civil" | "criminal";
  stage: string;
  status: "open" | "disposed";
  filedOn: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Throws 404 unless the case exists. Other modules call this before writing under a case. */
export async function requireCase(caseId: string): Promise<CaseNode> {
  const row = await queryOne<{ c: CaseNode }>("MATCH (c:Case {id: $caseId}) RETURN c {.*} AS c", { caseId });
  if (!row) throw ApiError.notFound("Case not found");
  return row.c;
}

export async function createCase(input: CreateCaseInput): Promise<CaseNode> {
  const dup = await queryOne(
    "MATCH (c:Case {caseNumber: $caseNumber, court: $court}) RETURN c.id AS id",
    { caseNumber: input.caseNumber, court: input.court },
  );
  if (dup) throw ApiError.conflict(`Case ${input.caseNumber} already exists in ${input.court}`);

  const now = nowIso();
  const row = await queryOne<{ c: CaseNode }>(
    `CREATE (c:Case {id: $id, caseNumber: $caseNumber, title: $title, court: $court, caseType: $caseType,
       stage: $stage, status: 'open', filedOn: $filedOn, description: $description, createdAt: $now, updatedAt: $now})
     RETURN c {.*} AS c`,
    {
      id: randomUUID(),
      ...input,
      filedOn: input.filedOn ?? null,
      description: input.description ?? null,
      now,
    },
  );
  return row!.c;
}

export async function updateCase(caseId: string, input: UpdateCaseInput): Promise<CaseNode> {
  await requireCase(caseId);
  const row = await queryOne<{ c: CaseNode }>(
    "MATCH (c:Case {id: $caseId}) SET c += $patch, c.updatedAt = $now RETURN c {.*} AS c",
    { caseId, patch: input, now: nowIso() },
  );
  return row!.c;
}

export async function listCases() {
  return runQuery<{ case: CaseNode; hearings: number; documents: number; nextHearing: string | null }>(
    `MATCH (c:Case)
     OPTIONAL MATCH (c)-[:HAS_HEARING]->(h:Hearing)
     WITH c, count(h) AS hearings, min(CASE WHEN h.status = 'scheduled' THEN h.date END) AS nextHearing
     OPTIONAL MATCH (d:Document)-[:BELONGS_TO]->(c)
     WITH c, hearings, nextHearing, count(d) AS documents
     RETURN c {.*} AS case, hearings, documents, nextHearing
     ORDER BY c.createdAt DESC`,
  );
}

export async function getCaseOverview(caseId: string) {
  const c = await requireCase(caseId);
  const [linked, counts] = await Promise.all([
    runQuery<{ case: Pick<CaseNode, "id" | "caseNumber" | "title" | "court" | "caseType">; reason: string | null }>(
      `MATCH (:Case {id: $caseId})-[l:LINKED_TO]-(o:Case)
       RETURN o {.id, .caseNumber, .title, .court, .caseType} AS case, l.reason AS reason`,
      { caseId },
    ),
    queryOne<{ hearings: number; documents: number; people: number; nextHearing: string | null }>(
      `MATCH (c:Case {id: $caseId})
       OPTIONAL MATCH (c)-[:HAS_HEARING]->(h:Hearing)
       WITH c, count(h) AS hearings, min(CASE WHEN h.status = 'scheduled' THEN h.date END) AS nextHearing
       OPTIONAL MATCH (d:Document)-[:BELONGS_TO]->(c)
       WITH c, hearings, nextHearing, count(d) AS documents
       OPTIONAL MATCH (p:Person {caseId: c.id})
       RETURN hearings, documents, count(p) AS people, nextHearing`,
      { caseId },
    ),
  ]);
  return { ...c, linkedCases: linked, stats: counts };
}

/** Links two cases both ways in meaning (stored once, queried undirected). */
export async function linkCases(caseId: string, linkedCaseId: string, reason?: string) {
  if (caseId === linkedCaseId) throw ApiError.badRequest("A case cannot be linked to itself");
  await Promise.all([requireCase(caseId), requireCase(linkedCaseId)]);
  await runQuery(
    `MATCH (a:Case {id: $caseId}), (b:Case {id: $linkedCaseId})
     WHERE NOT (a)-[:LINKED_TO]-(b)
     CREATE (a)-[:LINKED_TO {reason: $reason, createdAt: $now}]->(b)`,
    { caseId, linkedCaseId, reason: reason ?? null, now: nowIso() },
  );
  return getCaseOverview(caseId);
}
