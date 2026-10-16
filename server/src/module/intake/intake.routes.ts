import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/index.js";
import { ApiError, ApiRequest, ApiResponse, idParam } from "../../common/utils/index.js";
import { queryOne } from "../../common/db/index.js";
import { caseIdParams } from "../case/index.js";
import { analyzeDocument, analyzeTranscript } from "./intake.jobs.js";
import { listClaims, listDirections, listSubjects, type ClaimFilter } from "./intake.service.js";

export const intakeRouter = Router();

const claimsQuery = z.object({
  personId: idParam.optional(),
  subjectId: idParam.optional(),
  sourceId: idParam.optional(),
  includeSuperseded: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
const directionsQuery = z.object({ status: z.enum(["pending", "overdue", "complied"]).optional() });

/** GET /cases/:caseId/claims?personId=&subjectId=&sourceId=&includeSuperseded= */
intakeRouter.get("/cases/:caseId/claims", validate({ params: caseIdParams, query: claimsQuery }), async (req, res) => {
  const r = ApiRequest.from<unknown, ClaimFilter, { caseId: string }>(req);
  ApiResponse.ok(await listClaims(r.params.caseId, r.query)).send(res);
});

/** GET /cases/:caseId/subjects */
intakeRouter.get("/cases/:caseId/subjects", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  ApiResponse.ok(await listSubjects(caseId)).send(res);
});

/** GET /cases/:caseId/directions?status=pending|overdue|complied */
intakeRouter.get(
  "/cases/:caseId/directions",
  validate({ params: caseIdParams, query: directionsQuery }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, { status?: "pending" | "overdue" | "complied" }, { caseId: string }>(req);
    ApiResponse.ok(await listDirections(r.params.caseId, r.query.status)).send(res);
  },
);

/** POST /documents/:documentId/analyze  -> re-run the intake agent (waits for the result) */
intakeRouter.post(
  "/documents/:documentId/analyze",
  validate({ params: z.object({ documentId: idParam }) }),
  async (req, res) => {
    const { documentId } = ApiRequest.from<unknown, unknown, { documentId: string }>(req).params;
    if (!(await queryOne("MATCH (d:Document {id: $documentId}) RETURN d.id AS id", { documentId }))) {
      throw ApiError.notFound("Document not found");
    }
    await analyzeDocument(documentId);
    const d = await queryOne("MATCH (d:Document {id: $documentId}) RETURN d {.analysis, .analysisError, .claimCount, .directionCount} AS d", { documentId });
    ApiResponse.ok(d?.d, "Analysis finished").send(res);
  },
);

/** POST /transcripts/:transcriptId/analyze */
intakeRouter.post(
  "/transcripts/:transcriptId/analyze",
  validate({ params: z.object({ transcriptId: idParam }) }),
  async (req, res) => {
    const { transcriptId } = ApiRequest.from<unknown, unknown, { transcriptId: string }>(req).params;
    if (!(await queryOne("MATCH (t:Transcript {id: $transcriptId}) RETURN t.id AS id", { transcriptId }))) {
      throw ApiError.notFound("Transcript not found");
    }
    await analyzeTranscript(transcriptId);
    const t = await queryOne("MATCH (t:Transcript {id: $transcriptId}) RETURN t {.analysis, .analysisError, .claimCount} AS t", { transcriptId });
    ApiResponse.ok(t?.t, "Analysis finished").send(res);
  },
);
