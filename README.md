# Court Case Memory Agent

An agent that gives a court case a memory. Every hearing, order, document, witness statement and deadline is recorded in a **FalkorDB** graph. The agent answers questions with sources, flags ignored court directions, and catches contradictions between what a party said at different times.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs x FalkorDB), Track 2: Agent Memory and Coordination. The full design is in [plan.md](plan.md).

> A case organizer and memory aid, not legal advice. The demo uses synthetic data only.

## Stack

| Layer | Choice |
|---|---|
| Graph + vector DB | FalkorDB (Docker) |
| Server | Node.js, Express 5, TypeScript, zod |
| Client | React 19, Vite, TypeScript |
| Media (images, videos, PDFs) | ImageKit. The graph stores only the file URL |
| LLM + embeddings | OpenAI |

## Repo layout

```
.
├── client/                  React + TypeScript (Vite)
│   └── src/{components,pages,hooks,lib,types}
├── server/                  Express + TypeScript
│   └── src/
│       ├── common/          shared building blocks
│       │   ├── utils/       ApiError, ApiResponse, ApiRequest
│       │   ├── middleware/  requestId, validate (zod), error handler
│       │   ├── db/          FalkorDB connection (connect, getGraph, disconnect)
│       │   └── media/       ImageKit client + /media routes (upload, delete, auth)
│       ├── module/          feature modules
│       │   ├── graph/       graph schema, labels, indexes (queries go here)
│       │   └── health/      GET /api/v1/health
│       ├── config/env.ts    validated environment variables
│       ├── app.ts           Express app
│       └── index.ts         bootstrap (DB connect, listen, shutdown)
├── docker-compose.yml       FalkorDB + browser UI
└── plan.md
```

## Getting started

Requirements: Node 20+, Docker Desktop.

```bash
# 1. install
npm run install:all

# 2. env
cp server/.env.example server/.env      # add ImageKit + OpenAI keys
cp client/.env.example client/.env      # optional in dev

# 3. start FalkorDB (Redis protocol on :6379, browser UI on http://localhost:3000)
npm run db:up

# 4. run (two terminals)
npm run dev:server    # http://localhost:5000/api/v1
npm run dev:client    # http://localhost:5173
```

Check it works: `curl http://localhost:5000/api/v1/health` should report `falkordb: up`.

## API conventions

Every response, success or error, has the same shape (see `ApiResponse` in `server/src/common/utils`):

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": {},
  "errors": [],
  "code": "VALIDATION_ERROR",
  "meta": { "requestId": "…", "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } },
  "timestamp": "2026-10-16T00:00:00.000Z"
}
```

- **Throw** `ApiError.notFound()`, `ApiError.validation([...])` and friends from any handler. Express 5 forwards async errors to the global error handler.
- **Respond** with `ApiResponse.ok(data).send(res)`, `.created()` or `.paginated()`.
- **Read requests** with `ApiRequest.from(req)` (`body`, `query`, `params`, `file`, `pagination`).
- **Validate** with `validate({ body, query, params })` and a zod schema.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | API, FalkorDB, ImageKit and OpenAI status |
| POST | `/api/v1/media/upload` | Multipart `file` field (image, video, PDF) to ImageKit |
| GET | `/api/v1/media/auth` | Signed params for direct browser uploads |
| DELETE | `/api/v1/media/:fileId` | Remove a file from ImageKit |

## FalkorDB

- The connection lives in `server/src/common/db/`; use `getGraph()` anywhere to run queries.
- Graph name comes from `FALKORDB_GRAPH` (default `court_memory`).
- On boot the server creates range indexes on `id` for every node label and a **vector index** on `Claim.embedding` (cosine, 1536 dims for `text-embedding-3-small`). It is safe to run repeatedly.
- Labels and edge types are listed in `server/src/module/graph/graph.schema.ts` and match section 3 of the plan.
- Open `http://localhost:3000` for the FalkorDB Browser to inspect the graph while developing.

## Scripts

| Command | What it does |
|---|---|
| `npm run db:up` / `db:down` / `db:logs` | Manage the FalkorDB container |
| `npm run dev:server` / `dev:client` | Dev servers with reload |
| `npm run build` | Build server and client |
| `npm run typecheck` | Typecheck server and client |
