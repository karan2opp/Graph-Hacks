import { FalkorDB, type Graph } from "falkordb";
import { env } from "../../config/env.js";
import { ApiError } from "../utils/index.js";

let db: FalkorDB | null = null;
let graph: Graph | null = null;

export async function connectFalkorDB(): Promise<Graph> {
  if (graph) return graph;

  db = await FalkorDB.connect({
    socket: { host: env.FALKORDB_HOST, port: env.FALKORDB_PORT },
    username: env.FALKORDB_USERNAME,
    password: env.FALKORDB_PASSWORD,
  });
  graph = db.selectGraph(env.FALKORDB_GRAPH);
  console.log(`FalkorDB connected (${env.FALKORDB_HOST}:${env.FALKORDB_PORT}, graph "${env.FALKORDB_GRAPH}")`);
  return graph;
}

/** The shared case-memory graph. Call `connectFalkorDB()` once at startup first. */
export function getGraph(): Graph {
  if (!graph) throw ApiError.serviceUnavailable("FalkorDB is not connected");
  return graph;
}

export async function disconnectFalkorDB(): Promise<void> {
  await db?.close();
  db = null;
  graph = null;
}
