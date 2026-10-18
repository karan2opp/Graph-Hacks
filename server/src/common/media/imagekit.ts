import ImageKit, { toFile } from "@imagekit/nodejs";
import { env } from "../../config/env.js";
import { ApiError } from "../utils/index.js";

export interface UploadedMedia {
  fileId: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
  filePath: string;
  fileType: string;
  size: number;
}

let client: ImageKit | null = null;

export const isImageKitEnabled = () => Boolean(env.IMAGEKIT_PRIVATE_KEY);

function getClient(): ImageKit {
  if (!env.IMAGEKIT_PRIVATE_KEY) {
    throw ApiError.serviceUnavailable("ImageKit is not configured (set IMAGEKIT_PRIVATE_KEY)");
  }
  client ??= new ImageKit({ privateKey: env.IMAGEKIT_PRIVATE_KEY });
  return client;
}

/**
 * Uploads a file to ImageKit. Only the returned `url` is stored on the graph
 * node (`file_url`), never the file itself.
 */
export async function uploadMedia(
  file: { buffer: Buffer; originalname: string; mimetype: string },
  options: { folder?: string; tags?: string[] } = {},
): Promise<UploadedMedia> {
  const res = await getClient().files.upload({
    file: await toFile(file.buffer, file.originalname, { type: file.mimetype }),
    fileName: file.originalname,
    folder: options.folder ?? env.IMAGEKIT_FOLDER,
    tags: options.tags,
    useUniqueFileName: true,
  });

  return {
    fileId: res.fileId ?? "",
    name: res.name ?? file.originalname,
    url: res.url ?? "",
    thumbnailUrl: res.thumbnailUrl,
    filePath: res.filePath ?? "",
    fileType: res.fileType ?? file.mimetype,
    size: res.size ?? file.buffer.length,
  };
}
