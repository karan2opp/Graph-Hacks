import { guardParams } from "../auth/index.js";
import { Router } from "express";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse } from "../../common/utils/index.js";
import { caseIdParams } from "../case/index.js";
import {
  createHearingBody,
  hearingIdParams,
  updateHearingBody,
  type CreateHearingInput,
  type UpdateHearingInput,
} from "./hearing.schema.js";
import { createHearing, getHearing, listHearings, updateHearing } from "./hearing.service.js";

export const hearingRouter = Router();
guardParams(hearingRouter);

/** POST /cases/:caseId/hearings */
hearingRouter.post(
  "/cases/:caseId/hearings",
  validate({ params: caseIdParams, body: createHearingBody }),
  async (req, res) => {
    const r = ApiRequest.from<CreateHearingInput, unknown, { caseId: string }>(req);
    ApiResponse.created(await createHearing(r.params.caseId, r.body), "Hearing created").send(res);
  },
);

/** GET /cases/:caseId/hearings  -> timeline in date order */
hearingRouter.get("/cases/:caseId/hearings", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, { caseId: string }>(req).params;
  ApiResponse.ok(await listHearings(caseId)).send(res);
});

/** GET /hearings/:hearingId */
hearingRouter.get("/hearings/:hearingId", validate({ params: hearingIdParams }), async (req, res) => {
  const { hearingId } = ApiRequest.from<unknown, unknown, { hearingId: string }>(req).params;
  ApiResponse.ok(await getHearing(hearingId)).send(res);
});

/** PATCH /hearings/:hearingId */
hearingRouter.patch(
  "/hearings/:hearingId",
  validate({ params: hearingIdParams, body: updateHearingBody }),
  async (req, res) => {
    const r = ApiRequest.from<UpdateHearingInput, unknown, { hearingId: string }>(req);
    ApiResponse.ok(await updateHearing(r.params.hearingId, r.body), "Hearing updated").send(res);
  },
);
