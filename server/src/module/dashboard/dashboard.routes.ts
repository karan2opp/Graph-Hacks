import { Router } from "express";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse } from "../../common/utils/index.js";
import { guardParams } from "../auth/index.js";
import { caseIdParams } from "../case/index.js";
import { caseBrief } from "./brief.service.js";
import { firmDashboard, listCaseCards } from "./dashboard.service.js";

export const dashboardRouter = Router();
guardParams(dashboardRouter);

/** GET /cases  -> the firm's cases with next hearing, overdue directions and new contradictions */
dashboardRouter.get("/cases", async (req, res) => {
  ApiResponse.ok(await listCaseCards(req.user!.firmId)).send(res);
});

/** GET /dashboard  -> what needs attention across the firm */
dashboardRouter.get("/dashboard", async (req, res) => {
  ApiResponse.ok(await firmDashboard(req.user!.firmId)).send(res);
});

/** GET /cases/:caseId/brief  -> the case home: next hearing, what's due, contradictions for cross, timeline, agent activity */
dashboardRouter.get("/cases/:caseId/brief", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  ApiResponse.ok(await caseBrief(caseId)).send(res);
});
