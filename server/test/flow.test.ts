/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The whole flow, end to end through the API: a case is set up, its record is filed (pasted text,
 * a PDF, a scanned image, a transcript), the background agents read it into the graph, and the
 * Q&A agent answers from that graph with citations. OpenAI is replaced by a local fake with
 * deterministic answers, so every step really runs and every node and edge can be checked.
 * The graph is left in place afterwards (court_memory_flow) to explore in FalkorDB Browser.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { newFirm, startServer, type Client, type TestServer } from "./helpers.js";
import { startFakeOpenAI, type FakeOpenAI } from "./support/fakeOpenAI.js";
import { makePdf } from "./support/pdf.js";

let fake: FakeOpenAI;
let srv: TestServer;
let c: Client;
let query: (cypher: string, params?: Record<string, unknown>) => Promise<any[]>;
let idle: () => Promise<void>;

const ids: Record<string, string> = {};

/** dd.mm.yyyy and yyyy-mm-dd for a day `days` from today. */
function fromToday(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  const iso = d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split("-");
  return { iso, dmy: `${day}.${m}.${y}` };
}
const NEXT = fromToday(7);

/** Multipart upload with the signed-in session, like the browser form. */
async function upload(path: string, fields: Record<string, string>, file: { name: string; type: string; bytes: Buffer }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  const res = await fetch(srv.base + path, { method: "POST", body: form, headers: { cookie: c.cookie } });
  return { status: res.status, body: (await res.json()) as any };
}

