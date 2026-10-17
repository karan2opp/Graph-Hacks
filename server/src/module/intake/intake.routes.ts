import { aiLimit, guardParams } from "../auth/index.js";
import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/index.js";
import { ApiError, ApiRequest, ApiResponse, idParam } from "../../common/utils/index.js";
import { isAIEnabled } from "../../common/ai/index.js";
import { runQuery } from "../../common/db/index.js";
import { caseIdParams } from "../case/index.js";
import { queueDocumentAnalysis, queueTranscriptAnalysis } from "./intake.jobs.js";
import { listClaims, listSubjects, type ClaimFilter } from "./intake.service.js";

export const intakeRouter = Router();
guardParams(intakeRouter);

const claimsQuery = z.object({
  personId: idParam.optional(),
  subjectId: idParam.optional(),
  sourceId: idParam.optional(),
  includeSuperseded: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

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

/** Re-running the intake agent needs the model; without it the request is refused up front. */
function requireAI() {
  if (!isAIEnabled()) throw ApiError.serviceUnavailable("Reading documents needs OPENAI_API_KEY to be set");
}

/** POST /documents/:documentId/analyze  -> re-run the intake agent in the background (202); poll the document */
intakeRouter.post("/documents/:documentId/analyze", aiLimit, validate({ params: z.object({ documentId: idParam }) }), async (req, res) => {
  const { documentId } = ApiRequest.from<unknown, unknown, { documentId: string }>(req).params;
  requireAI();
  await runQuery("MATCH (d:Document {id: $documentId}) SET d.analysis = 'pending', d.analysisError = null", { documentId });
  queueDocumentAnalysis(documentId);
  new ApiResponse(202, "Reading again", { analysis: "pending" }).send(res);
});

/** POST /transcripts/:transcriptId/analyze  -> same for a transcript */
intakeRouter.post("/transcripts/:transcriptId/analyze", aiLimit, validate({ params: z.object({ transcriptId: idParam }) }), async (req, res) => {
  const { transcriptId } = ApiRequest.from<unknown, unknown, { transcriptId: string }>(req).params;
  requireAI();
  await runQuery("MATCH (t:Transcript {id: $transcriptId}) SET t.analysis = 'pending', t.analysisError = null", { transcriptId });
  queueTranscriptAnalysis(transcriptId);
  new ApiResponse(202, "Reading again", { analysis: "pending" }).send(res);
});
