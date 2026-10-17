/**
 * API for end-to-end tests: a throwaway graph, freshly seeded, on its own port.
 *   E2E_PORT=5055 tsx src/scripts/e2e-server.ts
 */
process.env.FALKORDB_GRAPH = process.env.E2E_GRAPH || "court_memory_e2e";
process.env.OPENAI_API_KEY = "";
process.env.IMAGEKIT_PRIVATE_KEY = "";
process.env.IMAGEKIT_PUBLIC_KEY = "";

const { connectFalkorDB, getGraph } = await import("../common/db/index.js");
const { initGraphSchema } = await import("../module/graph/index.js");
const { createApp } = await import("../app.js");
const { seed } = await import("./seed.js");

await connectFalkorDB();
await getGraph()
  .delete()
  .catch(() => undefined);
await initGraphSchema();
await seed();

const port = Number(process.env.E2E_PORT || 5055);
createApp().listen(port, () => console.log(`e2e API ready on http://localhost:${port}/api/v1`));
