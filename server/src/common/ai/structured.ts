import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "../../config/env.js";
import { getOpenAI } from "./openai.js";

/**
 * Asks the chat model for output that matches a zod schema (OpenAI structured outputs, strict).
 * Optional fields in the schema must be `.nullable()`, not `.optional()`.
 */
export async function generateStructured<S extends z.ZodType>(
  schema: S,
  name: string,
  system: string,
  user: string,
): Promise<z.infer<S>> {
  const res = await getOpenAI().chat.completions.parse({
    model: env.OPENAI_CHAT_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: zodResponseFormat(schema, name),
  });
  const message = res.choices[0]?.message;
  if (message?.refusal) throw new Error(`Model refused: ${message.refusal}`);
  if (!message?.parsed) throw new Error(`No structured output (finish reason: ${res.choices[0]?.finish_reason})`);
  return message.parsed as z.infer<S>;
}
