import { embedTexts, isAIEnabled } from "../../common/ai/index.js";
import { nowIso, runQuery } from "../../common/db/index.js";
import { enqueue } from "./queue.js";

const WRITE_BATCH = 32;

async function setDocumentStatus(documentId: string, status: string, extra: Record<string, unknown> = {}) {
  await runQuery("MATCH (d:Document {id: $documentId}) SET d.status = $status, d.updatedAt = $now, d += $extra", {
    documentId,
    status,
    now: nowIso(),
    extra,
  });
}

/** Writes vectors onto nodes of one label, in batches to keep query strings small. */
async function writeEmbeddings(label: "Chunk" | "Segment", rows: { id: string; vec: number[] }[]) {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    await runQuery(
      `UNWIND $rows AS row MATCH (n:${label} {id: row.id}) SET n.embedding = vecf32(row.vec)`,
      { rows: rows.slice(i, i + WRITE_BATCH) },
    );
  }
}

/**
 * Embeds every chunk of a document that has no vector yet, then marks it `ready`.
 * Without an OpenAI key the document stays `extracted` and is picked up on a later boot.
 */
export async function embedDocument(documentId: string): Promise<void> {
  if (!isAIEnabled()) {
    await setDocumentStatus(documentId, "extracted", { note: "Waiting for embeddings: OPENAI_API_KEY is not set" });
    return;
  }
  try {
    await setDocumentStatus(documentId, "embedding");
    const chunks = await runQuery<{ id: string; text: string }>(
      `MATCH (:Document {id: $documentId})-[:HAS_CHUNK]->(c:Chunk)
       WHERE c.embedding IS NULL
       RETURN c.id AS id, c.text AS text ORDER BY c.seq`,
      { documentId },
    );
    const vectors = await embedTexts(chunks.map((c) => c.text));
    await writeEmbeddings("Chunk", chunks.map((c, i) => ({ id: c.id, vec: vectors[i]! })));
    await setDocumentStatus(documentId, "ready", { embeddedAt: nowIso(), note: null, error: null });
  } catch (e) {
    await setDocumentStatus(documentId, "failed", { error: `Embedding failed: ${(e as Error).message}` });
    throw e;
  }
}

export const queueDocumentEmbedding = (documentId: string) =>
  enqueue(`embed:document:${documentId}`, () => embedDocument(documentId));
