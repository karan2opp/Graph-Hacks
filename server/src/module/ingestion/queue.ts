/**
 * Minimal in-process job queue for background pipeline steps (embedding, extraction).
 * Jobs with the same key are not queued twice. State lives on the graph nodes
 * (`status`), so unfinished work is re-queued on boot (see recovery.ts).
 */
const CONCURRENCY = 2;

interface Job {
  key: string;
  run: () => Promise<void>;
}

const pending: Job[] = [];
const keys = new Set<string>();
let active = 0;

export function enqueue(key: string, run: () => Promise<void>): void {
  if (keys.has(key)) return;
  keys.add(key);
  pending.push({ key, run });
  pump();
}

function pump() {
  while (active < CONCURRENCY && pending.length) {
    const job = pending.shift()!;
    active++;
    job
      .run()
      .catch((e: unknown) => console.error(`[job] ${job.key} failed:`, (e as Error).message))
      .finally(() => {
        active--;
        keys.delete(job.key);
        pump();
      });
  }
}

export const queueStats = () => ({ active, pending: pending.length });
