import { randomUUID } from "node:crypto";
import { z } from "zod";
import { embedTexts, generateStructured } from "../../common/ai/index.js";
import { nowIso, runQuery } from "../../common/db/index.js";
import { nameKey } from "../../common/utils/index.js";
import {
  batchBlocks,
  describePeople,
  describeSubjects,
  loadPeople,
  loadSubjects,
  quoteFound,
  SUBJECT_TYPES,
  type PersonRef,
  type SubjectRef,
} from "./intake.context.js";

export const CLAIM_KINDS = ["allegation", "denial", "admission", "fact", "undertaking"] as const;

const claimsSchema = z.object({
  claims: z.array(
    z.object({
      source: z.string().describe("Ref of the block the claim comes from, e.g. C3 or T12"),
      text: z.string().describe("The claim as one self-contained sentence naming the people involved"),
      quote: z.string().describe("Exact words copied from the source block that state the claim (at most 40 words)"),
      madeBy: z.string().nullable().describe("Ref of the person asserting the claim (P..), null if unknown"),
      onBehalfOf: z.string().nullable().describe("Ref of the party a lawyer or witness is speaking for, else null"),
      kind: z.enum(CLAIM_KINDS),
      eventDate: z.string().nullable().describe("YYYY-MM-DD of the event the claim is about, if the text gives it"),
      subjects: z
        .array(
          z.object({
            ref: z.string().nullable().describe("Existing subject ref (S..) if it is the same thing, else null"),
            name: z.string().describe("Short canonical name, e.g. 'Payment of Rs. 5,00,000'"),
            type: z.enum(SUBJECT_TYPES),
          }),
        )
        .describe("The specific things the claim is about"),
    }),
  ),
});
type ExtractedClaim = z.infer<typeof claimsSchema>["claims"][number];

const SYSTEM = `You are the intake agent of a memory system for Indian court cases. You read one source
(a filed document or a hearing transcript) and extract the factual claims in it, so that later we can
answer "who said what, where" and detect when someone contradicts an earlier statement.

What is a claim: one assertion about the facts of the dispute: payments, property, possession, documents,
dates, events, injuries, who did what. Extract every such assertion, including denials and admissions.

Rules:
- One claim per assertion. Keep negation explicit ("Suresh Gupta did NOT receive...").
- Write each claim so it makes sense alone: use names from the people list instead of "he", "my client",
  "the defendant". Keep amounts and dates exactly as stated.
- quote: copy the exact words from that source block, do not paraphrase.
- madeBy: the person ASSERTING it, not the person it is about ("Suresh refused to hand over possession"
  in the plaintiff's plaint is asserted by the plaintiff). In a transcript turn it is the speaker. In a filed document it is the
  party who filed it, unless the text shows a different deponent or complainant.
- onBehalfOf: when a lawyer or witness asserts something for a party, that party's ref.
- kind: allegation (accuses someone), denial (rejects an allegation), admission (concedes something against
  own interest), fact (neutral statement), undertaking (promise to the court).
- Skip procedural chatter (seeking time, greetings, objections without facts), questions, and the judge's
  directions.
- subjects: every claim has at least one subject. A denial is about the same subject as the thing it
  denies ("did NOT receive Rs. 5,00,000" is about the payment of Rs. 5,00,000). Reuse an existing subject
  ref whenever it is the same thing; otherwise give a short canonical name (e.g. "Property No. 14,
  Lajpat Nagar", "Payment of Rs. 5,00,000", "Sale deed dated 12.03.2019").
- If the source has no claims, return an empty list.`;

export interface SourceBlock {
  ref: string; // C1.. or T1..
  nodeId: string; // Chunk or Segment id
  label: string; // "page 2, para 3" or "Ld. Counsel for Defendant (= P4)"
  text: string;
  speakerId?: string | null; // transcript turns: resolved speaker
}

export interface ClaimSource {
  caseId: string;
  sourceType: "document" | "transcript";
  sourceId: string; // Document or Transcript id
  title: string; // shown to the model
  statedOn: string | null; // date of the document / hearing
  hearingId: string | null;
  internal: boolean; // lawyer's private notes
  defaultMadeBy: string | null; // filing party for documents
  forceMadeBy?: boolean; // pleadings: every claim is the filing party's own assertion
  blocks: SourceBlock[];
}

function buildPrompt(source: ClaimSource, people: PersonRef[], subjects: SubjectRef[], blocks: SourceBlock[]) {
  return `SOURCE: ${source.title}${source.statedOn ? ` (dated ${source.statedOn})` : ""}

PEOPLE IN THE CASE:
${describePeople(people)}

EXISTING SUBJECTS:
${describeSubjects(subjects)}

SOURCE BLOCKS:
${blocks.map((b) => `[${b.ref}] ${b.label}\n${b.text}`).join("\n\n")}`;
}

/**
 * Extracts claims from a document or transcript and writes them to the graph:
 * (Chunk|Segment)-[:CONTAINS]->(Claim)-[:MADE_BY]->(Person), -[:ABOUT]->(Subject).
 * Re-running replaces the claims previously extracted from the same source. Returns the new claim ids.
 */
