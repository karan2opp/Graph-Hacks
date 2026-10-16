import { z } from "zod";
import { generateStructured, isAIEnabled } from "../../common/ai/index.js";
import { nowIso, runQuery } from "../../common/db/index.js";
import { env } from "../../config/env.js";

/**
 * Fact-check agent. For each new claim it finds earlier claims on the same subject (graph) or
 * with similar meaning (vector), works out from the graph whose side each claim is on, asks the
 * model whether each pair conflicts, and writes the verdict back as an edge:
 *   CONTRADICTS  same person, same side, or against a document of record
 *   DISPUTES     opposite sides disagreeing (that is the dispute itself, not a contradiction)
 *   SUPPORTS     one claim corroborates the other
 */

export const CATEGORIES = ["self", "same_side", "record", "opposite", "unclassified"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Documents whose content is a record rather than one side's version. */
export const RECORD_TYPES = ["sale_deed", "agreement", "order", "judgment", "chargesheet", "evidence", "notice", "fir"];
const SIDE_A = ["plaintiff", "petitioner", "appellant", "complainant", "prosecution"];

const VECTOR_K = 8;
// Cosine distance for pairs found only by meaning (no shared subject). Kept tight: loose matches
// pair claims about different facts by the same person and produce false contradictions.
const MAX_DISTANCE = 0.4;
const MAX_CANDIDATES = 10; // per new claim
const PAIRS_PER_CALL = 15;

interface ClaimInfo {
  id: string;
  text: string;
  quote: string;
  statedOn: string | null;
  personId: string | null;
  personName: string | null;
  personKind: string | null;
  role: string | null; // party role of the side this claim is on
  docType: string | null;
  sourceLabel: string;
}

const sideOf = (c: ClaimInfo) => (c.role ? (SIDE_A.includes(c.role) ? "A" : "B") : null);
const isRecord = (c: ClaimInfo) => c.docType !== null && RECORD_TYPES.includes(c.docType);

export function categorize(a: ClaimInfo, b: ClaimInfo): Category {
  if (a.personId && a.personId === b.personId && !isRecord(a) && !isRecord(b)) return "self";
  if (isRecord(a) || isRecord(b)) return "record";
  const sa = sideOf(a);
  const sb = sideOf(b);
  if (!sa || !sb) return "unclassified";
  return sa === sb ? "same_side" : "opposite";
}

const CATEGORY_HINT: Record<Category, string> = {
  self: "the same person, at different times",
  same_side: "two people on the same side of the case",
  record: "a document of record and a person's statement",
  opposite: "opposing sides of the case",
  unclassified: "two sources",
};

/** Loads claims with the side they belong to, found by walking MADE_BY / ON_BEHALF_OF / REPRESENTS / CALLED_BY. */
async function loadClaims(ids: string[]): Promise<Map<string, ClaimInfo>> {
  const rows = await runQuery<ClaimInfo>(
    `MATCH (c:Claim) WHERE c.id IN $ids
     OPTIONAL MATCH (c)-[:MADE_BY]->(m:Person)
     OPTIONAL MATCH (c)-[:ON_BEHALF_OF]->(:Party)-[obr:PARTY_IN]->(:Case)
     OPTIONAL MATCH (m)-[pr:PARTY_IN]->(:Case)
     OPTIONAL MATCH (m)-[:REPRESENTS]->(:Party)-[lr:PARTY_IN]->(:Case)
     OPTIONAL MATCH (m)-[:CALLED_BY]->(:Party)-[wr:PARTY_IN]->(:Case)
     OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(ch:Chunk)-[:CONTAINS]->(c)
     OPTIONAL MATCH (sg:Segment)-[:CONTAINS]->(c)
     WITH c, m, d, ch, sg, collect(DISTINCT coalesce(obr.role, pr.role, lr.role, wr.role)) AS roles
     RETURN c.id AS id, c.text AS text, c.quote AS quote, c.statedOn AS statedOn,
            m.id AS personId, m.name AS personName, [l IN labels(m) WHERE l <> 'Person'][0] AS personKind,
            [r IN roles WHERE r IS NOT NULL][0] AS role, d.type AS docType,
            CASE WHEN d IS NOT NULL THEN d.title + ' p' + toString(ch.page) + coalesce(' para ' + ch.paraLabel, '')
                 ELSE 'hearing ' + c.statedOn + ' turn ' + toString(sg.seq) END AS sourceLabel`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Earlier claims worth comparing with each new claim: same subject, or close in meaning. */
async function findCandidates(caseId: string, newIds: string[]): Promise<[string, string][]> {
  const bySubject = await runQuery<{ a: string; b: string }>(
    `MATCH (n:Claim)-[:ABOUT]->(:Subject)<-[:ABOUT]-(o:Claim {caseId: $caseId, superseded: false})
     WHERE n.id IN $newIds AND o.sourceId <> n.sourceId
     RETURN DISTINCT n.id AS a, o.id AS b`,
    { caseId, newIds },
  );

  const vectors = await runQuery<{ id: string; sourceId: string; vec: number[] }>(
    "MATCH (n:Claim) WHERE n.id IN $newIds AND n.embedding IS NOT NULL RETURN n.id AS id, n.sourceId AS sourceId, n.embedding AS vec",
    { newIds },
  );
  const byMeaning: { a: string; b: string }[] = [];
  try {
    for (const v of vectors) {
      const near = await runQuery<{ id: string }>(
        `CALL db.idx.vector.queryNodes('Claim', 'embedding', $k, vecf32($vec)) YIELD node, score
         WHERE node.caseId = $caseId AND node.sourceId <> $sourceId AND node.superseded = false AND score <= $max
         RETURN node.id AS id`,
        { k: VECTOR_K, vec: v.vec, caseId, sourceId: v.sourceId, max: MAX_DISTANCE },
      );
      byMeaning.push(...near.map((n) => ({ a: v.id, b: n.id })));
    }
  } catch (e) {
    // Subject and same-person candidates still work without the vector index.
    console.warn("[fact-check] vector candidates skipped:", (e as Error).message);
  }

  // Same person, any subject: self-contradictions matter most and often use different words
  // ("never received any amount" vs "repaid part of the loan").
  const bySamePerson = await runQuery<{ a: string; b: string }>(
    `MATCH (n:Claim)-[:MADE_BY]->(p:Person)<-[:MADE_BY]-(o:Claim {caseId: $caseId, superseded: false})
     WHERE n.id IN $newIds AND o.sourceId <> n.sourceId
     RETURN DISTINCT n.id AS a, o.id AS b`,
    { caseId, newIds },
  );

  // Unordered, de-duplicated, capped per new claim (subject matches first, then meaning, then person).
  const seen = new Set<string>();
  const perClaim = new Map<string, number>();
  const pairs: [string, string][] = [];
  for (const { a, b } of [...bySubject, ...byMeaning, ...bySamePerson]) {
    const key = [a, b].sort().join("|");
    if (a === b || seen.has(key) || (perClaim.get(a) ?? 0) >= MAX_CANDIDATES) continue;
    seen.add(key);
    perClaim.set(a, (perClaim.get(a) ?? 0) + 1);
    pairs.push([a, b]);
  }
  return pairs;
}

// Field order matters: the model states the fact and answers "can both be true?" before the verdict.
const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      pair: z.string().describe("Pair id, e.g. R3"),
      fact: z.string().describe("The specific fact both claims speak to, or 'none' if they speak to different facts"),
      bothTrue: z.boolean().describe("Can both claims be true at the same time?"),
      relation: z.enum(["contradicts", "supports", "unrelated"]),
      severity: z.enum(["high", "medium", "low"]).describe("How much the difference matters to the case"),
      reason: z.string().describe("One sentence naming exactly what differs or agrees (amount, date, fact)"),
    }),
  ),
});

