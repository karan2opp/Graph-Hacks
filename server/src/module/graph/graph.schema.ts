import { env } from "../../config/env.js";
import { getGraph } from "../../common/db/index.js";

/** Node labels from the graph model in plan.md. Every node carries a unique `id`. */
export const NODE_LABELS = [
  "Case",
  "Hearing",
  "Order",
  "Task",
  "Document",
  "Transcript",
  "Claim",
  "Entity",
  "Actor", // shared label on Party / Lawyer / Judge / Witness
  "Party",
  "Lawyer",
  "Judge",
  "Witness",
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

/** Relationship types from the graph model in plan.md. */
export const EDGE_TYPES = [
  "HAS_HEARING",
  "RELATED_TO",
  "REPRESENTED_BY",
  "PARTY_IN",
  "APPEARED_IN",
  "PRESIDED_BY",
  "RESULTED_IN",
  "DIRECTS",
  "ASSIGNED_TO",
  "FULFILLED_BY",
  "FILED_AT",
  "RECORDED_IN",
  "INVOLVES",
  "TESTIFIED_IN",
  "CALLED_BY",
  "CONTAINS",
  "SPOKEN_BY",
  "MADE_IN",
  "ABOUT",
  "CONTRADICTS",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

const isAlreadyIndexed = (e: unknown) => /already (indexed|exists)/i.test(String((e as Error)?.message));

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
  // Task due dates (overdue-direction check) and hearing dates (timeline ordering).
  await ensure("CREATE INDEX FOR (n:Task) ON (n.dueDate)");
  await ensure("CREATE INDEX FOR (n:Hearing) ON (n.date)");

  // Embeddings live on the same nodes as the original text (see plan.md section 4).
  await ensure(
    `CREATE VECTOR INDEX FOR (n:Claim) ON (n.embedding) OPTIONS {dimension: ${env.EMBEDDING_DIMENSIONS}, similarityFunction: 'cosine'}`,
  );

  console.log("FalkorDB schema ready (indexes created)");
}
