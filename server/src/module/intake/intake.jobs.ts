import { isAIEnabled } from "../../common/ai/index.js";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { checkDocument, checkNewDirections, checkOrder } from "../compliance/compliance.agent.js";
import { factCheckClaims, RECORD_TYPES } from "../factcheck/factcheck.agent.js";
import { enqueue } from "../ingestion/index.js";
import { extractClaims, type SourceBlock } from "./claims.extractor.js";
import { extractDirections } from "./directions.extractor.js";

/**
 * The intake agent's analysis step. Runs after a document or transcript is stored and tracks
 * progress in its own field, separate from embedding:
 *   analysis: pending -> running -> done | failed | skipped
 */
type Owner = "Document" | "Transcript";

/** A party's own pleadings: everything in them is asserted by the party who filed them. */
const PLEADINGS = ["plaint", "written_statement", "replication", "application", "reply"];

async function setAnalysis(label: Owner, id: string, analysis: string, extra: Record<string, unknown> = {}) {
  await runQuery(`MATCH (n:${label} {id: $id}) SET n.analysis = $analysis, n.updatedAt = $now, n += $extra`, {
    id,
    analysis,
    now: nowIso(),
    extra,
  });
}

/** Hands new claims to the fact-check agent. Its failure does not undo the extraction. */
async function factCheck(caseId: string, claimIds: string[]) {
  try {
    const r = await factCheckClaims(caseId, claimIds);
    return { contradictionCount: r.contradicts, disputeCount: r.disputes, supportCount: r.supports, factcheckError: null };
  } catch (e) {
    console.error("[fact-check] failed:", (e as Error).message);
    return { factcheckError: (e as Error).message };
  }
}

/** Hands new documents and directions to the compliance agent. Its failure does not undo the extraction. */
async function compliance(work: () => Promise<number>) {
  try {
    return { complianceLinks: await work(), complianceError: null };
  } catch (e) {
    console.error("[compliance] failed:", (e as Error).message);
    return { complianceError: (e as Error).message };
  }
}

async function run(label: Owner, id: string, work: () => Promise<Record<string, unknown>>) {
  if (!isAIEnabled()) {
    await setAnalysis(label, id, "pending", { analysisError: "Waiting for OPENAI_API_KEY" });
    return;
  }
  try {
    await setAnalysis(label, id, "running", { analysisError: null });
    const result = await work();
    await setAnalysis(label, id, "done", { ...result, analyzedAt: nowIso() });
  } catch (e) {
    await setAnalysis(label, id, "failed", { analysisError: (e as Error).message });
    throw e;
  }
}

export async function analyzeDocument(documentId: string): Promise<void> {
  const doc = await queryOne<{
    caseId: string; title: string; type: string; date: string | null; private: boolean;
    hearingId: string | null; filedById: string | null; hearingDate: string | null;
  }>(
    `MATCH (d:Document {id: $documentId})
     OPTIONAL MATCH (d)-[:SUBMITTED_IN]->(h:Hearing)
     OPTIONAL MATCH (d)-[:FILED_BY]->(p:Party)
     RETURN d.caseId AS caseId, d.title AS title, d.type AS type, d.date AS date, d.private AS private,
            h.id AS hearingId, h.date AS hearingDate, p.id AS filedById`,
    { documentId },
  );
  if (!doc) return;

  const chunks = await runQuery<{ id: string; page: number; para: number; paraLabel: string | null; text: string }>(
    `MATCH (:Document {id: $documentId})-[:HAS_CHUNK]->(c:Chunk)
     RETURN c.id AS id, c.page AS page, c.para AS para, c.paraLabel AS paraLabel, c.text AS text ORDER BY c.seq`,
    { documentId },
  );
  if (!chunks.length) {
    await setAnalysis("Document", documentId, "skipped", { analysisError: "No text to analyse" });
    return;
  }
  const blocks: SourceBlock[] = chunks.map((c, i) => ({
    ref: `C${i + 1}`,
    nodeId: c.id,
    label: `(page ${c.page}${c.paraLabel ? `, para ${c.paraLabel}` : ""})`,
    text: c.text,
  }));

  await run("Document", documentId, async () => {
    if (doc.type === "order") {
      const r = await extractDirections({
        caseId: doc.caseId,
        documentId,
        title: doc.title,
        orderDate: doc.date ?? doc.hearingDate,
        hearingId: doc.hearingId,
        blocks,
      });
      // What this order records about earlier directions, and whether its own new directions
      // were already met by documents on file.
      const links = await compliance(
        async () =>
          (await checkOrder(doc.caseId, documentId, r.directionIds)) +
          (await checkNewDirections(doc.caseId, r.directionIds)),
      );
      return { directionCount: r.directionIds.length, ...links };
    }
    const claimIds = await extractClaims({
      caseId: doc.caseId,
      sourceType: "document",
      sourceId: documentId,
      title: `${doc.title} (${doc.type.replace(/_/g, " ")})`,
      statedOn: doc.date ?? doc.hearingDate,
      hearingId: doc.hearingId,
      internal: Boolean(doc.private),
      // Whoever filed a sale deed or FIR did not author it, so do not fall back to the filer.
      defaultMadeBy: RECORD_TYPES.includes(doc.type) ? null : doc.filedById,
      forceMadeBy: PLEADINGS.includes(doc.type),
      blocks,
    });
    return {
      claimCount: claimIds.length,
      ...(await factCheck(doc.caseId, claimIds)),
      ...(await compliance(() => checkDocument(doc.caseId, documentId))),
    };
  });
}

