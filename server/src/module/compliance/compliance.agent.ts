import { z } from "zod";
import { generateStructured, isAIEnabled } from "../../common/ai/index.js";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { env } from "../../config/env.js";

/**
 * Compliance agent. Links court directions to the evidence that they were followed:
 *   (Direction)-[:COMPLIED_BY {evidence: 'document' | 'order', onTime, daysLate, reason}]->(Document)
 *   (Direction)-[:NONCOMPLIANCE_RECORDED_IN {reason}]->(order)   court noted it was not done
 *   (Direction)-[:VACATED_BY {reason}]->(order)                    a later order lifted it
 * Evidence is only filed documents and later orders, never transcripts. Directions a lawyer
 * has set by hand (manualStatus) are never touched.
 */

/** Standing obligations: in force until lifted, never "complied" by filing something. */
export const STANDING_KINDS = ["stay", "undertaking"];
const DOC_TEXT_CHARS = 2500;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

interface DirectionInfo {
  id: string;
  text: string;
  kind: string;
  dueDate: string | null;
  dueText: string | null;
  orderDate: string | null;
  assignees: string[];
}
interface DocInfo {
  id: string;
  title: string;
  type: string;
  date: string | null; // filing date when known, else the document's own date
  filedBy: string | null;
  text: string;
}

async function loadDocs(ids: string[]): Promise<Map<string, DocInfo>> {
  const rows = await runQuery<Omit<DocInfo, "text"> & { chunks: string[] }>(
    `MATCH (d:Document) WHERE d.id IN $ids
     OPTIONAL MATCH (d)-[:FILED_BY]->(p:Party)
     OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
     WITH d, p, c ORDER BY c.seq
     WITH d, p, collect(c.text) AS chunks
     RETURN d.id AS id, d.title AS title, d.type AS type, coalesce(d.filedOn, d.date) AS date, p.name AS filedBy, chunks`,
    { ids },
  );
  return new Map(rows.map(({ chunks, ...d }) => [d.id, { ...d, text: chunks.join("\n").slice(0, DOC_TEXT_CHARS) }]));
}

const DIRECTION_FIELDS = `d.id AS id, d.text AS text, d.kind AS kind, d.dueDate AS dueDate, d.dueText AS dueText,
  d.orderDate AS orderDate, collect(DISTINCT p.name) AS assignees`;

const describeDirection = (d: DirectionInfo) =>
  `${d.text} (ordered ${d.orderDate ?? "?"}; ${d.dueDate ? `due ${d.dueDate}` : "no due date"}${d.dueText ? `, "${d.dueText}"` : ""}; on ${d.assignees.join(", ") || "unspecified"})`;

// ---------------------------------------------------------------- documents vs directions

const matchSchema = z.object({
  results: z.array(
    z.object({
      pair: z.string(),
      fulfils: z.boolean().describe("Is this document the thing the direction required?"),
      reason: z.string().describe("One sentence"),
    }),
  ),
});

const MATCH_SYSTEM = `You are the compliance agent of a memory system for Indian court cases. For each pair,
decide whether the DOCUMENT is what the court DIRECTION required the party to file or do.

fulfils = true when the document is the required filing itself: "file written statement" -> the written
statement; "file reply to the application" -> the reply; "deposit costs" -> a receipt or challan of that
deposit; "file the original sale deed" -> the sale deed filed by that party; "file affidavit of evidence"
-> that affidavit.
fulfils = false when the document merely mentions the subject, is a different kind of filing, or was filed
by someone else.`;

