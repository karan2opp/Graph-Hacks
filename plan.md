# Court Case Memory Agent: Project Plan

> Graph Hacks: Context for AI Agents (WeMakeDevs x FalkorDB) | Oct 15-18, 2026 | Track 2: Agent Memory and Coordination

## 1. What We Are Building

An agent that gives a court case a memory. It records every hearing, order, document, witness statement and deadline in a FalkorDB graph, then answers questions with sources, flags ignored court directions, and catches contradictions between what a party said at different times.

**Problem:** cases run for years across dozens of hearings. Directions get forgotten, lawyers change, and contradictory statements go unnoticed. The full story lives in people's heads and scattered files.

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Database | **FalkorDB** (Docker) | Graph plus vector index on the same nodes |
| Backend | **Node.js** (Express) | Official `falkordb` Node client |
| Frontend | **React** | Chat, timeline and graph view |
| LLM | OpenAI API | Claim extraction, summaries, hearing briefs |
| Embeddings | OpenAI embedding model (e.g. `text-embedding-3-small`) | Vectors stored as properties on Claim nodes in FalkorDB, with a vector index. FalkorDB stores and searches vectors but does not generate them |
| File storage | Cloud storage (S3 or similar) | FalkorDB stores only the file URL, not the file |
| Deployment | Render / Railway / Vercel | Live demo preferred by the rules |

## 3. Graph Model

### Nodes
`Case`, `Hearing`, `Order`, `Task`, `Document`, `Transcript`, `Claim`, `Entity` (property, account, etc.), `Party`, `Lawyer`, `Judge`, `Witness`

`Party`, `Lawyer`, `Judge` and `Witness` can also share an `Actor` label so a Claim can point to any of them with one query pattern.

### Edges
| Edge | Meaning |
|---|---|
| `(Case)-[:HAS_HEARING]->(Hearing)` | A case's hearing dates |
| `(Case)-[:RELATED_TO]->(Case)` | Linked civil and criminal cases |
| `(Party)-[:REPRESENTED_BY {from, to}]->(Lawyer)` | Overall representation, with dates for lawyer changes |
| `(Party)-[:PARTY_IN]->(Hearing)` | Party was part of this hearing |
| `(Lawyer)-[:APPEARED_IN]->(Hearing)` | Which lawyer was present on which day |
| `(Hearing)-[:PRESIDED_BY]->(Judge)` | Judge for that hearing |
| `(Hearing)-[:RESULTED_IN]->(Order)` | Order passed after the hearing |
| `(Order)-[:DIRECTS]->(Task)` | A direction becomes a trackable task |
| `(Task)-[:ASSIGNED_TO]->(Party)` | Who must do it |
| `(Task)-[:FULFILLED_BY]->(Document)` | Created only when the matching document is filed |
| `(Document)-[:FILED_AT]->(Hearing)` | Where a document was submitted |
| `(Hearing)-[:RECORDED_IN]->(Transcript)` | Full timestamped record of the hearing |
| `(Transcript)-[:INVOLVES]->(Actor)` | Who took part in the conversation |
| `(Witness)-[:TESTIFIED_IN]->(Hearing)` | Witness appeared |
| `(Witness)-[:CALLED_BY]->(Party)` | Which side the witness was for |
| `(Document)-[:CONTAINS]->(Claim)` | Claims from filed documents |
| `(Transcript)-[:CONTAINS]->(Claim)` | Claims from spoken statements |
| `(Claim)-[:SPOKEN_BY]->(Actor)` | Who said it (party, lawyer, witness or judge) |
| `(Claim)-[:MADE_IN]->(Hearing)` | Hearing where it was said or filed |
| `(Claim)-[:ABOUT]->(Entity)` | The thing it concerns, such as the property |
| `(Claim)-[:CONTRADICTS]->(Claim)` | Detected conflict |