const SYSTEM = `You are the fact-check agent of a memory system for Indian court cases. You compare pairs of
claims from the case record and decide how they relate.

relation:
- contradicts: both cannot be true. Typical: a fact denied in one place and admitted in another; different
  amounts, dates, places or people for the same event; "never received any amount" vs "repaid part of it".
- supports: one claim corroborates the other (same fact, from another person or document).
- unrelated: about different things, or compatible statements that neither confirm nor conflict.

Be strict. Only call it a contradiction when both claims state something incompatible about the SAME
specific fact. If one claim is silent about that fact, the pair is unrelated (for example, a claim about
who possesses a property says nothing about whether money was paid, and a stated sale price says nothing
about whether any amount was actually received). Two claims about the same subject are not a
contradiction just because they differ in detail or emphasis. A different explanation for the same fact
("it was a loan" vs "it was sale consideration") is a contradiction about the nature of the payment.

severity: high if it goes to the core of the dispute or a witness's credibility (payment received or not,
who owns or possesses the property, date of the incident); medium for supporting facts; low for minor details.

reason: one sentence a lawyer can read in court, naming both sources.`;

/**
 * Checks new claims against the case memory and writes CONTRADICTS / DISPUTES / SUPPORTS edges.
 * Returns how many edges of each kind were written.
 */
