import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectFalkorDB, disconnectFalkorDB } from "./common/db/index.js";
import { initGraphSchema } from "./module/graph/index.js";
import { resumePendingJobs } from "./module/ingestion/index.js";

async function main() {
  try {
    await connectFalkorDB();
    await initGraphSchema();
    await resumePendingJobs();
  } catch (e) {
    // Keep the API up so /health reports the problem instead of crash-looping.
    console.error("FalkorDB unavailable. Is `docker compose up -d` running?", (e as Error).message);
  }

  const server = createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}/api/v1`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await disconnectFalkorDB().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
