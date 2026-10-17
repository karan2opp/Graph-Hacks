import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectFalkorDB, disconnectFalkorDB } from "./common/db/index.js";
import { initGraphSchema } from "./module/graph/index.js";
import { resumePendingJobs } from "./module/ingestion/index.js";
import { resumeIntakeJobs } from "./module/intake/index.js";

const RETRY_MS = 5_000;

/**
 * Keeps trying until FalkorDB answers (on Render the API often boots before the database).
 * Meanwhile the API stays up and /health reports the problem. Once connected, the client
 * reconnects on its own if the connection drops.
 */
async function connectWithRetry() {
  for (;;) {
    try {
      await connectFalkorDB();
      await initGraphSchema();
      await resumePendingJobs();
      await resumeIntakeJobs();
      return;
    } catch (e) {
      const err = e as Error & { code?: string };
      console.error(`FalkorDB unavailable (${err.message || err.code}), retrying in ${RETRY_MS / 1000}s`);
      await disconnectFalkorDB().catch(() => undefined);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

function main() {
  const server = createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}/api/v1`);
  });
  void connectWithRetry();

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await disconnectFalkorDB().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main();
