import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse, idParam } from "../../common/utils/index.js";
import { caseIdParams, requireCase } from "../case/index.js";
import { CATEGORIES, factCheckCase, type Category } from "./factcheck.agent.js";
import { listContradictions, listDisputes, relatedClaims } from "./factcheck.service.js";

export const factCheckRouter = Router();

/** GET /cases/:caseId/contradictions?category=self|same_side|record|unclassified */
factCheckRouter.get(
  "/cases/:caseId/contradictions",
  validate({ params: caseIdParams, query: z.object({ category: z.enum(CATEGORIES).optional() }) }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, { category?: Category }, { caseId: string }>(req);
    ApiResponse.ok(await listContradictions(r.params.caseId, r.query.category)).send(res);
  },
);

/** GET /cases/:caseId/disputes  -> points where the two sides disagree */
factCheckRouter.get("/cases/:caseId/disputes", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  ApiResponse.ok(await listDisputes(caseId)).send(res);
});

/** GET /claims/:claimId/related  -> contradictions, disputes and support around one claim */
factCheckRouter.get("/claims/:claimId/related", validate({ params: z.object({ claimId: idParam }) }), async (req, res) => {
  const { claimId } = ApiRequest.from<unknown, unknown, { claimId: string }>(req).params;
  ApiResponse.ok(await relatedClaims(claimId)).send(res);
});

/** POST /cases/:caseId/factcheck  -> re-check every claim of the case (waits for the result) */
factCheckRouter.post("/cases/:caseId/factcheck", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  await requireCase(caseId);
  ApiResponse.ok(await factCheckCase(caseId), "Fact-check finished").send(res);
});
