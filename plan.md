# Court Case Memory Agent: Project Plan

> Graph Hacks: Context for AI Agents (WeMakeDevs x FalkorDB) | Oct 15-18, 2026 | Track 2: Agent Memory and Coordination
>
> Status as of Oct 17 (evening): backend, firm accounts, web app (13 screens + landing), demo seed and tests done. Remaining: live run of the agents with an OpenAI key, deployment, video, blog.

## 1. What We Are Building

An agent system that gives a court case a memory, for **lawyers**. Every hearing, transcript, order and document is stored in a FalkorDB graph. Agents extract who claimed what, track the court's directions, catch contradictions, and answer questions with exact sources and the path they followed.

**Problem:** cases run for years across dozens of hearings. Directions get forgotten, lawyers change, and contradictory statements go unnoticed. The full story lives in people's heads and scattered files.

**Scope:** Indian courts, civil and criminal. An FIR is just another document, so cases with and without police involvement share one model.

**Design:** every screen and the landing page are on the Claude Design canvas at https://claude.ai/artifact/Db8dEvtVSdF3pm6uZUGvkK. New screens should start from it; the README's Design section maps its pieces to the components in `client/src`.

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Graph + vector DB | **FalkorDB** (Docker) | Graph and vector indexes on the same nodes |
| Server | Node.js, Express 5, TypeScript | Official `falkordb` client, zod validation |
| Client | React 19, Vite, TypeScript, React Router, TanStack Query | Plain CSS court theme: ledger green, ink, mahogany, brass, red tape; Spectral / IBM Plex Sans / Courier Prime |
| Accounts | In the graph, `node:crypto` only | scrypt passwords, httpOnly session cookie (token hashed), invites, rate-limited sign-in |
| Tests | `node:test` + Playwright | API against a throwaway graph; browser flows against a seeded API |
| File storage | **ImageKit** | Original files only. Nodes keep `fileUrl` |
| Extraction, OCR | OpenAI `gpt-4o-mini` (`OPENAI_CHAT_MODEL`) | Claims, directions, image OCR |
| Judgments, Q&A | OpenAI `gpt-5.4-mini` (`OPENAI_REASONING_MODEL`) | Fact-check and compliance verdicts; Q&A tool calling (reasoning off: the API does not allow tools with reasoning on Chat Completions) |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims) | Stored as `vecf32` on Chunk, Segment and Claim |
| PDF text | `unpdf` | Text per page. Scanned PDFs are stored without text |

## 3. Inputs

| Source | Uploaded by the lawyer as | Produces |
|---|---|---|
| **Transcript** | Text with a speaker label on every turn (`Court: ...`). No timestamps | Numbered turns (Segments), then claims |
| **Order sheet** | Document of type `order`, linked to its hearing | Directions, next date, order kind and summary. **Orders come only from uploaded order sheets, never from transcripts** |
| **Other documents** (plaint, written statement, FIR, affidavit, sale deed, chargesheet, deposition...) | File or pasted text, plus title, type, `date` (of the document), `filedOn` (in court), filed by, hearing | Chunks with page and paragraph, then claims |

## 4. Graph Model

### People (each also has the `Person` label)
| Node | Properties |
|---|---|
| `Party` | name. Role (plaintiff, defendant, complainant, accused...) is on the `PARTY_IN` edge |
| `Lawyer` | name, enrolmentNo |
| `Judge` | name |
| `Witness` | name, code (PW1, DW2), witnessType (eye, police, expert...) |

People are scoped to a case and de-duplicated by normalised name (`nameKey`).

