import { queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import { requireCase } from "../case/index.js";
import { listClaims } from "../intake/index.js";
import type { Category } from "./factcheck.agent.js";

type EdgeType = "CONTRADICTS" | "DISPUTES" | "SUPPORTS";

interface EdgeRow {
  from: string;
  to: string;
  type: EdgeType;
  category: Category;
  severity: "high" | "medium" | "low";
  reason: string;
  subjects: string[];
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Turns fact-check edges into pairs of fully cited claims: the newer statement and the earlier one. */
async function withClaims(caseId: string, edges: EdgeRow[]) {
  const claims = await listClaims(caseId, { ids: [...new Set(edges.flatMap((e) => [e.from, e.to]))], includeSuperseded: true });
  const byId = new Map(claims.map((c) => [(c.claim as { id: string }).id, c]));
  return edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({
      type: e.type,
      category: e.category,
      severity: e.severity,
      reason: e.reason,
      subjects: e.subjects,
      earlier: byId.get(e.to)!,
      later: byId.get(e.from)!,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

async function edgesOf(caseId: string, type: EdgeType, category?: Category) {
  return runQuery<EdgeRow>(
    `MATCH (a:Claim {caseId: $caseId, superseded: false})-[r:${type}]->(b:Claim {superseded: false})
     WHERE $category IS NULL OR r.category = $category
     OPTIONAL MATCH (a)-[:ABOUT]->(s:Subject)<-[:ABOUT]-(b)
     RETURN a.id AS from, b.id AS to, '${type}' AS type, r.category AS category, r.severity AS severity,
            r.reason AS reason, collect(DISTINCT s.name) AS subjects`,
    { caseId, category: category ?? null },
  );
}

/** Contradictions: same person over time, same side, or against a document of record. */
export async function listContradictions(caseId: string, category?: Category) {
  await requireCase(caseId);
  return withClaims(caseId, await edgesOf(caseId, "CONTRADICTS", category));
}

/** Points in dispute: opposite sides asserting incompatible facts. */
export async function listDisputes(caseId: string) {
  await requireCase(caseId);
  return withClaims(caseId, await edgesOf(caseId, "DISPUTES"));
}

/** Everything the fact-check agent linked to one claim, in either direction. */
export async function relatedClaims(claimId: string) {
  const row = await queryOne<{ caseId: string }>("MATCH (c:Claim {id: $claimId}) RETURN c.caseId AS caseId", { claimId });
  if (!row) throw ApiError.notFound("Claim not found");
  const edges = await runQuery<EdgeRow>(
    `MATCH (a:Claim)-[r:CONTRADICTS|DISPUTES|SUPPORTS]->(b:Claim)
     WHERE a.id = $claimId OR b.id = $claimId
     OPTIONAL MATCH (a)-[:ABOUT]->(s:Subject)<-[:ABOUT]-(b)
     RETURN a.id AS from, b.id AS to, type(r) AS type, r.category AS category, r.severity AS severity,
            r.reason AS reason, collect(DISTINCT s.name) AS subjects`,
    { claimId },
  );
  return withClaims(row.caseId, edges);
}
