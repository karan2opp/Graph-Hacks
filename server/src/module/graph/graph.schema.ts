import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { getGraph } from "../../common/db/index.js";

/** People. Every one of them also carries the `Person` label (see plan.md section 4). */
export const PERSON_KINDS = ["Party", "Lawyer", "Judge", "Witness"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

export const NODE_LABELS = [
  "Case",
  "Hearing",
  "Document",
  "Chunk",
  "Transcript",
  "Segment",
  "Direction",
  "Claim",
  "Subject",
  "Conversation", // Q&A memory
  "Message",
  "Person",
  ...PERSON_KINDS,
  // Accounts
  "Firm",
  "User",
  "Session",
  "Invite",
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

/** Nodes whose text is searchable by meaning. Each gets a vector index on `embedding`. */
export const VECTOR_LABELS = ["Chunk", "Segment", "Claim"] as const;

/** Extra range indexes for the lookups the API and agents do most. */
const PROPERTY_INDEXES: [NodeLabel, string][] = [
  ["Case", "caseNumber"],
  ["Case", "firmId"],
  ["User", "email"],
  ["Session", "tokenHash"],
  ["Session", "userId"],
  ["Invite", "tokenHash"],
  ["Claim", "caseId"],
  ["Direction", "caseId"],
  ["Hearing", "caseId"],
  ["Hearing", "date"],
  ["Document", "caseId"],
  ["Document", "hash"],
  ["Document", "status"],
  ["Chunk", "documentId"],
  ["Transcript", "hearingId"],
  ["Segment", "transcriptId"],
  ["Segment", "seq"],
  ["Person", "caseId"],
  ["Person", "nameKey"],
  ["Direction", "status"],
  ["Conversation", "caseId"],
];

const isAlreadyIndexed = (e: unknown) => /already indexed/i.test(String((e as Error)?.message));

async function ensure(query: string) {
  try {
    await getGraph().query(query);
  } catch (e) {
    if (!isAlreadyIndexed(e)) throw e;
  }
}

/** Fact-check links get an id so a lawyer can dismiss or flag one. Older links get one here. */
async function backfillLinkIds() {
  const res = await getGraph().query<{ rid: number }>(
    "MATCH (:Claim)-[r:CONTRADICTS|DISPUTES|SUPPORTS]->(:Claim) WHERE r.id IS NULL RETURN ID(r) AS rid",
  );
  for (const { rid } of res.data ?? []) {
    await getGraph().query("MATCH ()-[r]->() WHERE ID(r) = $rid SET r.id = $id", { params: { rid, id: randomUUID() } });
  }
}

/** Idempotent: safe to call on every boot. */
export async function initGraphSchema(): Promise<void> {
  for (const label of NODE_LABELS) {
    await ensure(`CREATE INDEX FOR (n:${label}) ON (n.id)`);
  }
  for (const [label, prop] of PROPERTY_INDEXES) {
    await ensure(`CREATE INDEX FOR (n:${label}) ON (n.${prop})`);
  }
  // Vector search returns cosine *distance*: lower score = closer match.
  for (const label of VECTOR_LABELS) {
    await ensure(
      `CREATE VECTOR INDEX FOR (n:${label}) ON (n.embedding) OPTIONS {dimension: ${env.EMBEDDING_DIMENSIONS}, similarityFunction: 'cosine'}`,
    );
  }
  // A range index on Direction.dueDate made 'dueDate < $today' return future dates (FalkorDB string range bug), so it is dropped.
  await getGraph().query("DROP INDEX ON :Direction(dueDate)").catch(() => undefined);
  await backfillLinkIds();
  console.log("FalkorDB schema ready");
}
