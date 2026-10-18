import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import { requireCase } from "../case/index.js";
import { listClaims } from "../intake/index.js";
import type { Category } from "./factcheck.agent.js";

type EdgeType = "CONTRADICTS" | "DISPUTES" | "SUPPORTS";

interface EdgeRow {
  id: string;
  dismissed: boolean;
  crossPrep: boolean;
  note: string | null;
  createdAt: string;
  from: string;
  to: string;
  type: EdgeType;
  category: Category;
  severity: "high" | "medium" | "low";
  reason: string;
  subjects: string[];
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Columns every fact-check query returns, so rows can be turned into cited pairs. */
const EDGE_COLUMNS = `r.id AS id, coalesce(r.dismissed, false) AS dismissed, coalesce(r.crossPrep, false) AS crossPrep, r.note AS note,
  r.createdAt AS createdAt, a.id AS from, b.id AS to, type(r) AS type, r.category AS category, r.severity AS severity,
  r.reason AS reason, collect(DISTINCT s.name) AS subjects`;

/** Turns fact-check edges into pairs of fully cited claims: the newer statement and the earlier one. */
async function withClaims(caseId: string, edges: EdgeRow[]) {
  const claims = await listClaims(caseId, { ids: [...new Set(edges.flatMap((e) => [e.from, e.to]))], includeSuperseded: true });
  const byId = new Map(claims.map((c) => [(c.claim as { id: string }).id, c]));
  return edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({
      id: e.id,
      type: e.type,
      category: e.category,
      severity: e.severity,
      reason: e.reason,
      subjects: e.subjects,
      dismissed: e.dismissed,
      crossPrep: e.crossPrep,
      note: e.note,
      createdAt: e.createdAt,
      earlier: byId.get(e.to)!,
      later: byId.get(e.from)!,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

async function edgesOf(caseId: string, type: EdgeType, category?: Category, includeDismissed = false) {
  return runQuery<EdgeRow>(
    `MATCH (a:Claim {caseId: $caseId, superseded: false})-[r:${type}]->(b:Claim {superseded: false})
     WHERE ($category IS NULL OR r.category = $category) AND ($includeDismissed OR coalesce(r.dismissed, false) = false)
     OPTIONAL MATCH (a)-[:ABOUT]->(s:Subject)<-[:ABOUT]-(b)
     RETURN ${EDGE_COLUMNS}`,
    { caseId, category: category ?? null, includeDismissed },
  );
}

/** Contradictions: same person over time, same side, or against a document of record. */
export async function listContradictions(caseId: string, category?: Category, includeDismissed = false) {
  await requireCase(caseId);
  return withClaims(caseId, await edgesOf(caseId, "CONTRADICTS", category, includeDismissed));
}

/** Points in dispute: opposite sides asserting incompatible facts. */
export async function listDisputes(caseId: string, includeDismissed = false) {
  await requireCase(caseId);
  return withClaims(caseId, await edgesOf(caseId, "DISPUTES", undefined, includeDismissed));
}

/** Everything the fact-check agent linked to one claim, in either direction (dismissed findings left out). */
export async function relatedClaims(claimId: string) {
  const row = await queryOne<{ caseId: string }>("MATCH (c:Claim {id: $claimId}) RETURN c.caseId AS caseId", { claimId });
  if (!row) throw ApiError.notFound("Claim not found");
  const edges = await runQuery<EdgeRow>(
    `MATCH (a:Claim)-[r:CONTRADICTS|DISPUTES|SUPPORTS]->(b:Claim)
     WHERE (a.id = $claimId OR b.id = $claimId) AND coalesce(r.dismissed, false) = false
     OPTIONAL MATCH (a)-[:ABOUT]->(s:Subject)<-[:ABOUT]-(b)
     RETURN ${EDGE_COLUMNS}`,
    { claimId },
  );
  return withClaims(row.caseId, edges);
}

/** A lawyer reviews one finding: dismiss it ("not a contradiction") or flag it for cross-examination. */
export async function updateLink(linkId: string, patch: { dismissed?: boolean; crossPrep?: boolean; note?: string | null }) {
  const edges = await runQuery<EdgeRow & { caseId: string }>(
    `MATCH (a:Claim)-[r:CONTRADICTS|DISPUTES|SUPPORTS {id: $linkId}]->(b:Claim)
     SET r += $patch, r.reviewedAt = $now
     WITH a, r, b
     OPTIONAL MATCH (a)-[:ABOUT]->(s:Subject)<-[:ABOUT]-(b)
     RETURN a.caseId AS caseId, ${EDGE_COLUMNS}`,
    { linkId, patch, now: nowIso() },
  );
  const edge = edges[0];
  if (!edge) throw ApiError.notFound("Finding not found");
  const [found] = await withClaims(edge.caseId, edges);
  return found;
}
