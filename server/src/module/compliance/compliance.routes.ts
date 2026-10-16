import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse, idParam } from "../../common/utils/index.js";
import { caseIdParams } from "../case/index.js";
import {
  complianceReport,
  DIRECTION_STATES,
  listDirections,
  MANUAL_STATUSES,
  setManualStatus,
  type DirectionState,
} from "./compliance.service.js";

export const complianceRouter = Router();

/** GET /cases/:caseId/directions?status=pending|overdue|complied|in_force|vacated */
complianceRouter.get(
  "/cases/:caseId/directions",
  validate({ params: caseIdParams, query: z.object({ status: z.enum(DIRECTION_STATES).optional() }) }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, { status?: DirectionState }, { caseId: string }>(req);
    ApiResponse.ok(await listDirections(r.params.caseId, r.query.status)).send(res);
  },
);

/** GET /cases/:caseId/compliance  -> overdue, due before next hearing, complied, in force, per party */
complianceRouter.get("/cases/:caseId/compliance", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  ApiResponse.ok(await complianceReport(caseId)).send(res);
});

const manualBody = z.object({
  status: z.enum(MANUAL_STATUSES),
  note: z.string().trim().min(1).optional(),
});

/** PATCH /directions/:directionId  { status: complied|not_complied|vacated|auto, note? } */
complianceRouter.patch(
  "/directions/:directionId",
  validate({ params: z.object({ directionId: idParam }), body: manualBody }),
  async (req, res) => {
    const r = ApiRequest.from<z.infer<typeof manualBody>, unknown, { directionId: string }>(req);
    const updated = await setManualStatus(r.params.directionId, r.body.status, r.body.note);
    ApiResponse.ok(updated, r.body.status === "auto" ? "Override removed" : "Direction updated by lawyer").send(res);
  },
);
