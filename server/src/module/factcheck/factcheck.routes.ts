import { guardParams } from "../auth/index.js";
import { Router } from "express";
import { z } from "zod";
import { isAIEnabled } from "../../common/ai/index.js";
import { validate } from "../../common/middleware/index.js";
import { ApiError, ApiRequest, ApiResponse, idParam } from "../../common/utils/index.js";
import { caseIdParams, requireCase } from "../case/index.js";
import { enqueue } from "../ingestion/index.js";
import { CATEGORIES, factCheckCase, type Category } from "./factcheck.agent.js";
import { listContradictions, listDisputes, relatedClaims, updateLink } from "./factcheck.service.js";

export const factCheckRouter = Router();
guardParams(factCheckRouter);

const includeDismissed = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const linkPatch = z
  .object({
    dismissed: z.boolean().optional(),
    crossPrep: z.boolean().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Nothing to update");
type LinkPatch = z.infer<typeof linkPatch>;

/** GET /cases/:caseId/contradictions?category=self|same_side|record&includeDismissed=true */
factCheckRouter.get(
  "/cases/:caseId/contradictions",
  validate({ params: caseIdParams, query: z.object({ category: z.enum(CATEGORIES).optional(), includeDismissed }) }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, { category?: Category; includeDismissed: boolean }, { caseId: string }>(req);
    ApiResponse.ok(await listContradictions(r.params.caseId, r.query.category, r.query.includeDismissed)).send(res);
  },
);

/** GET /cases/:caseId/disputes  -> points where the two sides disagree */
factCheckRouter.get("/cases/:caseId/disputes", validate({ params: caseIdParams, query: z.object({ includeDismissed }) }), async (req, res) => {
  const r = ApiRequest.from<unknown, { includeDismissed: boolean }, { caseId: string }>(req);
  ApiResponse.ok(await listDisputes(r.params.caseId, r.query.includeDismissed)).send(res);
});

/** GET /claims/:claimId/related  -> contradictions, disputes and support around one claim */
factCheckRouter.get("/claims/:claimId/related", validate({ params: z.object({ claimId: idParam }) }), async (req, res) => {
  const { claimId } = ApiRequest.from<unknown, unknown, { claimId: string }>(req).params;
  ApiResponse.ok(await relatedClaims(claimId)).send(res);
});

/** PATCH /links/:linkId  { dismissed?, crossPrep?, note? }  -> a lawyer reviews one finding */
factCheckRouter.patch("/links/:linkId", validate({ params: z.object({ linkId: idParam }), body: linkPatch }), async (req, res) => {
  const r = ApiRequest.from<LinkPatch, unknown, { linkId: string }>(req);
  ApiResponse.ok(await updateLink(r.params.linkId, r.body), "Finding updated").send(res);
});

/** POST /cases/:caseId/factcheck  -> re-check every claim of the case in the background (202) */
factCheckRouter.post("/cases/:caseId/factcheck", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  await requireCase(caseId);
  if (!isAIEnabled()) throw ApiError.serviceUnavailable("The fact-check agent needs OPENAI_API_KEY to be set");
  enqueue(`factcheck:${caseId}`, async () => void (await factCheckCase(caseId)), "analyze");
  new ApiResponse(202, "Fact-check started", null).send(res);
});
