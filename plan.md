# Court Case Memory Agent: Project Plan

> Graph Hacks: Context for AI Agents (WeMakeDevs x FalkorDB) | Oct 15-18, 2026 | Track 2: Agent Memory and Coordination

## 1. What We Are Building

An agent that gives a court case a memory, for **lawyers**. Every hearing, transcript, order and document is stored in a FalkorDB graph. The agent answers questions with exact sources, tracks court directions, and catches contradictions between what people said at different times.

**Problem:** cases run for years across dozens of hearings. Directions get forgotten, lawyers change, and contradictory statements go unnoticed. The full story lives in people's heads and scattered files.

**Scope:** Indian courts, civil and criminal. An FIR is just another document, so cases with and without police involvement share one model.

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Graph + vector DB | **FalkorDB** (Docker) | Graph and vector indexes on the same nodes |
| Server | Node.js, Express 5, TypeScript | Official `falkordb` client, zod validation |
| Client | React 19, Vite, TypeScript | Case page, timeline, chat |
| File storage | **ImageKit** | Original files only. Nodes keep `fileUrl` |
| LLM + embeddings | OpenAI (`gpt-4o-mini`, `text-embedding-3-small`) | Extraction, OCR of images, answers |
| PDF text | `unpdf` | Text per page. Scanned PDFs are out of scope for now |

## 3. Inputs

| Source | Uploaded by the lawyer as | Produces |
|---|---|---|
| **Transcript** | Text with a speaker label on every turn (`Judge: ...`). No timestamps | Numbered segments, then claims |
| **Order sheet** | Document of type `order`, linked to its hearing | Directions, next date, order kind. **Orders come only from uploaded order sheets, never from transcripts** |
| **Other documents** (plaint, written statement, FIR, affidavit, sale deed, chargesheet, deposition...) | File or pasted text, plus metadata (title, type, date, filed by, hearing) | Chunks with page and paragraph, then claims |

## 4. Graph Model

### People (each also has the `Person` label)
| Node | Properties |
|---|---|
| `Party` | name. Role (plaintiff, defendant, complainant, accused...) is on the `PARTY_IN` edge |
| `Lawyer` | name, enrolmentNo |
| `Judge` | name |
| `Witness` | name, code (PW1, DW2), witnessType (eye, police, expert...) |

### Things
| Node | Properties |
|---|---|
| `Case` | caseNumber, title, court, caseType (civil/criminal), stage, status |
| `Hearing` | date, purpose, status (scheduled/held), adjourned, outcome |
| `Document` | title, type, date, fileUrl, hash, status, orderKind (orders only), private (lawyer notes) |
| `Chunk` | page, para, seq, text, embedding |
| `Transcript` | version, current |
| `Segment` | seq (turn number), speakerLabel, text, embedding |
| `Direction` | text, dueDate, kind (direction/undertaking/costs), status (pending/complied/overdue) |
| `Claim` | text, date, embedding |
| `Subject` | name, type (property, money, event...) |

### Edges
| Edge | Meaning |
|---|---|
| `(Party)-[:PARTY_IN {role}]->(Case)` | Who the parties are |
| `(Lawyer)-[:REPRESENTS {from, to}]->(Party)` | Representation, with dates when a lawyer changes |
| `(Witness)-[:CALLED_BY]->(Party)` | Which side the witness is for |
| `(Case)-[:LINKED_TO]->(Case)` | e.g. civil suit and criminal case on the same property |
| `(Case)-[:HAS_HEARING]->(Hearing)` | Every date in court |
| `(Hearing)-[:NEXT]->(Hearing)` | Timeline chain in date order |
| `(Hearing)-[:PRESIDED_BY]->(Judge)` | Judge that day |
| `(Person)-[:APPEARED_IN {present}]->(Hearing)` | Attendance |
| `(Document)-[:BELONGS_TO]->(Case)` | Always |
| `(Document)-[:SUBMITTED_IN]->(Hearing)` | When submitted at a hearing |
| `(Document)-[:FILED_BY]->(Party)` | Who filed it |
| `(Document)-[:HAS_CHUNK]->(Chunk)` | Text pieces with page and paragraph |
| `(Hearing)-[:RECORDED_IN]->(Transcript)-[:HAS_SEGMENT]->(Segment)` | The discussion, turn by turn |
| `(Segment)-[:SPOKEN_BY]->(Person)` | Speaker label resolved to a person |
| `(Segment)-[:REFERS_TO]->(Document)` | A later hearing discussing a document |
| `(Document {type:"order"})-[:GIVES]->(Direction)-[:TO]->(Person)` | Who must do what |
| `(Direction)-[:COMPLIED_BY]->(Document)` | Added only when complied. Missing edge = not complied |
| `(Chunk|Segment)-[:CONTAINS]->(Claim)` | Exact citation of each claim |
| `(Claim)-[:MADE_BY]->(Person)`, `(Claim)-[:ABOUT]->(Subject)` | Who said it and what it concerns |
| `(Claim)-[:CONTRADICTS|SUPPORTS {reason}]->(Claim)` | Fact-check results |