export async function factCheckClaims(caseId: string, newIds: string[]) {
  const counts = { contradicts: 0, disputes: 0, supports: 0, pairs: 0 };
  if (!newIds.length || !isAIEnabled()) return counts;

  const pairs = await findCandidates(caseId, newIds);
  counts.pairs = pairs.length;
  if (!pairs.length) return counts;
  const claims = await loadClaims([...new Set(pairs.flat())]);

  const edges: { from: string; to: string; type: "CONTRADICTS" | "DISPUTES" | "SUPPORTS"; props: Record<string, unknown> }[] = [];
  for (let i = 0; i < pairs.length; i += PAIRS_PER_CALL) {
    const batch = pairs.slice(i, i + PAIRS_PER_CALL).map(([a, b], j) => {
      const ca = claims.get(a)!;
      const cb = claims.get(b)!;
      // Older claim first, so the edge points from the newer statement to the earlier one.
      const [older, newer] = (ca.statedOn ?? "") <= (cb.statedOn ?? "") ? [ca, cb] : [cb, ca];
      return { ref: `R${i + j + 1}`, older, newer, category: categorize(older, newer) };
    });
    const prompt = batch
      .map(
        (p) => `[${p.ref}] Comparing ${CATEGORY_HINT[p.category]}.
  A (${p.older.statedOn ?? "undated"}, ${p.older.personName ?? "unknown"}, ${p.older.sourceLabel}): ${p.older.text}
     quote: "${p.older.quote}"
  B (${p.newer.statedOn ?? "undated"}, ${p.newer.personName ?? "unknown"}, ${p.newer.sourceLabel}): ${p.newer.text}
     quote: "${p.newer.quote}"`,
      )
      .join("\n\n");
    const out = await generateStructured(verdictSchema, "fact_check", SYSTEM, prompt, {
      model: env.OPENAI_REASONING_MODEL,
    });
    const byRef = new Map(batch.map((p) => [p.ref, p]));

    for (const v of out.verdicts) {
      const p = byRef.get(v.pair);
      if (!p || v.relation === "unrelated" || v.fact.trim().toLowerCase() === "none") continue;
      // The verdict must agree with the model's own answer to "can both be true?".
      if (v.relation === "contradicts" && v.bothTrue) continue;
      if (v.relation === "supports" && !v.bothTrue) continue;
      const type = v.relation === "supports" ? "SUPPORTS" : p.category === "opposite" ? "DISPUTES" : "CONTRADICTS";
      edges.push({
        from: p.newer.id,
        to: p.older.id,
        type,
        props: { category: p.category, severity: v.severity, reason: v.reason, fact: v.fact },
      });
    }
  }

  for (const type of ["CONTRADICTS", "DISPUTES", "SUPPORTS"] as const) {
    const rows = edges.filter((e) => e.type === type);
    if (!rows.length) continue;
    await runQuery(
      `UNWIND $rows AS row
       MATCH (a:Claim {id: row.from}), (b:Claim {id: row.to})
       WHERE NOT (a)-[:${type}]-(b)
       CREATE (a)-[:${type} {category: row.props.category, severity: row.props.severity, reason: row.props.reason, fact: row.props.fact,
         detectedBy: 'fact-check-agent', createdAt: $now}]->(b)`,
      { rows, now: nowIso() },
    );
    counts[type.toLowerCase() as "contradicts" | "disputes" | "supports"] = rows.length;
  }
  return counts;
}

/** Re-checks every claim of a case from scratch (after a model or prompt change). */
export async function factCheckCase(caseId: string) {
  await runQuery(
    `MATCH (:Claim {caseId: $caseId})-[r:CONTRADICTS|DISPUTES|SUPPORTS]->(:Claim)
     WHERE r.detectedBy = 'fact-check-agent' DELETE r`,
    { caseId },
  );
  const claims = await runQuery<{ id: string }>(
    "MATCH (c:Claim {caseId: $caseId, superseded: false}) RETURN c.id AS id ORDER BY c.statedOn",
    { caseId },
  );
  return factCheckClaims(caseId, claims.map((c) => c.id));
}
