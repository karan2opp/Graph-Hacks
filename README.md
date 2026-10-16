# Court Case Memory Agent

Court cases run for years across dozens of hearings. Directions get forgotten, lawyers change, and a party's story quietly changes between filings. This project gives a case a **memory**: every hearing, order, filing and transcript goes into a **FalkorDB** graph, and a set of agents read and write that graph to answer questions with exact sources, track what the court directed, and catch contradictions.

Built for **Graph Hacks: Context for AI Agents** (WeMakeDevs x FalkorDB), **Track 2: Agent Memory and Coordination**. Design notes and decisions are in [plan.md](plan.md).

> A case organizer and memory aid for lawyers, not legal advice. The demo uses synthetic data only.

## What it does

| Agent | Reads from the graph | Writes to the graph |
|---|---|---|
| **Intake** | The new document or transcript, the case's people and existing subjects | `Claim`s (who said what, exact quote, page/para or hearing turn), `Subject`s, `Direction`s from orders, the next hearing an order fixes |
| **Fact-check** | Earlier claims on the same subject or by the same person, and whose side each claim is on | `CONTRADICTS`, `DISPUTES`, `SUPPORTS` edges with a reason |
| **Compliance** | Pending directions, who they bind, new filings and later orders | `COMPLIED_BY {onTime, daysLate}`, `NONCOMPLIANCE_RECORDED_IN`, `VACATED_BY` |
| **Case Q&A** | Everything above, through 12 fixed graph tools | Conversations and messages linked (`CITES`) to the evidence each answer used |

The graph is the agents' shared memory and how they hand work to each other: intake writes claims and directions, fact-check and compliance build on them, and Q&A answers from all of it.

```
 upload ─► [Intake] ──claims, directions──► FalkorDB ◄──CONTRADICTS / DISPUTES / SUPPORTS── [Fact-check]
                                              ▲   ▲
                         [Compliance] ────────┘   └──── [Case Q&A] ──► answer + [S#] citations + evidence graph
                     COMPLIED_BY / VACATED_BY             (conversations stored back in the graph)
```

### Example

> **Q: Has Suresh Gupta contradicted himself anywhere?**
> Yes, on whether he received Rs. 5,00,000 from Ramesh Kumar.
> - In the written statement dated 18 May 2021, he denied receiving any payment of Rs. 5,00,000. **[Written Statement, p1 para 1]**
> - In his affidavit dated 6 Feb 2023, he said he received it in March 2019 as a friendly loan. **[Affidavit of DW1, p1 para 1]**
> - In the same affidavit he says he repaid Rs. 2,00,000 of "the said loan", which assumes receipt. **[Affidavit of DW1, p1 para 2]**

Every reference resolves to a real node in the graph, and the response includes the tools the agent used and the evidence subgraph behind the answer.

## Stack

| Layer | Choice |
|---|---|
| Graph + vector DB | FalkorDB (Docker) |
| Server | Node.js, Express 5, TypeScript, zod |
| Client | React 19, Vite, TypeScript |
| Files (PDFs, images, video) | ImageKit. The graph stores only the URL |
| Extraction, OCR | OpenAI `gpt-4o-mini` |
| Verdicts, Q&A | OpenAI `gpt-5.4-mini` |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) |
| PDF text | `unpdf` |

## Getting started

Requirements: Node 20+, Docker Desktop, an OpenAI API key. ImageKit is optional in development (without it, text is kept but original files are not stored).

```bash
npm run install:all

cp server/.env.example server/.env      # add OPENAI_API_KEY (and ImageKit keys)
cp client/.env.example client/.env      # optional in dev

npm run db:up                           # FalkorDB on :6379, FalkorDB Browser on http://localhost:3000

npm run dev:server                      # http://localhost:5000/api/v1
npm run dev:client                      # http://localhost:5173
```

`curl http://localhost:5000/api/v1/health` should report `falkordb: up`, `openai: configured`.

