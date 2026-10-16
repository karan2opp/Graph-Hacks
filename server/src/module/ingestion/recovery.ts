import { isAIEnabled } from "../../common/ai/index.js";
import { runQuery } from "../../common/db/index.js";
import { queueDocumentEmbedding } from "./embed.jobs.js";

/** Re-queues work that was cut off by a restart, or that waited for an OpenAI key. */
export async function resumePendingJobs(): Promise<void> {
  if (!isAIEnabled()) return;
  const docs = await runQuery<{ id: string }>(
    "MATCH (d:Document) WHERE d.status IN ['extracted', 'embedding'] RETURN d.id AS id",
  );
  docs.forEach((d) => queueDocumentEmbedding(d.id));
  if (docs.length) console.log(`Resumed ${docs.length} pending document job(s)`);
}
