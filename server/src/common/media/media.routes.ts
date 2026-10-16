import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/index.js";
import { ApiError, ApiRequest, ApiResponse } from "../utils/index.js";
import { deleteMedia, getClientUploadAuth, uploadMedia } from "./imagekit.js";
import { uploadSingle } from "./upload.js";

export const mediaRouter = Router();

/** POST /api/v1/media/upload  (multipart, field "file") */
mediaRouter.post("/upload", uploadSingle(), async (req, res) => {
  const { file } = ApiRequest.from(req);
  if (!file) throw ApiError.badRequest("Attach a file in the 'file' field");
  const media = await uploadMedia(file);
  ApiResponse.created(media, "File uploaded").send(res);
});

/** GET /api/v1/media/auth  -> signature for direct browser-to-ImageKit uploads */
mediaRouter.get("/auth", (_req, res) => {
  ApiResponse.ok(getClientUploadAuth(), "ImageKit upload credentials").send(res);
});

/** DELETE /api/v1/media/:fileId */
mediaRouter.delete(
  "/:fileId",
  validate({ params: z.object({ fileId: z.string().min(1) }) }),
  async (req, res) => {
    await deleteMedia(ApiRequest.from<unknown, unknown, { fileId: string }>(req).params.fileId);
    ApiResponse.ok(null, "File deleted").send(res);
  },
);