### Environment (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `CLIENT_URL` | `5000`, `http://localhost:5173` | API port, allowed CORS origin(s) |
| `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKORDB_GRAPH` | `localhost`, `6379`, `court_memory` | FalkorDB connection and graph name |
| `FALKORDB_USERNAME`, `FALKORDB_PASSWORD` | empty | For a hosted FalkorDB |
| `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_FOLDER` | empty, `/court-memory` | File storage |
| `OPENAI_API_KEY` | empty | Required for embeddings and agents. Jobs wait and resume once it is set |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Extraction and OCR |
| `OPENAI_REASONING_MODEL` | `gpt-5.4-mini` | Fact-check and compliance verdicts, Q&A |
| `OPENAI_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | `text-embedding-3-small`, `1536` | Vectors on Chunk, Segment, Claim |

## Repo layout

```
.
├── client/                    React + TypeScript (Vite)
├── server/src/
│   ├── common/                shared building blocks
│   │   ├── utils/             ApiError, ApiResponse, ApiRequest, validators (nameKey, todayIST)
│   │   ├── middleware/        requestId, validate (zod), error handler
│   │   ├── db/                FalkorDB connection, runQuery / queryOne
│   │   ├── ai/                OpenAI: embeddings, OCR, structured output
│   │   ├── media/             ImageKit client, upload middleware, /media routes
│   │   └── types/             Express request typing
│   ├── module/
│   │   ├── graph/             labels and indexes (range + vector)
│   │   ├── case/              cases, people (party, lawyer, judge, witness), case links
│   │   ├── hearing/           hearings, NEXT timeline, appearances, adjournments
│   │   ├── document/          upload / paste, chunks
│   │   ├── transcript/        parser, speaker matching, versions
│   │   ├── ingestion/         text extraction, chunker, job queue, embedding jobs
│   │   ├── intake/            intake agent: claims, subjects, directions
│   │   ├── factcheck/         fact-check agent: contradictions, disputes, support
│   │   ├── compliance/        compliance agent: directions state, overrides, report
│   │   ├── qa/                Q&A agent: tools, citations, evidence graph, conversation memory
│   │   └── health/            GET /health
│   ├── config/env.ts          validated environment
│   ├── routes.ts, app.ts, index.ts
├── docker-compose.yml         FalkorDB + browser UI
└── plan.md                    design, graph model, decisions
```

## How it works

### Ingestion
1. **Store:** the file goes to ImageKit. The same content uploaded twice to a case returns the existing document.
2. **Read:** PDFs page by page, images through OpenAI vision OCR, pasted text as is (a form feed starts a new page). Scanned PDFs and videos are stored without text; unreadable files are kept with a note.
3. **Chunk:** each numbered paragraph is its own chunk with `page`, `para` and the document's own paragraph number (`paraLabel`), so citations read "Written Statement, p1 para 3".
4. **Embed:** a background job embeds chunks and transcript turns (`status`: `extracted` → `embedding` → `ready`).
5. **Analyse:** the agents below run in the background (`analysis`: `pending` → `running` → `done`), one source at a time so each one sees what the previous created. Unfinished jobs resume on restart.

Documents carry two dates: `date` (of the document itself) and `filedOn` (when it was filed in court; defaults to the hearing date).

### Transcripts
Indian court transcripts rarely carry timestamps, so the parser splits on `Speaker: text` lines and numbers the turns 1, 2, 3. Labels are matched to people in the case: "Court" → presiding judge, "Ld. Counsel for Defendant" → the defendant's lawyer, "PW1" → the witness with that code, "Plaintiff" → the party. Unmatched labels are reported and can be mapped with `PATCH /transcripts/:id/speakers`. Turn numbers never change; a correction is a new version, and claims from the old version are marked superseded.

### Intake agent
The model reads each source with the case's people and existing subjects as context, using short refs (`P1`, `S1`, `C3`, `T12`) so every answer maps back to a graph node.
- Documents and transcript turns → `Claim` nodes: `MADE_BY` / `ON_BEHALF_OF` a person, `ABOUT` a `Subject`, `CONTAINS`-ed by the exact chunk or turn. Quotes are verified against the source text. Pleadings are always attributed to the party who filed them.
- Orders → `Direction` nodes with assignees, kind (direction, costs, notice, stay, undertaking) and due dates computed from the order date ("within one week" of 10.03.2021 → 2021-03-17). The next date the order fixes is added to the timeline. Obligations an order merely continues, or lifts, are not new directions.

### Fact-check agent
Each new claim is compared with earlier claims found through the graph (same `Subject`, same person) and by meaning (vector search). The graph decides whose side each claim is on (`MADE_BY` → `REPRESENTS` / `CALLED_BY` → party role), and the result is written as:
- `CONTRADICTS {category: self | same_side | record}`: the same person over time, the same side, or against a document of record (sale deed, FIR, order),
- `DISPUTES`: the two sides disagreeing (the dispute itself, not a contradiction),
- `SUPPORTS`: corroboration.

The verdict model must first answer "can both claims be true?"; verdicts that disagree with that answer are dropped.

### Compliance agent
Links each `Direction` to the evidence that it was followed. Only filed documents and later orders count as evidence, never transcripts.
- A new filing is matched against pending directions that bind the party who filed it: `(Direction)-[:TO]->(Party)<-[:FILED_BY]-(Document)` → `COMPLIED_BY {onTime, daysLate}` using `filedOn`.
- A new order is read for what it records about earlier directions (`COMPLIED_BY` with the order as evidence, `NONCOMPLIANCE_RECORDED_IN`, `VACATED_BY`), and its own directions are back-filled against documents already on file.
- State is computed on read: lawyer override, then vacated, complied, in force (status quo, undertakings), overdue, pending. A lawyer's override (`PATCH /directions/:id`) is never changed by the agent and survives re-analysis.

### Case Q&A agent
A tool-calling loop where the model never writes Cypher. It chooses among `search_case` (vector search over claims, document passages and transcript turns), `get_timeline`, `get_hearing`, `get_people`, `get_claims`, `get_contradictions`, `get_disputes`, `get_directions`, `get_compliance`, `read_transcript`, `read_document` and `get_linked_cases`.
- **Citations it cannot fake:** every item a tool returns gets a ref (`S1`, `S2`...) registered on the server; only registered refs resolve to a source.
- **The path it took:** `trace` lists each tool call with the graph pattern it walked, and `graph` is the evidence subgraph of the cited items.
- **Memory across sessions:** `(Case)-[:HAS_CONVERSATION]->(Conversation)-[:HAS_MESSAGE]->(Message)-[:CITES]->(…)`, so follow-ups ("who has to comply with those?") resolve against earlier turns.
- `hearingId` in the request makes "this hearing" mean the hearing open in the app.

## API

All paths are under `/api/v1`. Every response has the same shape:

```json
{ "success": true, "statusCode": 200, "message": "Success", "data": {}, "errors": [], "code": "VALIDATION_ERROR",
  "meta": { "requestId": "…" }, "timestamp": "2026-10-17T00:00:00.000Z" }
