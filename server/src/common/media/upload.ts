import multer from "multer";
import { ApiError } from "../utils/index.js";

/** Images, videos, PDFs and plain-text files. */
const ALLOWED = /^(image|video)\/|^application\/pdf$|^text\/plain$/;

/**
 * Multipart middleware for one file in memory (max 100 MB). Requests that are not
 * multipart pass straight through, so the same route can also accept JSON.
 */
export const uploadSingle = (field = "file") =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, cb) =>
      ALLOWED.test(file.mimetype)
        ? cb(null, true)
        : cb(ApiError.badRequest("Only images, videos, PDFs and text files are allowed")),
  }).single(field);
