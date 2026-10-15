import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { isProd } from "../../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let error: ApiError;

  if (err instanceof ApiError) {
    error = err;
  } else if (err instanceof multer.MulterError) {
    error = ApiError.badRequest(err.message);
  } else if (err?.type === "entity.parse.failed") {
    error = ApiError.badRequest("Malformed JSON body");
  } else {
    error = ApiError.internal(isProd ? "Internal server error" : (err?.message ?? "Unknown error"), err);
  }

  if (error.statusCode >= 500) console.error(error.message, error.cause ?? err);

  ApiResponse.error(error.statusCode, error.message, error.errors, error.code).send(res);
};
