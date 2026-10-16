import { getGraph } from "./falkordb.js";

export type QueryParams = Record<string, unknown>;

// The client types params narrowly; it serialises nested maps/lists fine at runtime.
type ClientParams = Parameters<ReturnType<typeof getGraph>["query"]>[1];

/** Runs a write (or read) query and returns the rows. Always pass values as params, never by string concatenation. */
export async function runQuery<T = Record<string, unknown>>(cypher: string, params: QueryParams = {}): Promise<T[]> {
  const res = await getGraph().query<T>(cypher, { params } as ClientParams);
  return (res.data ?? []) as T[];
}

/** Read-only query (FalkorDB rejects writes inside it). */
export async function runReadQuery<T = Record<string, unknown>>(cypher: string, params: QueryParams = {}): Promise<T[]> {
  const res = await getGraph().roQuery<T>(cypher, { params } as ClientParams);
  return (res.data ?? []) as T[];
}

/** First row or null. */
export async function queryOne<T = Record<string, unknown>>(cypher: string, params: QueryParams = {}): Promise<T | null> {
  const rows = await runQuery<T>(cypher, params);
  return rows[0] ?? null;
}

export const nowIso = () => new Date().toISOString();