```

In server code: throw `ApiError.notFound()` / `ApiError.validation([...])`, respond with `ApiResponse.ok(data).send(res)`, read input with `ApiRequest.from(req)`, validate with `validate({ body, query, params })`.

**Cases and people**

| Method | Path | Purpose |
|---|---|---|
| POST / GET | `/cases` | Create / list cases |
| GET / PATCH | `/cases/:caseId` | Overview (linked cases, counts) / update stage, status |
| POST | `/cases/:caseId/links` | Link two cases `{ linkedCaseId, reason }` |
| POST / GET | `/cases/:caseId/people` | Add / list parties, lawyers, judges, witnesses |

**Hearings, documents, transcripts**

| Method | Path | Purpose |
|---|---|---|
| POST / GET | `/cases/:caseId/hearings` | Add a hearing / timeline in date order |
| GET / PATCH | `/hearings/:hearingId` | Judge, appearances, documents, transcript, previous / next |
| POST | `/cases/:caseId/documents` | Multipart `file` or JSON `text`, plus `title`, `type`, `date`, `filedOn`, `hearingId`, `filedById`, `orderKind` |
| GET | `/cases/:caseId/documents?type=&hearingId=` | List documents |
| GET | `/documents/:documentId`, `/documents/:documentId/chunks?page=` | Status and metadata / text chunks |
| POST | `/hearings/:hearingId/transcripts` | New transcript version `{ text, speakerMap? }` |
| GET | `/hearings/:hearingId/transcript?from=&to=&version=`, `/hearings/:hearingId/transcripts` | Numbered turns / all versions |
| PATCH | `/transcripts/:transcriptId/speakers` | Map a speaker label to a person |

**Agents**

| Method | Path | Purpose |
|---|---|---|
| GET | `/cases/:caseId/claims?personId=&subjectId=&sourceId=` | Claims with who, about what and the exact source |
| GET | `/cases/:caseId/subjects` | Subjects with claim counts |
| POST | `/documents/:documentId/analyze`, `/transcripts/:transcriptId/analyze` | Re-run the intake agent on one source |
| GET | `/cases/:caseId/contradictions?category=self\|same_side\|record` | Contradictions with both citations and the reason |
| GET | `/cases/:caseId/disputes` | Points where the two sides disagree |
| GET | `/claims/:claimId/related` | What contradicts, disputes or supports one claim |
| POST | `/cases/:caseId/factcheck` | Re-check every claim of the case |
| GET | `/cases/:caseId/directions?status=pending\|overdue\|complied\|in_force\|vacated` | Directions with state, assignees and evidence |
| GET | `/cases/:caseId/compliance` | Overdue, due before the next hearing, complied, in force, vacated, per-party record |
| PATCH | `/directions/:directionId` | Lawyer override `{ status: complied\|not_complied\|vacated\|auto, note }` |
| POST | `/cases/:caseId/ask` | Ask the case `{ question, conversationId?, hearingId? }` → `answer`, `citations`, `trace`, `graph` |
| GET | `/cases/:caseId/conversations`, `/conversations/:conversationId` | Stored conversations |

**System**

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | FalkorDB, ImageKit and OpenAI status |
| POST / GET / DELETE | `/media/upload`, `/media/auth`, `/media/:fileId` | Direct ImageKit operations |

## FalkorDB

- One graph per deployment (`FALKORDB_GRAPH`); one graph per firm is the planned production setup.
- On boot the server creates range indexes on `id` and common lookup fields, and **vector indexes** (cosine) on `Chunk`, `Segment` and `Claim` embeddings. Safe to run repeatedly. Vector search returns cosine *distance*: lower is closer.
- The full node and edge model is in section 4 of [plan.md](plan.md); labels are listed in `server/src/module/graph/graph.schema.ts`.
- Open `http://localhost:3000` (FalkorDB Browser) to explore the graph.

## Scripts

| Command | What it does |
|---|---|
| `npm run db:up` / `db:down` / `db:logs` | Manage the FalkorDB container |
| `npm run dev:server` / `dev:client` | Dev servers with reload |
| `npm run build` | Build server and client |
| `npm run typecheck` | Typecheck server and client |
