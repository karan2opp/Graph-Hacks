import { randomUUID } from "node:crypto";
import { z } from "zod";
import { generateStructured } from "../../common/ai/index.js";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { nameKey } from "../../common/utils/index.js";
import { createHearing } from "../hearing/index.js";
import { batchBlocks, describePeople, loadPeople } from "./intake.context.js";
import type { SourceBlock } from "./claims.extractor.js";

export const DIRECTION_KINDS = ["direction", "undertaking", "costs", "notice", "stay"] as const;

const orderSchema = z.object({
  directions: z.array(
    z.object({
      source: z.string().describe("Ref of the block it comes from, e.g. C2"),
      text: z.string().describe("What must be done, as one sentence naming who must do it"),
      kind: z.enum(DIRECTION_KINDS),
      assignedTo: z.array(z.string()).describe("Refs (P..) of the people who must comply; empty if the court itself"),
      dueDate: z.string().nullable().describe("YYYY-MM-DD deadline, computed from the order date if relative"),
      dueText: z.string().nullable().describe("The deadline as written, e.g. 'within 30 days of service'"),
    }),
  ),
  nextHearing: z.object({
    date: z.string().nullable().describe("YYYY-MM-DD of the next date of hearing, if the order fixes one"),
    purpose: z.string().nullable().describe("What the next date is for, e.g. 'written statement'"),
  }),
  orderKind: z.enum(["interim", "procedural", "final"]),
  summary: z.string().describe("One or two sentences: what the court decided"),
});

const SYSTEM = `You are the intake agent of a memory system for Indian court cases. You read a court order
(order sheet / daily order) and extract what the court directed, so compliance can be tracked.

Rules:
- One entry per direction. A direction is anything someone must do or must not do: file a document,
  deposit costs, serve notice, appear, maintain status quo, not alienate property.
- kind: direction (do something), undertaking (a party's promise recorded by the court), costs (pay money),
  notice (notice / summons to be issued or served), stay (status quo, injunction, restraint).
- assignedTo: refs of the people who must comply. "Plaintiff to file..." means the plaintiff party.
  "The parties" / "both parties" means every party in the case.
  "Notice be issued to the defendant" is a step for the plaintiff (to take steps) unless stated otherwise.
- dueDate: an explicit date, or computed from the ORDER DATE for "within 2 weeks", "within 30 days".
  "Before / on the next date" means the next hearing date. Null for standing obligations (status quo).
- ALREADY IN FORCE lists obligations from earlier orders. If this order only continues one of them
  ("status quo to continue", "interim order to continue"), do not list it again. An obligation that is
  not in that list is new, even if it says "till further orders".
- Do not list statements of what already happened ("process fee has been filed", "notice served").
- Lifting or ending an earlier obligation ("status quo stands vacated", "interim order discharged") is
  not a direction. Do not list it.
- nextHearing: the date the matter is "put up" / "listed" / "adjourned to", with its purpose.
- Dates in orders are usually DD.MM.YYYY. Always answer in YYYY-MM-DD.`;

/**
 * Extracts directions from an order and writes:
 * (order:Document)-[:GIVES]->(Direction)-[:TO]->(Person), (Chunk)-[:CONTAINS]->(Direction).
 * Also schedules the next hearing the order fixes. Re-running replaces earlier directions.
 */
