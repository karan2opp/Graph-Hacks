import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ApiError, type ApiErrorDetail } from "../utils/ApiError.js";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Validates body/query/params with zod and exposes the parsed values on `req.validated`. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    const errors: ApiErrorDetail[] = [];
    const validated: NonNullable<typeof req.validated> = {};

    for (const key of ["body", "query", "params"] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (result.success) {
        validated[key] = result.data;
      } else {
        for (const issue of result.error.issues) {
          errors.push({ field: [key, ...issue.path].join("."), message: issue.message });
        }
      }
    }

    if (errors.length) return next(ApiError.validation(errors));
    req.validated = validated;
    next();
  };