### Design decisions
- **No direct Party-to-Claim or Judge-to-Party edges.** Those links come from traversal (for example Claim → Witness → Party) and avoid duplicated data. A Party gets a direct `SPOKEN_BY` edge only when it made the statement itself (written statement, affidavit).
- **Judge links only to Hearing**, so it is always clear which hearings each judge handled.
- **Two levels of transcript data:** the full chronological `Transcript` (raw record, for citations) and extracted `Claim` nodes (for reasoning and contradiction checks).

## 4. Storing Text and Vectors Together

- Each `Claim` (and each document chunk) keeps its **original text** and an **embedding** as properties on the same node.
- Semantic search: embed the question, find the nearest Claims through a vector index, then traverse edges to the Hearing, Document and Speaker.
- Answers always come from the **original text**. Embeddings are only the search index.
- Images and PDFs live in cloud storage. Nodes hold a `file_url` property.

## 5. Agents

1. **Intake agent:** takes in an order, filing, transcript or note. Extracts hearing details, directions, claims and the next date. Writes nodes and links them to existing ones. Turns directions into `Task` nodes.
2. **Deadline and compliance agent:** checks open tasks on a schedule and flags directions with no `FULFILLED_BY` document across later hearings.
3. **Hearing-brief agent:** before each hearing, produces a one-page brief of open tasks, recent hearings and contradictions, with a source for every line.
4. **Handover agent (stretch):** builds a full case history for a new lawyer.

All agents read and write the same graph, so it acts as their shared memory.

## 6. Key Queries

- **Where was this said?** Vector search over Claims, then traverse to Hearing and Document.
- **Who said it?** Claim → `SPOKEN_BY` → Actor.
- **All claims for a party:** direct claims, plus Party ← `CALLED_BY` ← Witness ← `SPOKEN_BY` ← Claim, plus Party → `REPRESENTED_BY` → Lawyer ← `SPOKEN_BY` ← Claim.
- **Ignored directions:** Tasks with no `FULFILLED_BY` edge and a due date in the past.
- **Contradictions:** Claims about the same Entity by the same Actor with different facts.

## 7. Build Plan (Oct 15-18)

| Day | Goal |
|---|---|
| **Day 1 (Oct 15)** | Set up FalkorDB in Docker, Express skeleton, graph schema, synthetic case data (one 5-year property dispute) |
| **Day 2 (Oct 16)** | Intake agent: text to nodes, claim extraction with embeddings, task creation, deadline check |
| **Day 3 (Oct 17)** | Hearing brief with citations, contradiction detection, semantic search, React chat and timeline view |
| **Day 4 (Oct 18)** | Graph visualization, deploy, demo video, README. Submit before 11:59 PM IST. Write the blog post for the side prize |

## 8. Demo Plan

Use one synthetic case with three planted issues:
1. A court direction that was ignored (missing sale deed).
2. A contradiction between a 2020 written statement and a 2023 affidavit.
3. A linked criminal case for the same property.

Flow: upload orders and watch the graph grow, show an overdue-task alert, ask a natural-language question and show the source hearing, generate the hearing brief with the contradiction, and show the path the agent followed.

## 9. Scope and Risks

- **Keep the MVP small:** intake, compliance flag, hearing brief, semantic search. The handover agent is a stretch goal. Voice input and speech-to-text are out of scope: all input is text (order sheets, filings, and typed hearing transcripts).
- **Contradiction detection** depends on reliable claim extraction. Make it work well on the planted examples rather than promising it on arbitrary documents.
- **Not legal advice:** present it as a case organizer and memory aid.
- **Privacy:** use only synthetic data in the demo. One isolated graph per user or firm is the production answer.
- **Input quality:** real court documents may be scanned or in regional languages. OCR and translation are future work.

## 10. Hackathon Checklist

- [ ] FalkorDB is central to the product
- [ ] Code and main FalkorDB implementation written during the event
- [ ] Live deployment (or local setup instructions plus demo video)
- [ ] README with setup steps
- [ ] Blog post for the side prize
- [ ] Submit before Oct 18, 11:59 PM IST