export async function extractDirections(order: {
  caseId: string;
  documentId: string;
  title: string;
  orderDate: string | null;
  hearingId: string | null;
  blocks: SourceBlock[];
}): Promise<{ directionIds: string[]; nextHearingId: string | null }> {
  const people = await loadPeople(order.caseId);
  const inForce = await runQuery<{ text: string; orderDate: string | null }>(
    `MATCH (d:Direction {caseId: $caseId})
     WHERE d.sourceId <> $documentId AND d.kind IN ['stay', 'undertaking'] AND NOT (d)-[:VACATED_BY]->()
     RETURN d.text AS text, d.orderDate AS orderDate`,
    { caseId: order.caseId, documentId: order.documentId },
  );
  const inForceText = inForce.length
    ? inForce.map((d) => `- ${d.text} (order of ${d.orderDate ?? "?"})`).join("\n")
    : "(none)";
  const personByRef = new Map(people.map((p) => [p.ref, p.id]));

  const batches = batchBlocks(order.blocks, 20000); // orders are short; normally one call
  const results = [];
  for (const batch of batches) {
    results.push(
      await generateStructured(
        orderSchema,
        "court_order",
        SYSTEM,
        `ORDER: ${order.title}\nORDER DATE: ${order.orderDate ?? "unknown"}\n\nPEOPLE IN THE CASE:\n${describePeople(people)}\n\nALREADY IN FORCE:\n${inForceText}\n\nORDER TEXT:\n${batch.map((b) => `[${b.ref}] ${b.label}\n${b.text}`).join("\n\n")}`,
      ),
    );
  }
  const blockByRef = new Map(order.blocks.map((b) => [b.ref, b]));
  const isDate = (d: string | null | undefined): d is string => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "");
  const partyIds = people.filter((p) => p.kind === "Party").map((p) => p.id);
  // "The parties shall maintain status quo": the model often leaves this unassigned.
  const assignees = (refs: string[], text: string) => {
    const ids = refs.map((ref) => personByRef.get(ref)).filter((id): id is string => Boolean(id));
    return ids.length || !/\b(the|both|all)\s+parties\b/i.test(text) ? ids : partyIds;
  };

  // A lawyer's manual status survives re-analysis. The model may word a direction slightly
  // differently each time, so match on the same kind plus overlapping words, not exact text.
  const manual = await runQuery<{ text: string; kind: string; status: string; note: string | null; at: string }>(
    `MATCH (d:Direction {sourceId: $documentId}) WHERE d.manualStatus IS NOT NULL
     RETURN d.text AS text, d.kind AS kind, d.manualStatus AS status, d.manualNote AS note, d.manualAt AS at`,
    { documentId: order.documentId },
  );
  const words = (s: string) => new Set(nameKey(s).split(" ").filter((w) => w.length > 2));
  const overlap = (a: Set<string>, b: Set<string>) =>
    [...a].filter((w) => b.has(w)).length / Math.max(1, new Set([...a, ...b]).size);
  const unclaimed = [...manual];
  const carryOver = (text: string, kind: string) => {
    const w = words(text);
    const best = unclaimed
      .filter((m) => m.kind === kind)
      .map((m) => ({ m, score: overlap(w, words(m.text)) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 0.4) return null;
    unclaimed.splice(unclaimed.indexOf(best.m), 1);
    return { status: best.m.status, note: best.m.note, at: best.m.at };
  };

  const rows = results.flatMap((r) =>
    r.directions
      .filter((d) => blockByRef.has(d.source))
      .map((d) => ({
        id: randomUUID(),
        chunkId: blockByRef.get(d.source)!.nodeId,
        text: d.text,
        kind: d.kind,
        dueDate: isDate(d.dueDate) ? d.dueDate : null,
        dueText: d.dueText,
        assignedTo: assignees(d.assignedTo, d.text),
        manual: carryOver(d.text, d.kind),
      })),
  );

  await runQuery("MATCH (d:Direction {sourceId: $documentId}) DETACH DELETE d", { documentId: order.documentId });
  await runQuery(
    `UNWIND $rows AS row
     MATCH (o:Document {id: $documentId}), (ch:Chunk {id: row.chunkId})
     CREATE (o)-[:GIVES]->(d:Direction {id: row.id, caseId: $caseId, sourceId: $documentId, hearingId: $hearingId,
       text: row.text, kind: row.kind, dueDate: row.dueDate, dueText: row.dueText, orderDate: $orderDate,
       status: 'pending', manualStatus: row.manual.status, manualNote: row.manual.note, manualAt: row.manual.at,
       createdBy: 'intake-agent', createdAt: $now, updatedAt: $now}),
       (ch)-[:CONTAINS]->(d)
     WITH d, row
     UNWIND (CASE WHEN size(row.assignedTo) = 0 THEN [NULL] ELSE row.assignedTo END) AS pid
     OPTIONAL MATCH (p:Person {id: pid})
     FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | CREATE (d)-[:TO]->(p))`,
    {
      rows,
      documentId: order.documentId,
      caseId: order.caseId,
      hearingId: order.hearingId,
      orderDate: order.orderDate,
      now: nowIso(),
    },
  );

  // What the order says about itself, and the next date it fixes.
  const main = results[0]!;
  const next = results.map((r) => r.nextHearing).find((n) => isDate(n.date)) ?? null;
  await runQuery(
    `MATCH (o:Document {id: $documentId})
     SET o.orderKind = coalesce(o.orderKind, $orderKind), o.summary = $summary, o.nextDate = $nextDate`,
    {
      documentId: order.documentId,
      orderKind: main.orderKind,
      summary: results.map((r) => r.summary).join(" "),
      nextDate: next?.date ?? null,
    },
  );

  let nextHearingId: string | null = null;
  if (next?.date && (!order.orderDate || next.date > order.orderDate)) {
    const existing = await queryOne<{ id: string; purpose: string | null }>(
      "MATCH (h:Hearing {caseId: $caseId, date: $date}) RETURN h.id AS id, h.purpose AS purpose",
      { caseId: order.caseId, date: next.date },
    );
    if (existing) {
      nextHearingId = existing.id;
      if (!existing.purpose && next.purpose) {
        await runQuery("MATCH (h:Hearing {id: $id}) SET h.purpose = $purpose", { id: existing.id, purpose: next.purpose });
      }
    } else {
      const created = await createHearing(order.caseId, { date: next.date, purpose: next.purpose ?? undefined });
      nextHearingId = (created as unknown as { hearing: { id: string } }).hearing.id;
      await runQuery("MATCH (h:Hearing {id: $id}) SET h.createdBy = 'intake-agent', h.sourceId = $documentId", {
        id: nextHearingId,
        documentId: order.documentId,
      });
    }
  }
  return { directionIds: rows.map((r) => r.id), nextHearingId };
}
