import { guardParams, ownsResource } from "../auth/index.js";
import { Router } from "express";
import { validate } from "../../common/middleware/index.js";
import { ApiError, ApiRequest, ApiResponse } from "../../common/utils/index.js";
import {
  addPersonBody,
  caseIdParams,
  createCaseBody,
  linkCaseBody,
  updateCaseBody,
  type AddPersonInput,
  type CreateCaseInput,
  type UpdateCaseInput,
} from "./case.schema.js";
import { createCase, getCaseOverview, linkCases, updateCase } from "./case.service.js";
import { addPerson, listPeople } from "./person.service.js";

type CaseParams = { caseId: string };

export const caseRouter = Router();
guardParams(caseRouter);

/** POST /cases */
caseRouter.post("/cases", validate({ body: createCaseBody }), async (req, res) => {
  const created = await createCase(req.user!.firmId, ApiRequest.from<CreateCaseInput>(req).body);
  ApiResponse.created(created, "Case created").send(res);
});

/** GET /cases/:caseId  -> case + linked cases + counts */
caseRouter.get("/cases/:caseId", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, CaseParams>(req).params;
  ApiResponse.ok(await getCaseOverview(caseId)).send(res);
});

/** PATCH /cases/:caseId  -> title, stage, status, description */
caseRouter.patch("/cases/:caseId", validate({ params: caseIdParams, body: updateCaseBody }), async (req, res) => {
  const r = ApiRequest.from<UpdateCaseInput, unknown, CaseParams>(req);
  ApiResponse.ok(await updateCase(r.params.caseId, r.body), "Case updated").send(res);
});

/** POST /cases/:caseId/links  { linkedCaseId, reason? } */
caseRouter.post("/cases/:caseId/links", validate({ params: caseIdParams, body: linkCaseBody }), async (req, res) => {
  const r = ApiRequest.from<{ linkedCaseId: string; reason?: string }, unknown, CaseParams>(req);
  if (!(await ownsResource(req.user!.firmId, "caseId", r.body.linkedCaseId))) throw ApiError.notFound("Linked case not found");
  ApiResponse.ok(await linkCases(r.params.caseId, r.body.linkedCaseId, r.body.reason), "Cases linked").send(res);
});

/** POST /cases/:caseId/people  { kind: party|lawyer|judge|witness, ... } */
caseRouter.post("/cases/:caseId/people", validate({ params: caseIdParams, body: addPersonBody }), async (req, res) => {
  const r = ApiRequest.from<AddPersonInput, unknown, CaseParams>(req);
  const { person, created } = await addPerson(r.params.caseId, r.body);
  (created ? ApiResponse.created(person, "Person added") : ApiResponse.ok(person, "Person already exists")).send(res);
});

/** GET /cases/:caseId/people */
caseRouter.get("/cases/:caseId/people", validate({ params: caseIdParams }), async (req, res) => {
  const { caseId } = ApiRequest.from<unknown, unknown, CaseParams>(req).params;
  ApiResponse.ok(await listPeople(caseId)).send(res);
});
