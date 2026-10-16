import { z } from "zod";
import { idParam } from "../../common/utils/index.js";
import { hearingIdParams } from "../hearing/index.js";

export { hearingIdParams };

export const transcriptIdParams = z.object({ transcriptId: idParam });

/** label -> personId, e.g. { "Defendant's Counsel": "<lawyer id>" } */
const speakerMap = z.record(z.string().trim().min(1), idParam);

export const createTranscriptBody = z.object({
  text: z.string().min(1),
  speakerMap: speakerMap.optional(),
});
export type CreateTranscriptInput = z.infer<typeof createTranscriptBody>;

export const updateSpeakersBody = z.object({ speakerMap });

export const segmentsQuery = z.object({
  from: z.coerce.number().int().min(1).optional(),
  to: z.coerce.number().int().min(1).optional(),
  version: z.coerce.number().int().min(1).optional(),
});
export type SegmentsQuery = z.infer<typeof segmentsQuery>;
