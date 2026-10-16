import { Router } from "express";
import { uploadSingle } from "../../common/media/index.js";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse } from "../../common/utils/index.js";
import { caseIdParams } from "../case/index.js";
import {
  chunksQuery,
  createDocumentBody,
  documentIdParams,
  listDocumentsQuery,
  type CreateDocumentInput,
} from "./document.schema.js";
import { createDocument, getDocument, listChunks, listDocuments } from "./document.service.js";

export const documentRouter = Router();

/**
 * POST /cases/:caseId/documents
 * multipart: file + title, type, date?, hearingId?, filedById?, orderKind?, private?
 * or JSON:   { title, type, text, ... }
 */
documentRouter.post(
  "/cases/:caseId/documents",
  uploadSingle(),
  validate({ params: caseIdParams, body: createDocumentBody }),
  async (req, res) => {
    const r = ApiRequest.from<CreateDocumentInput, unknown, { caseId: string }>(req);
    const { document, created, warnings } = await createDocument(r.params.caseId, r.body, r.file);
    const meta = warnings.length ? { warnings } : undefined;
    (created
      ? ApiResponse.created(document, "Document saved; embedding runs in the background", meta)
      : ApiResponse.ok(document, "Document already uploaded", meta)
    ).send(res);
  },
);

/** GET /cases/:caseId/documents?type=&hearingId= */
documentRouter.get(
  "/cases/:caseId/documents",
  validate({ params: caseIdParams, query: listDocumentsQuery }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, { type?: string; hearingId?: string }, { caseId: string }>(req);
    ApiResponse.ok(await listDocuments(r.params.caseId, r.query)).send(res);
  },
);

/** GET /documents/:documentId  -> metadata + processing status */
documentRouter.get("/documents/:documentId", validate({ params: documentIdParams }), async (req, res) => {
  const { documentId } = ApiRequest.from<unknown, unknown, { documentId: string }>(req).params;
  ApiResponse.ok(await getDocument(documentId)).send(res);
});

/** GET /documents/:documentId/chunks?page= */
documentRouter.get(
  "/documents/:documentId/chunks",
  validate({ params: documentIdParams, query: chunksQuery }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, { page?: number }, { documentId: string }>(req);
    ApiResponse.ok(await listChunks(r.params.documentId, r.query.page)).send(res);
  },
);