export async function extractClaims(source: ClaimSource): Promise<string[]> {
  const people = await loadPeople(source.caseId);
  const subjects = await loadSubjects(source.caseId);
  const personByRef = new Map(people.map((p) => [p.ref, p.id]));

  const found: { claim: ExtractedClaim; block: SourceBlock }[] = [];
  for (const batch of batchBlocks(source.blocks)) {
    const out = await generateStructured(claimsSchema, "claims", SYSTEM, buildPrompt(source, people, subjects, batch));
    const byRef = new Map(batch.map((b) => [b.ref, b]));
    for (const claim of out.claims) {
      const block = byRef.get(claim.source);
      if (!block) continue;
      if (!claim.subjects.length) console.warn(`[intake] claim without subject: "${claim.text}"`);
      found.push({ claim, block });
    }
  }

  await runQuery("MATCH (c:Claim {sourceId: $sourceId}) DETACH DELETE c", { sourceId: source.sourceId });
  if (!found.length) return [];

  // Subjects: reuse by ref, otherwise MERGE by normalised name inside the case.
  const subjectIdByRef = new Map(subjects.map((s) => [s.ref, s.id]));
  const newSubjects = new Map<string, { key: string; id: string; name: string; type: string }>();
  for (const { claim } of found) {
    for (const s of claim.subjects) {
      if (s.ref && subjectIdByRef.has(s.ref)) continue;
      const key = nameKey(s.name);
      if (key && !newSubjects.has(key)) newSubjects.set(key, { key, id: randomUUID(), name: s.name, type: s.type });
    }
  }
  const merged = await runQuery<{ key: string; id: string }>(
    `UNWIND $subjects AS s
     MERGE (n:Subject {caseId: $caseId, nameKey: s.key})
     ON CREATE SET n.id = s.id, n.name = s.name, n.type = s.type, n.createdAt = $now
     RETURN s.key AS key, n.id AS id`,
    { caseId: source.caseId, subjects: [...newSubjects.values()], now: nowIso() },
  );
  const subjectIdByKey = new Map(merged.map((m) => [m.key, m.id]));
  const subjectIds = (claim: ExtractedClaim) => [
    ...new Set(
      claim.subjects
        .map((s) => (s.ref && subjectIdByRef.get(s.ref)) || subjectIdByKey.get(nameKey(s.name)))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const now = nowIso();
  const rows = found.map(({ claim, block }) => ({
    id: randomUUID(),
    nodeId: block.nodeId,
    text: claim.text,
    quote: claim.quote,
    quoteVerified: quoteFound(claim.quote, block.text),
    kind: claim.kind,
    eventDate: /^\d{4}-\d{2}-\d{2}$/.test(claim.eventDate ?? "") ? claim.eventDate : null,
    madeBy:
      block.speakerId ??
      (source.forceMadeBy ? source.defaultMadeBy : null) ??
      (claim.madeBy && personByRef.get(claim.madeBy)) ??
      source.defaultMadeBy ??
      null,
    onBehalfOf: (claim.onBehalfOf && claim.onBehalfOf !== claim.madeBy && personByRef.get(claim.onBehalfOf)) || null,
    subjectIds: subjectIds(claim),
  }));

  const sourceLabel = source.sourceType === "document" ? "Chunk" : "Segment";
  await runQuery(
    `UNWIND $rows AS row
     MATCH (src:${sourceLabel} {id: row.nodeId})
     CREATE (src)-[:CONTAINS]->(c:Claim {id: row.id, caseId: $caseId, text: row.text, quote: row.quote,
       quoteVerified: row.quoteVerified, kind: row.kind, eventDate: row.eventDate, statedOn: $statedOn,
       sourceType: $sourceType, sourceId: $sourceId, hearingId: $hearingId, internal: $internal,
       superseded: false, createdBy: 'intake-agent', createdAt: $now})
     WITH c, row
     OPTIONAL MATCH (m:Person {id: row.madeBy})
     FOREACH (_ IN CASE WHEN m IS NULL THEN [] ELSE [1] END | CREATE (c)-[:MADE_BY]->(m))
     WITH c, row
     OPTIONAL MATCH (o:Person {id: row.onBehalfOf})
     FOREACH (_ IN CASE WHEN o IS NULL THEN [] ELSE [1] END | CREATE (c)-[:ON_BEHALF_OF]->(o))
     WITH c, row
     UNWIND (CASE WHEN size(row.subjectIds) = 0 THEN [NULL] ELSE row.subjectIds END) AS sid
     OPTIONAL MATCH (s:Subject {id: sid})
     FOREACH (_ IN CASE WHEN s IS NULL THEN [] ELSE [1] END | CREATE (c)-[:ABOUT]->(s))`,
    {
      rows,
      caseId: source.caseId,
      statedOn: source.statedOn,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      hearingId: source.hearingId,
      internal: source.internal,
      now,
    },
  );

  // Claims are searchable by meaning, like chunks and turns.
  const vectors = await embedTexts(rows.map((r) => r.text));
  const withVec = rows.map((r, i) => ({ id: r.id, vec: vectors[i]! }));
  for (let i = 0; i < withVec.length; i += 32) {
    await runQuery("UNWIND $rows AS row MATCH (c:Claim {id: row.id}) SET c.embedding = vecf32(row.vec)", {
      rows: withVec.slice(i, i + 32),
    });
  }
  return rows.map((r) => r.id);
}