/** Asks the model which (direction, document) pairs are compliance, and writes COMPLIED_BY edges. */
async function judgePairs(pairs: { direction: DirectionInfo; doc: DocInfo }[]): Promise<number> {
  if (!pairs.length) return 0;
  const prompt = pairs
    .map(
      (p, i) => `[M${i + 1}]
DIRECTION: ${describeDirection(p.direction)}
DOCUMENT: ${p.doc.title} (type ${p.doc.type.replace(/_/g, " ")}, filed ${p.doc.date ?? "?"}, filed by ${p.doc.filedBy ?? "?"})
${p.doc.text}`,
    )
    .join("\n\n---\n\n");
  const out = await generateStructured(matchSchema, "compliance_match", MATCH_SYSTEM, prompt, {
    model: env.OPENAI_REASONING_MODEL,
  });

  const rows = out.results.flatMap((r) => {
    const p = pairs[Number(r.pair.replace(/\D/g, "")) - 1];
    if (!r.fulfils || !p) return [];
    const late = p.direction.dueDate && p.doc.date ? daysBetween(p.direction.dueDate, p.doc.date) : null;
    return [
      {
        directionId: p.direction.id,
        documentId: p.doc.id,
        reason: r.reason,
        onTime: late === null ? null : late <= 0,
        daysLate: late !== null && late > 0 ? late : 0,
      },
    ];
  });
  await runQuery(
    `UNWIND $rows AS row
     MATCH (d:Direction {id: row.directionId}), (doc:Document {id: row.documentId})
     WHERE d.manualStatus IS NULL AND NOT (d)-[:COMPLIED_BY]->()
     CREATE (d)-[:COMPLIED_BY {evidence: 'document', reason: row.reason, onTime: row.onTime, daysLate: row.daysLate,
       detectedBy: 'compliance-agent', createdAt: $now}]->(doc)`,
    { rows, now: nowIso() },
  );
  return rows.length;
}

/** A new document: does it fulfil any pending direction given to the party who filed it? */
export async function checkDocument(caseId: string, documentId: string): Promise<number> {
  if (!isAIEnabled()) return 0;
  const directions = await runQuery<DirectionInfo>(
    `MATCH (doc:Document {id: $documentId})-[:FILED_BY]->(party:Party)<-[:TO]-(d:Direction {caseId: $caseId})
     WHERE d.manualStatus IS NULL AND NOT d.kind IN $standing AND NOT (d)-[:COMPLIED_BY]->()
       AND NOT (d)-[:VACATED_BY]->()
       AND (coalesce(doc.filedOn, doc.date) IS NULL OR d.orderDate IS NULL OR d.orderDate <= coalesce(doc.filedOn, doc.date))
     OPTIONAL MATCH (d)-[:TO]->(p:Person)
     RETURN ${DIRECTION_FIELDS}`,
    { caseId, documentId, standing: STANDING_KINDS },
  );
  if (!directions.length) return 0;
  const doc = (await loadDocs([documentId])).get(documentId)!;
  return judgePairs(directions.map((direction) => ({ direction, doc })));
}

/** New directions from an order: were any already satisfied by documents filed after the order? */
export async function checkNewDirections(caseId: string, directionIds: string[]): Promise<number> {
  if (!isAIEnabled() || !directionIds.length) return 0;
  const rows = await runQuery<DirectionInfo & { docIds: string[] }>(
    `MATCH (d:Direction {caseId: $caseId})-[:TO]->(party:Party)<-[:FILED_BY]-(doc:Document)
     WHERE d.id IN $directionIds AND NOT d.kind IN $standing AND doc.type <> 'order'
       AND (coalesce(doc.filedOn, doc.date) IS NULL OR d.orderDate IS NULL OR coalesce(doc.filedOn, doc.date) >= d.orderDate)
     WITH d, collect(DISTINCT doc.id) AS docIds
     OPTIONAL MATCH (d)-[:TO]->(p:Person)
     RETURN ${DIRECTION_FIELDS}, docIds`,
    { caseId, directionIds, standing: STANDING_KINDS },
  );
  const docs = await loadDocs([...new Set(rows.flatMap((r) => r.docIds))]);
  const pairs = rows.flatMap(({ docIds, ...direction }) => docIds.map((id) => ({ direction, doc: docs.get(id)! })));
  return judgePairs(pairs.filter((p) => p.doc));
}

// ---------------------------------------------------------------- later orders

const orderSchema = z.object({
  outcomes: z.array(
    z.object({
      ref: z.string().describe("Direction ref, e.g. D2"),
      outcome: z.enum(["complied", "not_complied", "vacated", "no_mention"]),
      quote: z.string().describe("The order's words about it, or empty"),
      reason: z.string(),
    }),
  ),
});

