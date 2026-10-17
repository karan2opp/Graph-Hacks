import OpenAI from "openai";
import { env } from "../../config/env.js";
import { ApiError } from "../utils/index.js";

let client: OpenAI | null = null;

export const isAIEnabled = () => Boolean(env.OPENAI_API_KEY);

export function getOpenAI(): OpenAI {
  if (!env.OPENAI_API_KEY) throw ApiError.serviceUnavailable("OpenAI is not configured (set OPENAI_API_KEY)");
  // Analysis runs one job at a time for every firm, so a hung call must not hold the lane for long.
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
  return client;
}

const EMBED_BATCH = 64;

/** Embeds texts in batches, preserving order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await getOpenAI().embeddings.create({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: batch,
      dimensions: env.EMBEDDING_DIMENSIONS,
    });
    out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

/** Reads all text from an image (scanned page, photo of an order sheet) with the vision model. */
export async function ocrImage(buffer: Buffer, mimeType: string): Promise<string> {
  const res = await getOpenAI().chat.completions.create({
    model: env.OPENAI_CHAT_MODEL,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Transcribe all text in this court document image exactly as written. Keep paragraph breaks " +
              "(blank line between paragraphs) and paragraph numbers. Output only the text, no commentary.",
          },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
        ],
      },
    ],
  });
  return res.choices[0]?.message.content?.trim() ?? "";
}
