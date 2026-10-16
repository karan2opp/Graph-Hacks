import { isAIEnabled } from "../../common/ai/index.js";
import { runQuery } from "../../common/db/index.js";
import { queueDocumentEmbedding, queueTranscriptEmbedding } from "./embed.jobs.js";

/** Re-queues work that was cut off by a restart, or that waited for an OpenAI key. */
export async function resumePendingJobs(): Promise<void> {
  if (!isAIEnabled()) return;
  const pending = "WHERE n.status IN ['extracted', 'embedding'] RETURN n.id AS id";
  const docs = await runQuery<{ id: string }>(`MATCH (n:Document) ${pending}`);
  const transcripts = await runQuery<{ id: string }>(`MATCH (n:Transcript) ${pending}`);
  docs.forEach((d) => queueDocumentEmbedding(d.id));
  transcripts.forEach((t) => queueTranscriptEmbedding(t.id));
  const total = docs.length + transcripts.length;
  if (total) console.log(`Resumed ${total} pending embedding job(s)`);
}
