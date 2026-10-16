import { createHash, randomUUID } from "node:crypto";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { isImageKitEnabled, uploadMedia } from "../../common/media/index.js";
import { ApiError } from "../../common/utils/index.js";
import { requireCase } from "../case/index.js";
import { requireHearing } from "../hearing/index.js";
import { chunkPages, extractPages, queueDocumentEmbedding, splitTextPages } from "../ingestion/index.js";
import { queueDocumentAnalysis } from "../intake/index.js";
import type { CreateDocumentInput, DocumentType } from "./document.schema.js";

export interface DocumentNode {
  id: string;
  caseId: string;
  title: string;
  type: DocumentType;
  date: string | null;
  filedOn: string | null;
  orderKind: string | null;
  private: boolean;
  source: "file" | "text";
  fileName: string | null;
  mimeType: string;
  size: number;
  hash: string;
  fileUrl: string | null;
  fileId: string | null;
  pageCount: number;
  chunkCount: number;
  status: "extracted" | "embedding" | "ready" | "stored" | "failed";
  note: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const CHUNK_WRITE_BATCH = 100;

export async function requireDocument(documentId: string): Promise<DocumentNode> {
  const row = await queryOne<{ d: DocumentNode }>("MATCH (d:Document {id: $documentId}) RETURN d {.*} AS d", {
    documentId,
  });
  if (!row) throw ApiError.notFound("Document not found");
  return row.d;
}

/**
 * Pipeline steps 1-3 (store, read, chunk) run inside the request; embedding runs in the
 * background. Returns the existing document when the same content was already uploaded.
 */
export async function createDocument(
  caseId: string,
  input: CreateDocumentInput,
  file?: UploadedFile,
): Promise<{ document: DocumentNode; created: boolean; warnings: string[] }> {
  if (!file && !input.text) throw ApiError.badRequest("Attach a file or provide text");
  if (file && input.text) throw ApiError.badRequest("Send either a file or text, not both");

  await requireCase(caseId);
  let hearingDate: string | null = null;
  if (input.hearingId) {
    const h = await requireHearing(input.hearingId);
    if (h.caseId !== caseId) throw ApiError.badRequest("hearingId: hearing belongs to another case");
    hearingDate = h.date;
  }
  if (input.filedById) {
    const p = await queryOne("MATCH (p:Party {id: $id, caseId: $caseId}) RETURN p.id AS id", {
      id: input.filedById,
      caseId,
    });
    if (!p) throw ApiError.badRequest("filedById: no party with this id in the case");
  }

  const buffer = file ? file.buffer : Buffer.from(input.text!, "utf8");
  const mimeType = file ? file.mimetype : "text/plain";
  const hash = createHash("sha256").update(buffer).digest("hex");

  const existing = await queryOne<{ d: DocumentNode }>(
    "MATCH (d:Document {caseId: $caseId, hash: $hash}) RETURN d {.*} AS d",
    { caseId, hash },
  );
  if (existing) return { document: existing.d, created: false, warnings: ["Same content was already uploaded"] };

  // READ
  const warnings: string[] = [];
  const extracted = file ? await extractPages(buffer, mimeType) : { pages: splitTextPages(input.text!) };
  const chunks = chunkPages(extracted.pages);
  if (extracted.note) warnings.push(extracted.note);

  // STORE the original file
  let fileUrl: string | null = null;
  let fileId: string | null = null;
  if (file) {
    if (isImageKitEnabled()) {
      const media = await uploadMedia(file, { tags: [caseId, input.type] });
      fileUrl = media.url;
      fileId = media.fileId;
    } else {
      warnings.push("ImageKit is not configured: text was saved but the original file was not stored");
    }
  }

  const id = randomUUID();
  const now = nowIso();
  await runQuery(
    `MATCH (c:Case {id: $caseId})
     CREATE (d:Document {id: $id, caseId: $caseId, title: $title, type: $type, date: $date, filedOn: $filedOn, orderKind: $orderKind,
       private: $private, source: $source, fileName: $fileName, mimeType: $mimeType, size: $size, hash: $hash,
       fileUrl: $fileUrl, fileId: $fileId, pageCount: $pageCount, chunkCount: $chunkCount, status: $status,
       analysis: $analysis, note: $note, error: null, createdAt: $now, updatedAt: $now})-[:BELONGS_TO]->(c)`,
    {
      caseId,
      id,
      title: input.title,
      type: input.type,
      date: input.date ?? hearingDate,
      filedOn: input.filedOn ?? hearingDate,
      orderKind: input.type === "order" ? (input.orderKind ?? null) : null,
      private: input.private ?? input.type === "note",
      source: file ? "file" : "text",
      fileName: file?.originalname ?? null,
      mimeType,
      size: buffer.length,
      hash,
      fileUrl,
      fileId,
      pageCount: extracted.pages.length,
      chunkCount: chunks.length,
      status: chunks.length ? "extracted" : "stored",
      analysis: chunks.length ? "pending" : "skipped",
      note: extracted.note ?? null,
      now,
    },
  );

  if (input.hearingId) {
    await runQuery(
      "MATCH (d:Document {id: $id}), (h:Hearing {id: $hearingId}) CREATE (d)-[:SUBMITTED_IN]->(h)",
      { id, hearingId: input.hearingId },
    );
  }
  if (input.filedById) {
    await runQuery("MATCH (d:Document {id: $id}), (p:Party {id: $partyId}) CREATE (d)-[:FILED_BY]->(p)", {
      id,
      partyId: input.filedById,
    });
  }

  // CHUNK
  for (let i = 0; i < chunks.length; i += CHUNK_WRITE_BATCH) {
    await runQuery(
      `MATCH (d:Document {id: $id})
       UNWIND $chunks AS ch
       CREATE (d)-[:HAS_CHUNK]->(:Chunk {id: ch.id, documentId: $id, caseId: $caseId, seq: ch.seq, page: ch.page,
         para: ch.para, paraLabel: ch.paraLabel, text: ch.text})`,
      { id, caseId, chunks: chunks.slice(i, i + CHUNK_WRITE_BATCH).map((c) => ({ ...c, id: randomUUID() })) },
    );
  }

  // EMBED and ANALYSE (background)
  if (chunks.length) {
    queueDocumentEmbedding(id);
    queueDocumentAnalysis(id);
  }

  return { document: await requireDocument(id), created: true, warnings };
}

export async function listDocuments(caseId: string, filter: { type?: string; hearingId?: string }) {
  await requireCase(caseId);
  return runQuery(
    `MATCH (d:Document)-[:BELONGS_TO]->(:Case {id: $caseId})
     WHERE ($type IS NULL OR d.type = $type)
     OPTIONAL MATCH (d)-[:SUBMITTED_IN]->(h:Hearing)
     OPTIONAL MATCH (d)-[:FILED_BY]->(p:Party)
     WITH d, h, p
     WHERE $hearingId IS NULL OR h.id = $hearingId
     RETURN d {.id, .title, .type, .date, .filedOn, .orderKind, .private, .status, .pageCount, .chunkCount, .fileUrl, .createdAt} AS document,
            CASE WHEN h IS NULL THEN NULL ELSE {id: h.id, date: h.date} END AS hearing,
            CASE WHEN p IS NULL THEN NULL ELSE {id: p.id, name: p.name} END AS filedBy
     ORDER BY d.date, d.createdAt`,
    { caseId, type: filter.type ?? null, hearingId: filter.hearingId ?? null },
  );
}

export async function getDocument(documentId: string) {
  const document = await requireDocument(documentId);
  const row = await queryOne(
    `MATCH (d:Document {id: $documentId})
     OPTIONAL MATCH (d)-[:SUBMITTED_IN]->(h:Hearing)
     OPTIONAL MATCH (d)-[:FILED_BY]->(p:Party)
     OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
     WITH h, p, count(c) AS chunks, sum(CASE WHEN c.embedding IS NULL THEN 0 ELSE 1 END) AS embedded
     RETURN CASE WHEN h IS NULL THEN NULL ELSE {id: h.id, date: h.date} END AS hearing,
            CASE WHEN p IS NULL THEN NULL ELSE {id: p.id, name: p.name} END AS filedBy,
            chunks, embedded`,
    { documentId },
  );
  return { ...document, ...row };
}

export async function listChunks(documentId: string, page?: number) {
  await requireDocument(documentId);
  return runQuery(
    `MATCH (:Document {id: $documentId})-[:HAS_CHUNK]->(c:Chunk)
     WHERE $page IS NULL OR c.page = $page
     RETURN c.id AS id, c.seq AS seq, c.page AS page, c.para AS para, c.paraLabel AS paraLabel, c.text AS text,
            c.embedding IS NOT NULL AS embedded
     ORDER BY c.seq`,
    { documentId, page: page ?? null },
  );
}
