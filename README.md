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
│       │   ├── db/          FalkorDB connection + runQuery / queryOne helpers
│       │   ├── ai/          OpenAI client: embeddings, image OCR
│       │   └── media/       ImageKit client, upload middleware, /media routes
│       ├── module/          feature modules
│       │   ├── graph/       labels and indexes (range + vector)
│       │   ├── case/        cases, people (party, lawyer, judge, witness), case links
│       │   ├── hearing/     hearings, NEXT timeline, judge, appearances, adjournments
│       │   ├── document/    document upload / paste, chunks
│       │   ├── transcript/  transcript parser, speaker matching, versions
│       │   ├── ingestion/   text extraction, chunker, job queue, embedding jobs
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
| POST / GET | `/cases` | Create / list cases (with hearing and document counts) |
| GET / PATCH | `/cases/:caseId` | Case overview (linked cases, stats) / update stage, status |
| POST | `/cases/:caseId/links` | Link two cases (`{ linkedCaseId, reason }`) |
| POST / GET | `/cases/:caseId/people` | Add / list parties, lawyers, judges, witnesses |
| POST / GET | `/cases/:caseId/hearings` | Add a hearing / timeline in date order |
| GET / PATCH | `/hearings/:hearingId` | Hearing with judge, appearances, documents, transcript, previous / next |
| POST | `/cases/:caseId/documents` | Multipart `file` or JSON `text`, plus title, type, date, hearingId, filedById, orderKind |
| GET | `/cases/:caseId/documents` | List, filter by `type` and `hearingId` |
| GET | `/documents/:documentId`, `/documents/:documentId/chunks?page=` | Status and metadata / text chunks with page and para |
| POST | `/hearings/:hearingId/transcripts` | New transcript version (`{ text, speakerMap? }`) |
| GET | `/hearings/:hearingId/transcript?from=&to=&version=` | Numbered turns with resolved speakers |
| GET | `/hearings/:hearingId/transcripts` | All versions |
| PATCH | `/transcripts/:transcriptId/speakers` | Map a speaker label to a person (turn numbers never change) |
| GET | `/cases/:caseId/claims?personId=&subjectId=&sourceId=` | Claims with who said it, about what, and the exact source (page/para or hearing turn) |
| GET | `/cases/:caseId/subjects` | What the case is about (property, payments, documents) with claim counts |
| GET | `/cases/:caseId/directions?status=pending\|overdue\|complied` | Court directions with assignees, deadlines and source order |
| POST | `/documents/:documentId/analyze`, `/transcripts/:transcriptId/analyze` | Re-run the intake agent (replaces earlier results) |
| GET | `/cases/:caseId/contradictions?category=self\|same_side\|record` | Conflicting statements with both citations and the reason |
| GET | `/cases/:caseId/disputes` | Points where the two sides disagree |
| GET | `/claims/:claimId/related` | Everything that contradicts, disputes or supports one claim |
| POST | `/cases/:caseId/factcheck` | Re-check every claim of the case from scratch |

Paths shown without a prefix are under `/api/v1` as well.

### Ingestion pipeline

1. **Store:** the file goes to ImageKit. The same content uploaded twice to a case returns the existing document.
2. **Read:** PDFs are read page by page, images through OpenAI vision OCR, pasted text as is (a form feed starts a new page). Scanned PDFs and videos are stored without text.
3. **Chunk:** paragraph-sized chunks keep `page`, `para` and the document's own paragraph number (`paraLabel`).
4. **Embed:** a background job embeds chunks and transcript turns. Status moves from `extracted` to `embedding` to `ready`. Without `OPENAI_API_KEY` it waits, and resumes on the next boot.
5. **Analyse (intake agent):** the LLM reads each source with the case's people and existing subjects as context (short refs like `P1`, `S1`, so answers map back to graph nodes):
   - documents and transcript turns become `Claim` nodes, linked to who made them (`MADE_BY`, `ON_BEHALF_OF`), what they are about (`ABOUT` a `Subject`) and where they came from (`CONTAINS` from the chunk or turn). Quotes are checked against the source text.
   - orders become `Direction` nodes with assignees and computed due dates, and the next date of hearing is scheduled automatically.
   - analysis runs one source at a time, so a later document reuses the subjects an earlier one created. That is what lets a 2021 denial and a 2023 admission land on the same payment.
6. **Fact-check agent:** each new claim is compared with earlier claims found through the graph (same `Subject`, same person) and by meaning (vector search). The graph also decides whose side each claim is on (`MADE_BY` → `REPRESENTS` / `CALLED_BY` → party role), so the result is written as:
   - `CONTRADICTS` for the same person over time, the same side, or a document of record (sale deed, FIR, order),
   - `DISPUTES` for opposite sides disagreeing (the dispute itself, not a contradiction),
   - `SUPPORTS` for corroboration.

   Verdicts come from `OPENAI_REASONING_MODEL`, which must first answer "can both claims be true?"; the code rejects verdicts that disagree with that answer.

Transcripts are split into turns on `Speaker: text` lines and numbered 1, 2, 3, since Indian court transcripts rarely have timestamps. Labels like "Court", "Ld. Counsel for Defendant", "PW1" or "Plaintiff" are matched to people in the case. Unmatched labels are reported and can be fixed with `PATCH /transcripts/:id/speakers`.

## FalkorDB

- The connection lives in `server/src/common/db/`; use `getGraph()` anywhere to run queries.
- Graph name comes from `FALKORDB_GRAPH` (default `court_memory`).
- On boot the server creates range indexes on `id` (and common lookup fields) for every label, and **vector indexes** on `Chunk`, `Segment` and `Claim` `embedding` (cosine, 1536 dims for `text-embedding-3-small`). It is safe to run repeatedly. Vector search returns cosine *distance*: lower is closer.
- Labels are listed in `server/src/module/graph/graph.schema.ts`; the full model is section 4 of [plan.md](plan.md).
- Open `http://localhost:3000` for the FalkorDB Browser to inspect the graph while developing.

## Scripts

| Command | What it does |
|---|---|
| `npm run db:up` / `db:down` / `db:logs` | Manage the FalkorDB container |
| `npm run dev:server` / `dev:client` | Dev servers with reload |
| `npm run build` | Build server and client |
| `npm run typecheck` | Typecheck server and client |