async function addDocument(body: Record<string, unknown>) {
  const res = await c.post(`/cases/${ids.case}/documents`, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await idle();
  return res.body.data.id as string;
}

const claimsOf = async (documentOrTranscriptId: string) =>
  (await c.get(`/cases/${ids.case}/claims?sourceId=${documentOrTranscriptId}`)).body.data as any[];
const count = async (cypher: string, params: Record<string, unknown> = {}) => Number((await query(cypher, params))[0]?.n ?? 0);
const edges = (type: string) => count(`MATCH (:Claim {caseId: $caseId, superseded: false})-[r:${type}]->(:Claim {superseded: false}) RETURN count(r) AS n`, { caseId: ids.case });

before(async () => {
  fake = await startFakeOpenAI();
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = fake.url;
  process.env.FALKORDB_GRAPH = "court_memory_flow";
  srv = await startServer();
  const db = await import("../src/common/db/index.js");
  query = (cypher, params = {}) => db.runQuery<any>(cypher, params);
  idle = (await import("../src/module/ingestion/index.js")).whenIdle;
  c = (await newFirm(srv.base, "Mehta & Associates")).c;
});
after(async () => {
  await srv.close();
  await fake.close();
});

describe("from filing to answers", () => {
  it("sets up the case: parties, counsel, the judge, a witness and the first hearing", async () => {
    const kase = await c.post("/cases", { caseNumber: "CS 412/2020", title: "Ramesh Kumar v. Suresh Gupta", court: "Court of the Civil Judge (Sr. Div.), Delhi", caseType: "civil" });
    assert.equal(kase.status, 201, JSON.stringify(kase.body));
    ids.case = kase.body.data.id;

    const person = async (body: Record<string, unknown>) => {
      const res = await c.post(`/cases/${ids.case}/people`, body);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.data.id as string;
    };
    ids.plaintiff = await person({ kind: "party", name: "Ramesh Kumar", role: "plaintiff" });
    ids.defendant = await person({ kind: "party", name: "Suresh Gupta", role: "defendant" });
    ids.lawyer = await person({ kind: "lawyer", name: "Priya Mehta", representsId: ids.plaintiff });
    ids.judge = await person({ kind: "judge", name: "Shri A. K. Sharma" });
    ids.witness = await person({ kind: "witness", name: "Mohan Lal", code: "DW1", calledById: ids.defendant });

    const h = await c.post(`/cases/${ids.case}/hearings`, { date: "2021-03-10", purpose: "Appearance", judgeId: ids.judge });
    assert.equal(h.status, 201, JSON.stringify(h.body));
    ids.h1 = h.body.data.hearing.id;
    assert.equal(h.body.data.hearing.status, "held");
  });

  it("stores a pasted plaint as cited paragraphs and reads the plaintiff's claims out of it", async () => {
    ids.plaint = await addDocument({
      title: "Plaint",
      type: "plaint",
      filedOn: "2021-02-01",
      filedById: ids.plaintiff,
      text: "PLAINT\n\n1. The plaintiff paid Rs. 5,00,000 to the defendant on 15.03.2019 as sale consideration for Shop No. 14.\n\n2. The defendant has not handed over possession of Shop No. 14 to the plaintiff.",
    });

    const doc = (await c.get(`/documents/${ids.plaint}`)).body.data;
    assert.equal(doc.status, "ready", doc.error ?? doc.note);
    assert.equal(doc.analysis, "done", doc.analysisError);
    assert.deepEqual([doc.chunks, doc.embedded], [2, 2]);
    assert.equal(await count("MATCH (:Document {id: $id})-[:BELONGS_TO]->(:Case {id: $caseId}) RETURN count(*) AS n", { id: ids.plaint, caseId: ids.case }), 1);
    assert.equal(await count("MATCH (:Document {id: $id})-[:FILED_BY]->(:Party {id: $p}) RETURN count(*) AS n", { id: ids.plaint, p: ids.plaintiff }), 1);

    const claims = await claimsOf(ids.plaint);
    assert.equal(claims.length, 2);
    for (const cl of claims) {
      assert.equal(cl.madeBy?.id, ids.plaintiff, "a pleading's claims are the filing party's");
      assert.equal(cl.claim.quoteVerified, true);
      assert.equal(cl.claim.statedOn, "2021-02-01", "a filing speaks on the day it was filed");
    }
    assert.deepEqual(claims.map((cl) => cl.source.paraLabel), ["1", "2"]);
    assert.equal(claims[0].claim.eventDate, "2019-03-15");
    assert.deepEqual(claims[0].subjects.map((s: any) => s.name).sort(), ["Payment of Rs. 5,00,000", "Shop No. 14"]);
    assert.equal(await count("MATCH (c:Claim {caseId: $caseId}) WHERE c.embedding IS NOT NULL RETURN count(c) AS n", { caseId: ids.case }), 2);
  });

  it("reads an order into directions with deadlines, and schedules the next date it fixes", async () => {
    ids.order1 = await addDocument({
      title: "Order dated 10.03.2021",
      type: "order",
      hearingId: ids.h1,
      text: "ORDER\n\n1. Defendant to file written statement within 30 days.\n\n2. Parties to maintain status quo on Shop No. 14 till further orders.\n\n3. Put up on 18.05.2021 for written statement.",
    });
    const doc = (await c.get(`/documents/${ids.order1}`)).body.data;
    assert.equal(doc.analysis, "done", doc.analysisError);
    assert.equal(doc.directionCount, 2);

    const directions = (await c.get(`/cases/${ids.case}/directions`)).body.data as any[];
    const ws = directions.find((d) => d.direction.kind === "direction");
    const stay = directions.find((d) => d.direction.kind === "stay");
    assert.equal(ws.direction.dueDate, "2021-04-09");
    assert.equal(ws.state, "overdue");
    assert.deepEqual(ws.assignedTo.map((p: any) => p.id), [ids.defendant]);
    assert.equal(stay.state, "in_force");
    assert.equal(stay.assignedTo.length, 2, "'the parties' means every party");
    assert.equal(ws.order.paraLabel, "1");

    const hearings = (await c.get(`/cases/${ids.case}/hearings`)).body.data as any[];
    const next = hearings.find((h) => h.hearing.date === "2021-05-18");
    assert.ok(next, "the next date fixed by the order is on the timeline");
    assert.equal(next.hearing.purpose, "written statement");
    ids.h2 = next.hearing.id;
    assert.equal((await c.get(`/hearings/${ids.h1}`)).body.data.next.id, ids.h2);
  });

  it("reads a PDF written statement paragraph by paragraph and sees it answers the order, late", async () => {
    const pdf = makePdf([
      "WRITTEN STATEMENT ON BEHALF OF THE DEFENDANT",
      "1. The defendant denies having received any payment of Rs. 5,00,000",
      "from the plaintiff.",
      "2. The plaintiff has been in possession of Shop No. 14 since April 2019.",
    ]);
    const res = await upload(
      `/cases/${ids.case}/documents`,
      { title: "Written statement", type: "written_statement", filedById: ids.defendant, filedOn: "2021-04-20", hearingId: ids.h2 },
      { name: "written-statement.pdf", type: "application/pdf", bytes: pdf },
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.meta.warnings.join(" "), /ImageKit is not configured/);
    ids.ws = res.body.data.id;
    await idle();

    const chunks = (await c.get(`/documents/${ids.ws}/chunks`)).body.data as any[];
    assert.deepEqual(chunks.map((ch) => ch.paraLabel), ["1", "2"], "each numbered paragraph is its own citable chunk");
    assert.ok(chunks.every((ch) => ch.embedded));

    const claims = await claimsOf(ids.ws);
    assert.equal(claims.length, 2);
    assert.deepEqual(claims.map((cl) => [cl.madeBy.id, cl.source.page, cl.source.paraLabel]), [
      [ids.defendant, 1, "1"],
      [ids.defendant, 1, "2"],
    ]);
    assert.ok(claims.every((cl) => cl.claim.quoteVerified), "quotes survive the PDF's line breaks");
    assert.equal(await count("MATCH (s:Subject {caseId: $caseId}) RETURN count(s) AS n", { caseId: ids.case }), 2, "subjects are shared, not duplicated");

    console.log("WSDOC", JSON.stringify(await query("MATCH (d:Document {id: $id}) RETURN d.contradictionCount AS c, d.disputeCount AS di, d.supportCount AS s, d.factcheckError AS e, d.complianceError AS ce", { id: ids.ws })), JSON.stringify(await query("MATCH (c:Claim)-[:ABOUT]->(s:Subject) RETURN c.sourceId AS src, s.name AS s")));
    const disputes = (await c.get(`/cases/${ids.case}/disputes`)).body.data as any[];
    assert.equal(disputes.length, 2);
    assert.ok(disputes.every((d) => d.later.source.documentId === ids.ws));

    const ws = ((await c.get(`/cases/${ids.case}/directions`)).body.data as any[]).find((d) => d.direction.kind === "direction");
    assert.equal(ws.state, "complied");
    assert.equal(ws.compliedBy.documentId, ids.ws);
    assert.deepEqual([ws.compliedBy.onTime, ws.compliedBy.daysLate], [false, 11]);
  });

  it("does not repeat a standing order when a later order only continues it", async () => {
    ids.order2 = await addDocument({
      title: "Order dated 18.05.2021",
      type: "order",
      hearingId: ids.h2,
      text: "1. Written statement filed by the defendant. Status quo to continue.\n\n2. Put up on 06.02.2023 for evidence of DW1.",
    });
    const directions = (await c.get(`/cases/${ids.case}/directions`)).body.data as any[];
    assert.equal(directions.length, 2);
    const prompt = fake.calls.filter((x) => x.body.response_format?.json_schema?.name === "court_order").at(-1)!.body.messages[1].content;
    assert.match(prompt.split("ALREADY IN FORCE:")[1], /status quo/i, "the model is told what is already in force");

    const h3 = ((await c.get(`/cases/${ids.case}/hearings`)).body.data as any[]).find((h) => h.hearing.date === "2023-02-06");
    assert.ok(h3);
    ids.h3 = h3.hearing.id;
  });

  it("catches the defendant contradicting his own written statement in a later affidavit", async () => {
    const res = await c.patch(`/hearings/${ids.h3}`, {
      judgeId: ids.judge,
      appearances: [{ personId: ids.lawyer }, { personId: ids.defendant }, { personId: ids.witness }],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    ids.affidavit = await addDocument({
      title: "Affidavit of Suresh Gupta",
      type: "affidavit",
      date: "2023-02-06",
      hearingId: ids.h3,
      filedById: ids.defendant,
      text: "AFFIDAVIT OF SURESH GUPTA\n\n1. I received the said amount in March 2019 as a friendly loan from the plaintiff.",
    });
    const [claim] = await claimsOf(ids.affidavit);
    assert.equal(claim.madeBy.id, ids.defendant);
    assert.deepEqual(claim.subjects.map((s: any) => s.name), ["Payment of Rs. 5,00,000"], "'the said amount' is the same payment");

    const self = (await c.get(`/cases/${ids.case}/contradictions?category=self`)).body.data as any[];
    assert.equal(self.length, 1);
    assert.equal(self[0].earlier.source.documentId, ids.ws);
    assert.equal(self[0].later.source.documentId, ids.affidavit);
    assert.equal(self[0].severity, "high");
    assert.equal((await c.get(`/cases/${ids.case}/disputes`)).body.data.length, 3, "a loan, not a sale: disputed by the plaintiff's case");
  });

  it("splits a transcript into turns, matches speakers to people, and checks what the witness said", async () => {
    const res = await c.post(`/hearings/${ids.h3}/transcripts`, {
      text: [
        "IN THE COURT OF THE CIVIL JUDGE (SR. DIV.), DELHI",
        "CS 412/2020, evidence of DW1",
        "",
        "Ld. Counsel for Plaintiff: Did you receive any money from the plaintiff?",
        "DW1: Yes. The defendant received Rs. 5,00,000 from the plaintiff in my presence.",
        "Court: Put up for arguments.",
      ].join("\n"),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const t = res.body.data;
    ids.transcript = t.id;
    assert.deepEqual(t.unmatchedSpeakers, []);
    const speaker = (label: string) => t.speakers.find((s: any) => s.label === label)?.personId;
    assert.deepEqual([speaker("Ld. Counsel for Plaintiff"), speaker("DW1"), speaker("Court")], [ids.lawyer, ids.witness, ids.judge]);
    await idle();

    const full = (await c.get(`/hearings/${ids.h3}/transcript`)).body.data;
    assert.equal(full.status, "ready");
    assert.equal(full.analysis, "done", full.analysisError);
    assert.deepEqual(full.segments.map((s: any) => s.seq), [1, 2, 3]);
    assert.ok(full.segments.every((s: any) => s.embedded));

    const [claim] = await claimsOf(ids.transcript);
    assert.equal(claim.madeBy.id, ids.witness);
    assert.deepEqual([claim.source.type, claim.source.turn], ["transcript", 2]);

    const sameSide = (await c.get(`/cases/${ids.case}/contradictions?category=same_side`)).body.data as any[];
    assert.equal(sameSide.length, 1, "the defendant's own witness says he was paid");
    assert.equal(sameSide[0].earlier.source.documentId, ids.ws);
    assert.equal(await edges("SUPPORTS"), 2);
  });

  it("records a later order lifting the status quo against the earlier direction", async () => {
    ids.order3 = await addDocument({
      title: "Order dated 06.02.2023",
      type: "order",
      hearingId: ids.h3,
      text: `1. The status quo order dated 10.03.2021 stands vacated.\n\n2. Put up on ${NEXT.dmy} for arguments.`,
    });
    const directions = (await c.get(`/cases/${ids.case}/directions`)).body.data as any[];
    assert.equal(directions.length, 2, "lifting an order is not a new direction");
    const stay = directions.find((d) => d.direction.kind === "stay");
    assert.equal(stay.state, "vacated");
    assert.equal(stay.vacatedBy.documentId, ids.order3);

    const report = (await c.get(`/cases/${ids.case}/compliance`)).body.data;
    assert.equal(report.nextHearing.date, NEXT.iso);
    assert.equal(report.overdue.length, 0);
  });

  it("reads a photographed receipt with OCR and checks it as a document of record", async () => {
    fake.ocrText = "RECEIPT\n\nReceived Rs. 5,00,000 from Ramesh Kumar on 15.03.2019.\n\nSd/- Suresh Gupta";
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const res = await upload(
      `/cases/${ids.case}/documents`,
      { title: "Receipt dated 15.03.2019", type: "evidence", date: "2019-03-15", filedById: ids.plaintiff },
      { name: "receipt.png", type: "image/png", bytes: png },
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.receipt = res.body.data.id;
    await idle();
    assert.ok(fake.calls.some((x) => Array.isArray(x.body.messages?.[0]?.content)), "the image went to the vision model");

    const [claim] = await claimsOf(ids.receipt);
    assert.equal(claim.madeBy, null, "nobody 'says' a receipt; it is a record");
    const record = (await c.get(`/cases/${ids.case}/contradictions?category=record`)).body.data as any[];
    assert.equal(record.length, 1);
    assert.equal(record[0].earlier.source.documentId, ids.receipt);
    assert.equal(record[0].later.source.documentId, ids.ws);

    // Everything the agents found, in one place.
    assert.deepEqual([await edges("CONTRADICTS"), await edges("DISPUTES"), await edges("SUPPORTS")], [3, 3, 5]);
  });

  it("answers a question from the graph, with citations that point at real nodes", async () => {
    const res = await c.post(`/cases/${ids.case}/ask`, { question: "Did the defendant receive Rs. 5,00,000 from the plaintiff?" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const a = res.body.data;
    ids.conversation = a.conversationId;
    assert.equal(a.trace[0].tool, "search_case");
    assert.ok(a.trace[0].found > 0);
    assert.ok(a.citations.length > 0);
    assert.ok(a.citations.some((x: any) => x.kind === "claim"));

    const LABEL: Record<string, string> = { claim: "Claim", chunk: "Chunk", segment: "Segment", direction: "Direction", document: "Document", hearing: "Hearing" };
    for (const cite of a.citations) {
      assert.ok(a.answer.includes(cite.ref), `${cite.ref} is used in the answer`);
      const [row] = await query("MATCH (n {id: $id}) RETURN labels(n) AS labels, n.caseId AS caseId", { id: cite.nodeId });
      assert.ok(row?.labels.includes(LABEL[cite.kind]), `${cite.ref} points at a ${LABEL[cite.kind]}`);
    }
    assert.ok(a.graph.nodes.some((n: any) => n.label === "Claim") && a.graph.edges.some((e: any) => e.type === "MADE_BY"));
    assert.equal(
      await count("MATCH (:Conversation {id: $id})-[:HAS_MESSAGE]->(m:Message {role: 'assistant'})-[:CITES]->(n) RETURN count(n) AS n", { id: ids.conversation }),
      a.citations.length,
    );
  });

  it("remembers the conversation and answers a follow-up from the contradiction graph", async () => {
    const res = await c.post(`/cases/${ids.case}/ask`, { question: "Has the defendant contradicted himself?", conversationId: ids.conversation });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const a = res.body.data;
    assert.equal(a.conversationId, ids.conversation);
    assert.deepEqual(a.trace.map((s: any) => [s.tool, s.args.category, s.found]), [["get_contradictions", "self", 1]]);
    assert.deepEqual(a.citations.map((x: any) => x.documentId).sort(), [ids.ws, ids.affidavit].sort());

    const sent = fake.calls.filter((x) => x.body.tools).at(-1)!.body.messages.map((m: any) => m.role);
    assert.deepEqual(sent.slice(0, 3), ["system", "user", "assistant"], "the first exchange is sent as history");

    const conv = (await c.get(`/conversations/${ids.conversation}`)).body.data;
    assert.deepEqual(conv.messages.map((m: any) => m.role), ["user", "assistant", "user", "assistant"]);
    assert.equal(conv.messages[3].citations.length, 2);
  });

  it("answers about a hearing date with the court's own directions", async () => {
    const res = await c.post(`/cases/${ids.case}/ask`, { question: "What did the court direct on 2021-03-10?" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const a = res.body.data;
    assert.equal(a.trace[0].tool, "get_hearing");
    const directions = a.citations.filter((x: any) => x.kind === "direction");
    assert.equal(directions.length, 2);
    assert.ok(directions.every((x: any) => x.documentId === ids.order1));
    assert.match(a.answer, /written statement/i);
  });

  it("reads a document again without duplicating what it found", async () => {
    const before = await count("MATCH (c:Claim {caseId: $caseId}) RETURN count(c) AS n", { caseId: ids.case });
    const res = await c.post(`/documents/${ids.ws}/analyze`);
    assert.equal(res.status, 202, JSON.stringify(res.body));
    await idle();
    assert.equal((await c.get(`/documents/${ids.ws}`)).body.data.analysis, "done");
    assert.equal(await count("MATCH (c:Claim {caseId: $caseId}) RETURN count(c) AS n", { caseId: ids.case }), before);
    assert.equal(await count("MATCH (s:Subject {caseId: $caseId}) RETURN count(s) AS n", { caseId: ids.case }), 2);
    assert.deepEqual([await edges("CONTRADICTS"), await edges("DISPUTES"), await edges("SUPPORTS")], [3, 3, 5]);
  });

  it("recognises the same file uploaded twice", async () => {
    const res = await c.post(`/cases/${ids.case}/documents`, {
      title: "Plaint (copy)",
      type: "plaint",
      text: "PLAINT\n\n1. The plaintiff paid Rs. 5,00,000 to the defendant on 15.03.2019 as sale consideration for Shop No. 14.\n\n2. The defendant has not handed over possession of Shop No. 14 to the plaintiff.",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.id, ids.plaint);
  });

  it("lets a corrected transcript replace the old one's claims", async () => {
    const res = await c.post(`/hearings/${ids.h3}/transcripts`, {
      text: [
        "Ld. Counsel for Plaintiff: Did you receive any money from the plaintiff?",
        "DW1: Yes. The defendant received Rs. 5,00,000 from the plaintiff in my presence.",
        "Ld. Counsel for Plaintiff: Nothing further.",
        "Court: Put up for arguments.",
      ].join("\n"),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.version, 2);
    await idle();

    assert.equal((await claimsOf(ids.transcript)).length, 0, "the old version's claims are superseded");
    assert.equal((await claimsOf(res.body.data.id)).length, 1);
    assert.equal((await c.get(`/cases/${ids.case}/contradictions?category=same_side`)).body.data.length, 1);
    assert.deepEqual([await edges("CONTRADICTS"), await edges("DISPUTES"), await edges("SUPPORTS")], [3, 3, 5]);
  });

  it("shows the same picture on the case card and the brief", async () => {
    const card = ((await c.get("/cases")).body.data as any[]).find((x) => x.case.id === ids.case);
    assert.equal(card.nextHearing.date, NEXT.iso);
    assert.equal(card.overdue, 0);
    const brief = await c.get(`/cases/${ids.case}/brief`);
    assert.equal(brief.status, 200, JSON.stringify(brief.body));
  });
});