### Things
| Node | Properties |
|---|---|
| `Case` | firmId, caseNumber, title, court, caseType (civil/criminal), stage, status |
| `Hearing` | date, purpose, status (scheduled/held), adjourned, adjournmentReason, outcome |
| `Document` | title, type, date, filedOn, fileUrl, hash, status (embedding), analysis (intake), orderKind, summary, nextDate (orders), private (lawyer notes) |
| `Chunk` | page, para, paraLabel (the document's own para number), seq, text, embedding |
| `Transcript` | version, current, speakers |
| `Segment` | seq (turn number), speakerLabel, text, embedding |
| `Direction` | text, kind (direction, costs, notice, stay, undertaking), dueDate, dueText, orderDate, manualStatus / manualNote (lawyer override) |
| `Claim` | text, quote, quoteVerified, kind (allegation, denial, admission, fact, undertaking), eventDate, statedOn, sourceId, internal, superseded, embedding |
| `Subject` | name, type (property, money, document, event...) |
| `Conversation`, `Message` | Q&A memory: role, text, citations, trace |

### Accounts
| Node | Properties |
|---|---|
| `Firm` | name |
| `User` | email (unique), name, passwordHash (scrypt) |
| `Session` | tokenHash (SHA-256 of the cookie token), userId, expiresAt |
| `Invite` | tokenHash, email, role, expiresAt, usedAt |

`(User)-[:MEMBER_OF {role: owner|member}]->(Firm)`, `(Invite)-[:FOR_FIRM]->(Firm)`. Cases carry `firmId` as a property (indexed) rather than an edge, since every query filters by it.

### Edges
| Edge | Meaning |
|---|---|
| `(Party)-[:PARTY_IN {role}]->(Case)` | Who the parties are |
| `(Lawyer)-[:REPRESENTS {from, to}]->(Party)` | Representation, with dates when a lawyer changes |
| `(Witness)-[:CALLED_BY]->(Party)` | Which side the witness is for |
| `(Case)-[:LINKED_TO {reason}]->(Case)` | e.g. civil suit and criminal case on the same property |
| `(Case)-[:HAS_HEARING]->(Hearing)` | Every date in court |
| `(Hearing)-[:NEXT]->(Hearing)` | Timeline chain, rebuilt in date order on every change |
| `(Hearing)-[:PRESIDED_BY]->(Judge)` | Judge that day |
| `(Person)-[:APPEARED_IN {present}]->(Hearing)` | Attendance |
| `(Hearing)-[:ADJOURNED_AT_REQUEST_OF]->(Party)` | Who sought the adjournment |
| `(Document)-[:BELONGS_TO]->(Case)` | Always |
| `(Document)-[:SUBMITTED_IN]->(Hearing)` | When submitted at a hearing |
| `(Document)-[:FILED_BY]->(Party)` | Who filed it |
| `(Document)-[:HAS_CHUNK]->(Chunk)` | Text pieces with page and paragraph |
| `(Hearing)-[:RECORDED_IN]->(Transcript)-[:HAS_SEGMENT]->(Segment)` | The discussion, turn by turn |
| `(Segment)-[:SPOKEN_BY]->(Person)` | Speaker label resolved to a person |
| `(Document {type:"order"})-[:GIVES]->(Direction)-[:TO]->(Person)` | Who must do what |
| `(Chunk)-[:CONTAINS]->(Direction)` | Exact citation of each direction |
| `(Direction)-[:COMPLIED_BY {evidence, onTime, daysLate, reason}]->(Document)` | Evidence of compliance: a filing or a later order. Missing edge = not complied |
| `(Direction)-[:NONCOMPLIANCE_RECORDED_IN]->(order)` | A later order noted it was not done |
| `(Direction)-[:VACATED_BY]->(order)` | A later order lifted it |
| `(Chunk\|Segment)-[:CONTAINS]->(Claim)` | Exact citation of each claim |
| `(Claim)-[:MADE_BY]->(Person)`, `(Claim)-[:ON_BEHALF_OF]->(Party)` | Who asserted it, and for whom (lawyers, witnesses) |
| `(Claim)-[:ABOUT]->(Subject)` | What it concerns |
| `(Claim)-[:CONTRADICTS {id, category, severity, reason, fact, dismissed, crossPrep, note}]->(Claim)` | Same person over time, same side, or against a document of record. The lawyer can dismiss a finding or flag it for cross-examination (same fields on `DISPUTES` / `SUPPORTS`) |
| `(Claim)-[:DISPUTES]->(Claim)` | Opposite sides disagreeing: the dispute itself |
| `(Claim)-[:SUPPORTS]->(Claim)` | Corroboration |
| `(Case)-[:HAS_CONVERSATION]->(Conversation)-[:HAS_MESSAGE]->(Message)-[:CITES]->(…)` | Q&A memory linked to the evidence each answer used |

Future: `(Segment)-[:REFERS_TO]->(Document)` for later hearings discussing a document.

### Transcripts without timestamps
- Indian courts rarely timestamp. The parser splits on speaker labels and numbers the turns 1, 2, 3 (`seq`). A statement runs until the next label. Header lines and "Note:" inside a statement do not become speakers.
- Labels are matched to people: "Court" → presiding judge, "Ld. Counsel for Defendant" → the defendant's lawyer, "PW1" → witness by code, "Plaintiff" → the party. Unmatched labels are reported; the lawyer maps them without renumbering.
- Order inside a hearing = `seq`. Order across the case = hearing date, then `seq`. Citation: "Hearing 15 Apr 2021, turn 2".
- Numbering never changes. A correction uploads a new transcript **version**; the old one is kept with `current: false` and its claims are marked `superseded`.

## 5. Ingestion Pipeline

```
1. STORE      file -> ImageKit; Document {hash}. Same content in the case -> return existing
2. READ       PDF -> text per page | image -> OCR | pasted text. Transcript -> numbered turns
3. CHUNK      paragraphs with page + para + the document's own para number -> Chunk   status: extracted
4. EMBED      chunks / turns (background, 2 at a time)                               status: ready
5. ANALYSE    intake agent (background, one source at a time)                        analysis: done
                documents/transcripts -> claims + subjects; orders -> directions + next hearing
6. CHECK      fact-check agent on new claims; compliance agent on new filings / orders
```

Rules that keep the data healthy as it grows:
- **Facts are append-only.** New documents add claims; changed stories show up as `CONTRADICTS` edges.
- **Computed state:** a direction's state (overdue, complied, in force...) is worked out from edges on every read, not stored.
- **Provenance everywhere:** derived nodes keep `sourceId` and `createdBy`, so re-analysing a source replaces only what came from it. A lawyer's override is carried over.
- **Idempotent writes:** hash for files, `MERGE` on natural keys. Unfinished jobs resume on restart; jobs wait for an OpenAI key if none is set.
- **Analysis runs one source at a time**, so each document sees the subjects the previous one created and the same payment is never recorded twice.
- **Firm isolation:** one shared graph; every case has a `firmId` and every route id (case, hearing, document, transcript, claim, direction, conversation, finding) is resolved to its case and checked against the signed-in firm, answering 404 otherwise. One graph per firm (`selectGraph(firmId)`) remains an option for scale.
- **Re-analysis runs in the background:** `POST .../analyze` and `/factcheck` answer 202 and the UI polls the document's status.

## 6. Agents

All agents read and write the same graph: it is their shared memory and how they hand work to each other.

| Agent | Status | What it does |
|---|---|---|
| **Intake** | Built | Extracts claims (who, about what, exact quote, page/para or turn) from documents and transcripts, and directions (assignee, due date, kind) from orders. Schedules the next hearing an order fixes. Pleadings are always attributed to the filing party |
| **Fact-check** | Built | Compares each new claim with earlier ones found via the graph (same subject, same person) and by meaning. Uses `MADE_BY` → `REPRESENTS`/`CALLED_BY` → party role to know each claim's side. Writes `CONTRADICTS` / `DISPUTES` / `SUPPORTS` with a reason. The model must answer "can both be true?" first |
| **Compliance** | Built | Links directions to the filing or later order that satisfied them (`COMPLIED_BY`, on time / days late, using `filedOn`), records non-compliance and vacation noted in later orders, back-fills when uploads arrive out of order. Lawyer override never touched by the agent. Transcripts are not evidence |
| **Case Q&A** | Built | Tool-calling agent over 12 fixed graph tools. Every sentence cites `[S#]` refs registered on the server; returns the tools/patterns it used and the evidence subgraph; conversations stored in the graph |
| **Hearing brief** | Built (graph only) | The case brief (`GET /cases/:id/brief` and the Brief screen): next hearing, overdue and due-before-next directions, contradictions to raise, timeline, agent activity, all linked to sources. A model-written narrative brief is still to do |
| **Handover** | Stretch | Full case history for a new lawyer |

## 7. Key Decisions

| Decision | Why |
|---|---|
| Orders only from uploaded order sheets | The written order is the binding record; spoken words in court are not |
| Transcripts numbered by turn, not timestamped | Indian court transcripts rarely carry times; lawyers already cite by paragraph |
| Embed transcript turns alone; only short replies get the previous turn as context | Context on every turn made neighbouring turns compete in search |
| Each numbered paragraph is its own chunk | Precise "para 1" vs "para 3" citations |
| Pleadings attributed to the filing party; record documents (sale deed, FIR) not attributed to the filer | The model confused who a sentence is about with who asserts it |
| Opposite-side conflicts are `DISPUTES`, not contradictions | Otherwise every point of the dispute is flagged as a contradiction |
| Transcripts are not evidence of compliance | What counsel says is not the court's record; the brief can still mention it |
| Manual override for directions | Fees paid at the counter or costs paid in court never reach the system |
| `filedOn` separate from document `date` | A 2019 sale deed filed in 2021 complies with a 2021 order |
| Dates compared in IST | Deadlines and "overdue" follow Indian court days |
| Firm workspaces with owner/member roles | Several lawyers of a firm share cases; owners control who joins |
| Session cookie, not tokens in the browser | httpOnly cookie can't be read by scripts; only the token's hash is stored |
| 404 for another firm's ids | Doesn't reveal that a case or document exists |
| Seed writes the agents' results directly | The demo works with no OpenAI key; uploads still go through the real agents once a key is set |
| No range index on `Direction.dueDate` | FalkorDB returned future dates for `dueDate < $today` through that string index; overdue is worked out by the compliance service in one place |
| Ask box stays usable without the AI | A disabled field felt broken; asking explains what is missing and keeps the question |

## 8. Build Plan

| Day | Goal | Status |
|---|---|---|
| **Day 1 (Oct 15)** | Repo, Docker FalkorDB, Express skeleton, ImageKit | Done |
| **Day 2 (Oct 16)** | Graph schema, cases/people/hearings, document + transcript ingestion, embeddings, intake agent | Done |
| **Day 3 (Oct 17)** | Fact-check, compliance and Q&A agents | Done |
| | Firm accounts, sessions, invites and per-firm access checks | Done |
| | Web app: landing, sign-in, cases, new case, brief, hearings, documents + viewer, add to memory, story drift, directions, ask, settings | Done |
| | Seeded demo case, API tests (23), Playwright tests (13) | Done |
| **Day 4 (Oct 18)** | Live agent run with an OpenAI key, deploy, demo video, blog post. Submit before 11:59 PM IST | To do |

## 9. Demo Plan

`npm run seed` loads one firm (`demo@casememory.test`) with four cases. The main one is a synthetic recovery suit, CS 412/2020, Ramesh Kumar v. Suresh Gupta, with a linked counter-suit (CS 98/2022), 10 hearings, 12 documents, a cross-examination transcript and these planted issues:
1. **Late and overdue directions:** the written statement filed 39 days late; the plaintiff's rejoinder 11 days overdue; receipts due before the next hearing; a deposit order vacated; adjournment costs paid.
2. **Self-contradiction:** the 2021 written statement denies receiving Rs. 5,00,000; the 2023 affidavit says it was received "as a friendly loan" and part repaid.
3. **Contradicted by record:** the handwriting expert report matches the signature on the promissory note the defendant calls forged.
4. **The other side drifts too:** in cross-examination the plaintiff admits a Rs. 2,00,000 repayment his plaint denied.
5. **Problem documents:** a scanned note with no readable text, and an upload waiting for the AI agents.

Flow: sign in and see what needs attention across cases; open the brief before the next hearing; read the transcript turn by turn and open what contradicts it; follow Story drift and flag findings for cross; check directions and override one; open a cited paragraph in the document viewer; with an OpenAI key, upload a document, watch it being read, and ask the case with cited answers and the evidence graph.

## 10. Scope and Risks

- **MVP:** ingestion, intake, fact-check, compliance, Q&A, brief. Handover, interim applications and framed issues are stretch.
- **Extraction quality** drives everything downstream. Tested on realistic examples; quotes are verified against the source text.
- **Not legal advice:** a case organizer and memory aid.
- **Privacy:** synthetic data only. Lawyer notes are `private` and never mixed with the court record.
- **Input quality:** scanned PDFs (stored, not read), regional languages and audio are future work.

## 11. Hackathon Checklist

- [x] FalkorDB is central to the product (graph + vector memory shared by all agents)
- [x] Code and main FalkorDB implementation written during the event
- [x] README with setup steps
- [x] UI and seeded demo case
- [x] Accounts, firm isolation, validation and error handling, with API and browser tests
- [ ] Live run of the agents with an OpenAI key
- [ ] Live deployment (or local setup instructions plus demo video)
- [ ] Demo video
- [ ] Blog post for the side prize
- [ ] Submit before Oct 18, 11:59 PM IST
