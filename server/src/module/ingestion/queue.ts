/**
 * Minimal in-process job queue for background pipeline steps. Jobs run in lanes:
 * - "embed": 2 at a time (independent API calls)
 * - "analyze": 1 at a time, so each document sees the subjects and people the previous
 *   analysis created, and the same payment or property is not recorded twice.
 * Jobs with the same key are not queued twice. Progress lives on the graph nodes, so
 * unfinished work is re-queued on boot.
 */
export type Lane = "embed" | "analyze";

const CONCURRENCY: Record<Lane, number> = { embed: 2, analyze: 1 };

interface Job {
  key: string;
  run: () => Promise<void>;
}

const lanes: Record<Lane, { pending: Job[]; active: number }> = {
  embed: { pending: [], active: 0 },
  analyze: { pending: [], active: 0 },
};
const keys = new Set<string>();

export function enqueue(key: string, run: () => Promise<void>, lane: Lane = "embed"): void {
  if (keys.has(key)) return;
  keys.add(key);
  lanes[lane].pending.push({ key, run });
  pump(lane);
}

function pump(lane: Lane) {
  const l = lanes[lane];
  while (l.active < CONCURRENCY[lane] && l.pending.length) {
    const job = l.pending.shift()!;
    l.active++;
    job
      .run()
      .catch((e: unknown) => console.error(`[job] ${job.key} failed:`, (e as Error).message))
      .finally(() => {
        l.active--;
        keys.delete(job.key);
        pump(lane);
      });
  }
}

export const queueStats = () =>
  Object.fromEntries(Object.entries(lanes).map(([k, l]) => [k, { active: l.active, pending: l.pending.length }]));

/** Resolves once every lane is empty (used by the demo seed before it fills in agent results). */
export async function whenIdle(): Promise<void> {
  while (Object.values(lanes).some((l) => l.active || l.pending.length)) {
    await new Promise((r) => setTimeout(r, 50));
  }
}
