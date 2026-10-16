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
  "Person",
  ...PERSON_KINDS,
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

/** Nodes whose text is searchable by meaning. Each gets a vector index on `embedding`. */
export const VECTOR_LABELS = ["Chunk", "Segment", "Claim"] as const;

/** Extra range indexes for the lookups the API and agents do most. */
const PROPERTY_INDEXES: [NodeLabel, string][] = [
  ["Case", "caseNumber"],
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
  ["Direction", "dueDate"],
];

const isAlreadyIndexed = (e: unknown) => /already indexed/i.test(String((e as Error)?.message));

async function ensure(query: string) {
  try {
    await getGraph().query(query);
  } catch (e) {
    if (!isAlreadyIndexed(e)) throw e;
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
  console.log("FalkorDB schema ready");
}
