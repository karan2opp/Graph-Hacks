import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse, idParam } from "../../common/utils/index.js";
import { caseIdParams, requireCase } from "../case/index.js";
import { askCase } from "./qa.agent.js";
import { getConversation, listConversations } from "./qa.memory.js";

export const qaRouter = Router();

const askBody = z.object({
  question: z.string().trim().min(2).max(2000),
  conversationId: idParam.optional(),
  hearingId: idParam.optional(), // the hearing open in the app, for "this hearing"
});

/** POST /cases/:caseId/ask  -> answer, citations, tools used, evidence graph */
qaRouter.post("/cases/:caseId/ask", validate({ params: caseIdParams, body: askBody }), async (req, res) => {
  const r = ApiRequest.from<z.infer<typeof askBody>, unknown, { caseId: string }>(req);
  ApiResponse.ok(await askCase({ caseId: r.params.caseId, ...r.body }), "Answered").send(res);
});

/** GET /cases/:caseId/conversations */
qaRouter.get("/cases/:caseId/conversations", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  await requireCase(caseId);
  ApiResponse.ok(await listConversations(caseId)).send(res);
});

/** GET /conversations/:conversationId  -> messages with their citations and tool trace */
qaRouter.get(
  "/conversations/:conversationId",
  validate({ params: z.object({ conversationId: idParam }) }),
  async (req, res) => {
    const { conversationId } = ApiRequest.from<unknown, unknown, { conversationId: string }>(req).params;
    ApiResponse.ok(await getConversation(conversationId)).send(res);
  },
);