const ORDER_SYSTEM = `You are the compliance agent of a memory system for Indian court cases. You read a NEW court
order and decide what it records about each EARLIER direction.

outcome:
- complied: the order records it was done ("written statement filed", "costs paid", "process fee filed").
- not_complied: the order records it was not done ("WS not filed despite opportunity", "costs not paid").
- vacated: the order lifts or ends it ("interim order vacated", "status quo order stands discharged").
- no_mention: the order says nothing about it. This is the usual answer; do not guess.`;

/** A new order: does it record compliance, non-compliance or vacation of earlier directions? */
export async function checkOrder(caseId: string, orderId: string, excludeIds: string[] = []): Promise<number> {
  if (!isAIEnabled()) return 0;
  const order = await queryOne<{ date: string | null; title: string }>(
    "MATCH (o:Document {id: $orderId}) RETURN o.date AS date, o.title AS title",
    { orderId },
  );
  // Directions still open on this order's date: never complied, or complied only by a later filing
  // (an April order noting "WS not filed" stays true even if the WS was filed in May).
  const earlier = await runQuery<DirectionInfo>(
    `MATCH (d:Direction {caseId: $caseId})
     WHERE NOT d.id IN $excludeIds AND d.sourceId <> $orderId AND d.manualStatus IS NULL
       AND ($date IS NULL OR d.orderDate IS NULL OR d.orderDate <= $date)
       AND NOT (d)-[:VACATED_BY]->()
     OPTIONAL MATCH (d)-[:COMPLIED_BY]->(cd:Document)
     WITH d, cd
     WHERE cd IS NULL OR ($date IS NOT NULL AND coalesce(cd.filedOn, cd.date) > $date)
     OPTIONAL MATCH (d)-[:TO]->(p:Person)
     RETURN ${DIRECTION_FIELDS}`,
    { caseId, orderId, excludeIds, date: order?.date ?? null },
  );
  if (!earlier.length) return 0;
  const text = (await loadDocs([orderId])).get(orderId)?.text ?? "";
  const out = await generateStructured(
    orderSchema,
    "order_compliance",
    ORDER_SYSTEM,
    `EARLIER DIRECTIONS:\n${earlier.map((d, i) => `D${i + 1}: ${describeDirection(d)}`).join("\n")}\n\nNEW ORDER: ${order?.title} (${order?.date ?? "undated"})\n${text}`,
    { model: env.OPENAI_REASONING_MODEL },
  );

  let written = 0;
  for (const o of out.outcomes) {
    const d = earlier[Number(o.ref.replace(/\D/g, "")) - 1];
    if (!d || o.outcome === "no_mention") continue;
    const params = { directionId: d.id, orderId, reason: o.reason, quote: o.quote, now: nowIso() };
    if (o.outcome === "complied") {
      const late = d.dueDate && order?.date ? daysBetween(d.dueDate, order.date) : null;
      await runQuery(
        `MATCH (d:Direction {id: $directionId}), (o:Document {id: $orderId}) WHERE NOT (d)-[:COMPLIED_BY]->()
         CREATE (d)-[:COMPLIED_BY {evidence: 'order', reason: $reason, quote: $quote, onTime: $onTime, daysLate: 0,
           detectedBy: 'compliance-agent', createdAt: $now}]->(o)`,
        // Recorded by a later order: only "on time" if that order itself came before the deadline.
        { ...params, onTime: late === null ? null : late <= 0 ? true : null },
      );
    } else {
      const rel = o.outcome === "vacated" ? "VACATED_BY" : "NONCOMPLIANCE_RECORDED_IN";
      await runQuery(
        `MATCH (d:Direction {id: $directionId}), (o:Document {id: $orderId}) WHERE NOT (d)-[:${rel}]->(o)
         CREATE (d)-[:${rel} {reason: $reason, quote: $quote, detectedBy: 'compliance-agent', createdAt: $now}]->(o)`,
        params,
      );
    }
    written++;
  }
  return written;
}
