import { z } from "zod";
import { idParam, isoDate } from "../../common/utils/index.js";

export const DOCUMENT_TYPES = [
  "plaint",
  "written_statement",
  "replication",
  "application",
  "reply",
  "affidavit",
  "order",
  "judgment",
  "fir",
  "chargesheet",
  "police_statement",
  "deposition",
  "evidence",
  "sale_deed",
  "agreement",
  "notice",
  "note", // lawyer's own notes, private by default
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ORDER_KINDS = ["interim", "procedural", "final"] as const;

export const DOCUMENT_STATUSES = ["extracted", "embedding", "ready", "stored", "failed"] as const;

export const documentIdParams = z.object({ documentId: idParam });

// Multipart forms send every field as a string; "" means not provided.
const blank = (v: unknown) => (v === "" ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(blank, s.optional());

export const createDocumentBody = z
  .object({
    title: z.string().trim().min(1),
    type: z.enum(DOCUMENT_TYPES),
    date: opt(isoDate),
    hearingId: opt(idParam), // submitted at this hearing
    filedById: opt(idParam), // party who filed it
    orderKind: opt(z.enum(ORDER_KINDS)),
    private: opt(z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")])),
    text: opt(z.string().min(1)), // pasted text instead of a file
  })
  .refine((v) => v.type !== "order" || v.hearingId, {
    message: "An order must be linked to its hearing",
    path: ["hearingId"],
  });
export type CreateDocumentInput = z.infer<typeof createDocumentBody>;

export const listDocumentsQuery = z.object({
  type: opt(z.enum(DOCUMENT_TYPES)),
  hearingId: opt(idParam),
});

export const chunksQuery = z.object({
  page: opt(z.coerce.number().int().min(1)),
});
