import { aiLimit, guardParams } from "../auth/index.js";
import { Router } from "express";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse } from "../../common/utils/index.js";
import {
  createTranscriptBody,
  hearingIdParams,
  segmentsQuery,
  transcriptIdParams,
  updateSpeakersBody,
  type CreateTranscriptInput,
  type SegmentsQuery,
} from "./transcript.schema.js";
import { createTranscript, getTranscript, listTranscriptVersions, updateSpeakers } from "./transcript.service.js";

export const transcriptRouter = Router();
guardParams(transcriptRouter);

/** POST /hearings/:hearingId/transcripts  { text, speakerMap? } -> new version */
transcriptRouter.post(
  "/hearings/:hearingId/transcripts",
  aiLimit,
  validate({ params: hearingIdParams, body: createTranscriptBody }),
  async (req, res) => {
    const r = ApiRequest.from<CreateTranscriptInput, unknown, { hearingId: string }>(req);
    const { transcript, created } = await createTranscript(r.params.hearingId, r.body);
    (created
      ? ApiResponse.created(transcript, "Transcript saved; embedding runs in the background")
      : ApiResponse.ok(transcript, "Same transcript already uploaded")
    ).send(res);
  },
);

/** GET /hearings/:hearingId/transcripts  -> all versions */
transcriptRouter.get("/hearings/:hearingId/transcripts", validate({ params: hearingIdParams }), async (req, res) => {
  const { hearingId } = ApiRequest.from<unknown, unknown, { hearingId: string }>(req).params;
  ApiResponse.ok(await listTranscriptVersions(hearingId)).send(res);
});

/** GET /hearings/:hearingId/transcript?from=&to=&version=  -> turns */
transcriptRouter.get(
  "/hearings/:hearingId/transcript",
  validate({ params: hearingIdParams, query: segmentsQuery }),
  async (req, res) => {
    const r = ApiRequest.from<unknown, SegmentsQuery, { hearingId: string }>(req);
    ApiResponse.ok(await getTranscript(r.params.hearingId, r.query)).send(res);
  },
);

/** PATCH /transcripts/:transcriptId/speakers  { speakerMap: { label: personId } } */
transcriptRouter.patch(
  "/transcripts/:transcriptId/speakers",
  validate({ params: transcriptIdParams, body: updateSpeakersBody }),
  async (req, res) => {
    const r = ApiRequest.from<{ speakerMap: Record<string, string> }, unknown, { transcriptId: string }>(req);
    ApiResponse.ok(await updateSpeakers(r.params.transcriptId, r.body.speakerMap), "Speakers updated").send(res);
  },
);
