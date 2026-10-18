// Must run before any app module reads the environment (they are imported dynamically below).
process.env.NODE_ENV = "test";
process.env.FALKORDB_GRAPH = "court_memory_test";
// Agents and file storage stay off in tests: empty means "not configured", and dotenv won't override it.
process.env.OPENAI_API_KEY = "";
process.env.DEMO_ON_SIGNUP = "false"; // tests start from an empty firm
process.env.IMAGEKIT_PRIVATE_KEY = "";
process.env.IMAGEKIT_PUBLIC_KEY = "";

import type { AddressInfo } from "node:net";

export interface TestServer {
  base: string;
  close: () => Promise<void>;
}

/** Fresh test graph + the real app on a random port. Test files run one at a time. */
export async function startServer(): Promise<TestServer> {
  const { connectFalkorDB, getGraph, disconnectFalkorDB } = await import("../src/common/db/index.js");
  const { initGraphSchema } = await import("../src/module/graph/index.js");
  const { createApp } = await import("../src/app.js");

  await connectFalkorDB();
  await getGraph()
    .delete()
    .catch(() => undefined); // first run: graph doesn't exist yet
  await initGraphSchema();

  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api/v1`,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await disconnectFalkorDB();
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: { success: boolean; message: string; data: T; errors?: { field?: string; message: string }[]; code?: string };
  headers: Headers;
}

/** A browser-like client: remembers the session cookie between calls. */
export function client(base: string) {
  let cookie = "";
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: res.status, body: (await res.json().catch(() => null)) as Res<T>["body"], headers: res.headers };
  };
  return {
    get: <T = any>(p: string) => call<T>("GET", p),
    post: <T = any>(p: string, b?: unknown) => call<T>("POST", p, b ?? {}),
    patch: <T = any>(p: string, b: unknown) => call<T>("PATCH", p, b),
    del: <T = any>(p: string) => call<T>("DELETE", p),
    get cookie() {
      return cookie;
    },
  };
}
export type Client = ReturnType<typeof client>;

let seq = 0;
/** Registers a brand-new firm and returns a signed-in client for its owner. */
export async function newFirm(base: string, firmName = `Firm ${++seq}`) {
  const c = client(base);
  const email = `owner${Date.now()}${++seq}@example.test`;
  const res = await c.post("/auth/register", { name: "Asha Owner", email, password: "correct-horse-42", firmName });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  return { c, email, user: res.body.data };
}

export const PASSWORD = "correct-horse-42";
