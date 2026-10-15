import "dotenv/config";
import { z } from "zod";

// Empty strings in .env mean "not set", so the defaults below apply.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const str = (def: string) => z.preprocess(emptyToUndefined, z.string().default(def));
const optStr = z.preprocess(emptyToUndefined, z.string().optional());
const num = (def: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(def));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: num(5000),
  CLIENT_URL: str("http://localhost:5173"),

  FALKORDB_HOST: str("localhost"),
  FALKORDB_PORT: num(6379),
  FALKORDB_USERNAME: optStr,
  FALKORDB_PASSWORD: optStr,
  FALKORDB_GRAPH: str("court_memory"),

  IMAGEKIT_PUBLIC_KEY: optStr,
  IMAGEKIT_PRIVATE_KEY: optStr,
  IMAGEKIT_URL_ENDPOINT: optStr,
  IMAGEKIT_FOLDER: str("/court-memory"),

  OPENAI_API_KEY: optStr,
  OPENAI_CHAT_MODEL: str("gpt-4o-mini"),
  OPENAI_EMBEDDING_MODEL: str("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: num(1536),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
