import { embedTexts, isAIEnabled } from "../../common/ai/index.js";
import { nowIso, runQuery } from "../../common/db/index.js";
import { enqueue } from "./queue.js";

const WRITE_BATCH = 32;
const SHORT_TURN_CHARS = 80; // turns shorter than this ("Denied.", "Obliged.") get context
const CONTEXT_CHARS = 200; // of the previous turn, embedded with a short turn
const MAX_EMBED_CHARS = 6000; // stay well inside the embedding model's token limit

type Owner = "Document" | "Transcript";

async function setStatus(label: Owner, id: string, status: string, extra: Record<string, unknown> = {}) {
  await runQuery(`MATCH (n:${label} {id: $id}) SET n.status = $status, n.updatedAt = $now, n += $extra`, {
    id,
    status,
    now: nowIso(),
    extra,
  });
}

/** Writes vectors onto nodes of one label, in batches to keep query strings small. */
async function writeEmbeddings(label: "Chunk" | "Segment", rows: { id: string; vec: number[] }[]) {
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    await runQuery(`UNWIND $rows AS row MATCH (n:${label} {id: row.id}) SET n.embedding = vecf32(row.vec)`, {
      rows: rows.slice(i, i + WRITE_BATCH),
    });
  }
}

/**
 * Shared flow: wait for a key, mark `embedding`, embed what is missing, mark `ready`.
 * Without an OpenAI key the owner stays `extracted` and is resumed on a later boot.
 */
async function runEmbedding(
  owner: Owner,
  id: string,
  target: "Chunk" | "Segment",
  load: () => Promise<{ id: string; input: string }[]>,
) {
  if (!isAIEnabled()) {
    await setStatus(owner, id, "extracted", { note: "Waiting for embeddings: OPENAI_API_KEY is not set" });
    return;
  }
  try {
    await setStatus(owner, id, "embedding");
    const items = await load();
    const vectors = await embedTexts(items.map((i) => i.input.slice(0, MAX_EMBED_CHARS)));
    await writeEmbeddings(target, items.map((item, i) => ({ id: item.id, vec: vectors[i]! })));
    await setStatus(owner, id, "ready", { embeddedAt: nowIso(), note: null, error: null });
  } catch (e) {
    await setStatus(owner, id, "failed", { error: `Embedding failed: ${(e as Error).message}` });
    throw e;
  }
}

export async function embedDocument(documentId: string): Promise<void> {
  await runEmbedding("Document", documentId, "Chunk", async () =>
    runQuery<{ id: string; input: string }>(
      `MATCH (:Document {id: $documentId})-[:HAS_CHUNK]->(c:Chunk)
       WHERE c.embedding IS NULL
       RETURN c.id AS id, c.text AS input ORDER BY c.seq`,
      { documentId },
    ),
  );
}

/**
 * Each turn is embedded on its own. Short replies ("Denied.", "That is correct") also carry
 * the tail of the previous turn so they keep their meaning. Longer turns get no context,
 * otherwise neighbouring turns compete for the same searches.
 */
export async function embedTranscript(transcriptId: string): Promise<void> {
  await runEmbedding("Transcript", transcriptId, "Segment", async () => {
    const turns = await runQuery<{ id: string; seq: number; label: string; text: string; done: boolean }>(
      `MATCH (:Transcript {id: $transcriptId})-[:HAS_SEGMENT]->(s:Segment)
       RETURN s.id AS id, s.seq AS seq, s.speakerLabel AS label, s.text AS text, s.embedding IS NOT NULL AS done
       ORDER BY s.seq`,
      { transcriptId },
    );
    return turns.flatMap((t, i) => {
      if (t.done) return [];
      const prev = turns[i - 1];
      const context =
        prev && t.text.length < SHORT_TURN_CHARS ? `${prev.label}: ${prev.text.slice(-CONTEXT_CHARS)}\n` : "";
      return [{ id: t.id, input: `${context}${t.label}: ${t.text}` }];
    });
  });
}

export const queueDocumentEmbedding = (documentId: string) =>
  enqueue(`embed:document:${documentId}`, () => embedDocument(documentId));

export const queueTranscriptEmbedding = (transcriptId: string) =>
  enqueue(`embed:transcript:${transcriptId}`, () => embedTranscript(transcriptId));
