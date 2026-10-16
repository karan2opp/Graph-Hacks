import { z } from "zod";
import { idParam, isoDate } from "../../common/utils/index.js";

export const HEARING_STATUSES = ["scheduled", "held"] as const;

export const hearingIdParams = z.object({ hearingId: idParam });

const appearance = z.object({
  personId: idParam,
  present: z.boolean().default(true),
});

const hearingFields = {
  date: isoDate,
  purpose: z.string().trim().min(1).optional(), // "for written statement", "PW1 cross-examination"
  status: z.enum(HEARING_STATUSES).optional(), // default: held if the date has passed, else scheduled
  courtRoom: z.string().trim().optional(),
  judgeId: idParam.optional(),
  adjourned: z.boolean().optional(),
  adjournmentReason: z.string().trim().optional(),
  adjournedAtRequestOfId: idParam.optional(), // party who sought the adjournment
  outcome: z.string().trim().optional(),
  appearances: z.array(appearance).optional(),
};

export const createHearingBody = z.object(hearingFields);
export type CreateHearingInput = z.infer<typeof createHearingBody>;

export const updateHearingBody = z
  .object(hearingFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateHearingInput = z.infer<typeof updateHearingBody>;
