import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { env } from "../../config/env.js";
import { getOpenAI } from "./openai.js";

export interface StructuredOptions {
  /** Defaults to OPENAI_CHAT_MODEL. */
  model?: string;
  /** For reasoning models (gpt-5*, o*): how hard to think. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

/** Reasoning models reject `temperature` and take `reasoning_effort` instead. */
const isReasoningModel = (model: string) => /^(gpt-5|o\d)/.test(model);

/**
 * Asks a model for output that matches a zod schema (OpenAI structured outputs, strict).
 * Optional fields in the schema must be `.nullable()`, not `.optional()`.
 */
export async function generateStructured<S extends z.ZodType>(
  schema: S,
  name: string,
  system: string,
  user: string,
  options: StructuredOptions = {},
): Promise<z.infer<S>> {
  const model = options.model ?? env.OPENAI_CHAT_MODEL;
  const res = await getOpenAI().chat.completions.parse({
    model,
    ...(isReasoningModel(model) ? { reasoning_effort: options.reasoningEffort ?? "low" } : { temperature: 0 }),
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