### Transcripts without timestamps
- Indian courts rarely timestamp. The parser splits on speaker labels and numbers the turns 1, 2, 3 (`seq`). A statement runs until the next label.
- Order inside a hearing = `seq`. Order across the case = hearing date, then `seq`.
- Citation: "10 Mar 2021 · Turn 23 · Defendant's Counsel". Context = range query on `seq`.
- Numbering never changes. A correction uploads a new transcript **version**; the old one is kept with `current: false`.

## 5. Ingestion Pipeline

```
1. STORE      file -> ImageKit; Document {status:"uploaded", hash}. Same hash in the case -> return existing
2. READ       PDF -> text per page | image -> OCR | pasted text. Transcript -> numbered segments
3. CHUNK      paragraphs with page + para numbers -> Chunk nodes          status:"extracted"
4. EMBED      chunks / segments (background job)                          status:"ready"
5. UNDERSTAND LLM + zod schema: claims, directions (orders), subjects; match against existing graph
6. NOTIFY     fact-check and compliance agents run on the new data
```

Rules that keep the data healthy as it grows:
- **Facts are append-only.** New documents add claims; changed stories show up as `CONTRADICTS` edges.
- **Few mutable fields** (`Direction.status`, `Case.stage`, `Case.status`), each with `updatedBy`, `updatedAt`.
- **Provenance everywhere:** derived nodes keep `sourceDocId` / `createdBy`, so one bad extraction can be deleted and re-run.
- **Idempotent writes:** hash for files, `MERGE` on natural keys. Background jobs resume on server restart.
- **One graph per firm** later (`selectGraph(firmId)`).

## 6. Agents

All agents read and write the same graph, so it is their shared memory.

1. **Intake agent:** runs the pipeline above, extracts claims and directions, links them to existing people and subjects.
2. **Fact-check agent:** for each new claim, finds earlier claims on the same subject (graph + vector), decides `CONTRADICTS` / `SUPPORTS` with a reason.
3. **Compliance agent:** links new documents to pending directions (`COMPLIED_BY`), flags overdue ones. Mostly Cypher.
4. **Case Q&A agent:** tool-using agent (`searchClaims`, `getTimeline`, `getHearingOrders`, `getClaimsByPerson`, `getDirections`, `getLinkedCases`, `getContradictions`). Every line cited, path shown.
5. **Hearing-brief agent:** one-page brief before a hearing from the other agents' output.
6. **Handover agent (stretch):** full case history for a new lawyer.

## 7. Build Plan

| Day | Goal |
|---|---|
| **Day 1 (Oct 15)** | Repo, Docker FalkorDB, Express skeleton, ImageKit |
| **Day 2 (Oct 16)** | Graph schema, cases/people/hearings, document + transcript ingestion, embeddings, intake extraction |
| **Day 3 (Oct 17)** | Q&A agent, fact-check, compliance, React case page + chat + timeline, seed case |
| **Day 4 (Oct 18)** | Hearing brief, graph view, deploy, demo video, README, blog post. Submit before 11:59 PM IST |

## 8. Demo Plan

One synthetic property dispute with a linked criminal case (FIR as a document) and three planted issues:
1. An ignored direction (sale deed never filed).
2. A contradiction between the 2020 written statement and a 2023 affidavit.
3. A witness whose court testimony contradicts the FIR.

Flow: upload documents and a transcript and watch the graph grow, see the overdue alert, ask "list the orders from the last hearing" and "what has the defendant said about the payment?", generate the hearing brief, show the path the agent followed.

## 9. Scope and Risks

- **MVP:** ingestion, Q&A, fact-check, compliance, brief. Handover, interim applications and framed issues are stretch.
- **Contradiction detection** depends on claim extraction. Make it work well on the planted examples.
- **Not legal advice:** a case organizer and memory aid.
- **Privacy:** synthetic data only. Lawyer notes are `private` and never mixed with court record.
- **Input quality:** scanned PDFs, regional languages and audio are future work.

## 10. Hackathon Checklist

- [ ] FalkorDB is central to the product
- [ ] Code and main FalkorDB implementation written during the event
- [ ] Live deployment (or local setup instructions plus demo video)
- [ ] README with setup steps
- [ ] Blog post for the side prize
- [ ] Submit before Oct 18, 11:59 PM IST