export async function analyzeTranscript(transcriptId: string): Promise<void> {
  const t = await queryOne<{ caseId: string; hearingId: string; date: string; current: boolean; version: number }>(
    `MATCH (h:Hearing)-[:RECORDED_IN]->(t:Transcript {id: $transcriptId})
     RETURN t.caseId AS caseId, h.id AS hearingId, h.date AS date, t.current AS current, t.version AS version`,
    { transcriptId },
  );
  if (!t) return;
  if (!t.current) {
    await setAnalysis("Transcript", transcriptId, "skipped", { analysisError: "Superseded by a newer version" });
    return;
  }
  const turns = await runQuery<{ id: string; seq: number; label: string; text: string; speakerId: string | null; speakerRef: string | null }>(
    `MATCH (:Transcript {id: $transcriptId})-[:HAS_SEGMENT]->(s:Segment)
     OPTIONAL MATCH (s)-[:SPOKEN_BY]->(p:Person)
     RETURN s.id AS id, s.seq AS seq, s.speakerLabel AS label, s.text AS text, p.id AS speakerId, p.name AS speakerRef
     ORDER BY s.seq`,
    { transcriptId },
  );

  await run("Transcript", transcriptId, async () => {
    const claimIds = await extractClaims({
      caseId: t.caseId,
      sourceType: "transcript",
      sourceId: transcriptId,
      title: `Transcript of the hearing on ${t.date}`,
      statedOn: t.date,
      hearingId: t.hearingId,
      internal: false,
      defaultMadeBy: null,
      blocks: turns.map((s) => ({
        ref: `T${s.seq}`,
        nodeId: s.id,
        label: `Turn ${s.seq}. ${s.label}${s.speakerRef ? ` (= ${s.speakerRef})` : ""}:`,
        text: s.text,
        speakerId: s.speakerId,
      })),
    });
    // Claims from older versions of this hearing's transcript no longer count.
    await runQuery(
      `MATCH (c:Claim {hearingId: $hearingId, sourceType: 'transcript'}) WHERE c.sourceId <> $transcriptId
       SET c.superseded = true`,
      { hearingId: t.hearingId, transcriptId },
    );
    return { claimCount: claimIds.length, ...(await factCheck(t.caseId, claimIds)) };
  });
}

export const queueDocumentAnalysis = (documentId: string) =>
  enqueue(`analyze:document:${documentId}`, () => analyzeDocument(documentId), "analyze");

export const queueTranscriptAnalysis = (transcriptId: string) =>
  enqueue(`analyze:transcript:${transcriptId}`, () => analyzeTranscript(transcriptId), "analyze");

/** Re-queues analysis cut off by a restart or waiting for a key. */
export async function resumeIntakeJobs(): Promise<void> {
  if (!isAIEnabled()) return;
  const pending = "WHERE n.analysis IN ['pending', 'running'] RETURN n.id AS id";
  const docs = await runQuery<{ id: string }>(`MATCH (n:Document) ${pending}`);
  const transcripts = await runQuery<{ id: string }>(`MATCH (n:Transcript) ${pending}`);
  docs.forEach((d) => queueDocumentAnalysis(d.id));
  transcripts.forEach((t) => queueTranscriptAnalysis(t.id));
  const total = docs.length + transcripts.length;
  if (total) console.log(`Resumed ${total} pending analysis job(s)`);
}
