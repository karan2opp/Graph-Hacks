import { z } from "zod";
import { idParam, isoDate } from "../../common/utils/index.js";

export const CASE_TYPES = ["civil", "criminal"] as const;
export const CASE_STATUSES = ["open", "disposed"] as const;
export const PARTY_ROLES = [
  "plaintiff",
  "defendant",
  "petitioner",
  "respondent",
  "appellant",
  "complainant",
  "accused",
  "prosecution",
] as const;
export const WITNESS_TYPES = ["eye", "police", "expert", "official", "other"] as const;

export const caseIdParams = z.object({ caseId: idParam });

export const createCaseBody = z.object({
  caseNumber: z.string().trim().min(1),
  title: z.string().trim().min(1),
  court: z.string().trim().min(1),
  caseType: z.enum(CASE_TYPES),
  stage: z.string().trim().min(1).default("filing"),
  filedOn: isoDate.optional(),
  description: z.string().trim().optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseBody>;

export const updateCaseBody = z
  .object({
    title: z.string().trim().min(1),
    stage: z.string().trim().min(1),
    status: z.enum(CASE_STATUSES),
    description: z.string().trim(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateCaseInput = z.infer<typeof updateCaseBody>;

export const linkCaseBody = z.object({
  linkedCaseId: idParam,
  reason: z.string().trim().optional(),
});

const name = z.string().trim().min(1);

export const addPersonBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("party"), name, role: z.enum(PARTY_ROLES) }),
  z.object({
    kind: z.literal("lawyer"),
    name,
    enrolmentNo: z.string().trim().optional(),
    representsId: idParam,
    from: isoDate.optional(),
  }),
  z.object({ kind: z.literal("judge"), name }),
  z.object({
    kind: z.literal("witness"),
    name,
    code: z.string().trim().toUpperCase().optional(), // PW1, DW2
    witnessType: z.enum(WITNESS_TYPES).default("other"),
    calledById: idParam.optional(),
  }),
]);
export type AddPersonInput = z.infer<typeof addPersonBody>;
