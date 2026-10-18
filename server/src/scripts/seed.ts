/**
 * Demo data: one firm, one signed-in user and four cases, with Ramesh Kumar v. Suresh Gupta filled in
 * end to end. Base records go through the same services the API uses; the parts the agents would
 * normally produce (claims, subjects, fact-check links, directions) are written directly, so the demo
 * works without an OpenAI key. Synthetic data only. Safe to re-run: it removes the demo firm first.
 *
 *   npm run seed
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { embedTexts, isAIEnabled } from "../common/ai/index.js";
import { nowIso, queryOne, runQuery } from "../common/db/index.js";
import { register } from "../module/auth/index.js";
import { addPerson, addPersonBody, createCase, createCaseBody, linkCases } from "../module/case/index.js";
import { createDocument, createDocumentBody } from "../module/document/index.js";
import { createHearing, createHearingBody } from "../module/hearing/index.js";
import { enqueue } from "../module/ingestion/index.js";
import { createTranscript } from "../module/transcript/index.js";

export const DEMO_EMAIL = "demo@casememory.test";
export const DEMO_PASSWORD = process.env.SEED_PASSWORD || "casememory-demo-2026";

/** Removes cases and everything under them (people, hearings, documents, claims, conversations...). */
async function deleteCases(ids: string[]) {
  await runQuery("MATCH (c:Conversation)-[:HAS_MESSAGE]->(m:Message) WHERE c.caseId IN $ids DETACH DELETE m", { ids });
  await runQuery("MATCH (n) WHERE n.caseId IN $ids DETACH DELETE n", { ids });
  await runQuery("MATCH (c:Case) WHERE c.id IN $ids DETACH DELETE c", { ids });
}

/** Removes the demo firm, its users and everything under its cases. */
async function wipeDemo() {
  const firm = await queryOne<{ firmId: string }>(
    "MATCH (:User {email: $email})-[:MEMBER_OF]->(f:Firm) RETURN f.id AS firmId",
    { email: DEMO_EMAIL },
  );
  if (!firm) return;
  const cases = await runQuery<{ id: string }>("MATCH (c:Case {firmId: $firmId}) RETURN c.id AS id", firm);
  await deleteCases(cases.map((c) => c.id));
  await runQuery(
    `MATCH (u:User)-[:MEMBER_OF]->(f:Firm {id: $firmId})
     OPTIONAL MATCH (s:Session {userId: u.id}) DETACH DELETE s`,
    firm,
  );
  await runQuery("MATCH (i:Invite)-[:FOR_FIRM]->(:Firm {id: $firmId}) DETACH DELETE i", firm);
  await runQuery("MATCH (u:User)-[:MEMBER_OF]->(f:Firm {id: $firmId}) DETACH DELETE u, f", firm);
}

type Who = { id: string };
const para = (...lines: string[]) => lines.join("\n\n");

async function doc(
  caseId: string,
  input: { title: string; type: string; text: string; date?: string; filedOn?: string; hearingId?: string; filedById?: string; orderKind?: string },
) {
  const { document } = await createDocument(caseId, createDocumentBody.parse(input), undefined, { background: false });
  return document.id;
}

async function chunkId(documentId: string, label: string) {
  const row = await queryOne<{ id: string }>(
    "MATCH (:Document {id: $documentId})-[:HAS_CHUNK]->(c:Chunk {paraLabel: $label}) RETURN c.id AS id",
    { documentId, label },
  );
  if (!row) throw new Error(`seed: no paragraph ${label} in document ${documentId}`);
  return row.id;
}

async function segmentId(transcriptId: string, seq: number) {
  const row = await queryOne<{ id: string }>(
    "MATCH (:Transcript {id: $transcriptId})-[:HAS_SEGMENT]->(s:Segment {seq: $seq}) RETURN s.id AS id",
    { transcriptId, seq },
  );
  if (!row) throw new Error(`seed: no turn ${seq} in transcript ${transcriptId}`);
  return row.id;
}

async function subject(caseId: string, name: string, type: string) {
  const id = randomUUID();
  await runQuery(
    "CREATE (:Subject {id: $id, caseId: $caseId, name: $name, nameKey: toLower($name), type: $type, createdAt: $now})",
    { id, caseId, name, type, now: nowIso() },
  );
  return id;
}

/** Mirrors what claims.extractor writes. */
async function claim(c: {
  caseId: string;
  from: { label: "Chunk" | "Segment"; id: string };
  sourceType: "document" | "transcript";
  sourceId: string;
  hearingId?: string | null;
  statedOn: string;
  text: string;
  quote: string;
  kind: "allegation" | "denial" | "admission" | "fact" | "undertaking";
  madeBy?: Who | null;
  onBehalfOf?: Who | null;
  subjects: string[];
}) {
  const id = randomUUID();
  await runQuery(
    `MATCH (src:${c.from.label} {id: $srcId})
     CREATE (src)-[:CONTAINS]->(cl:Claim {id: $id, caseId: $caseId, text: $text, quote: $quote, quoteVerified: true, kind: $kind,
       eventDate: null, statedOn: $statedOn, sourceType: $sourceType, sourceId: $sourceId, hearingId: $hearingId, internal: false,
       superseded: false, createdBy: 'intake-agent', createdAt: $now})`,
    {
      srcId: c.from.id,
      id,
      caseId: c.caseId,
      text: c.text,
      quote: c.quote,
      kind: c.kind,
      statedOn: c.statedOn,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      hearingId: c.hearingId ?? null,
      now: nowIso(),
    },
  );
  if (c.madeBy) await runQuery("MATCH (cl:Claim {id: $id}), (p:Person {id: $pid}) CREATE (cl)-[:MADE_BY]->(p)", { id, pid: c.madeBy.id });
  if (c.onBehalfOf) {
    await runQuery("MATCH (cl:Claim {id: $id}), (p:Person {id: $pid}) CREATE (cl)-[:ON_BEHALF_OF]->(p)", { id, pid: c.onBehalfOf.id });
  }
  for (const sid of c.subjects) await runQuery("MATCH (cl:Claim {id: $id}), (s:Subject {id: $sid}) CREATE (cl)-[:ABOUT]->(s)", { id, sid });
  return id;
}

/** Mirrors the fact-check agent: newer claim -> earlier claim. */
async function link(
  type: "CONTRADICTS" | "DISPUTES" | "SUPPORTS",
  newer: string,
  older: string,
  p: { category: string; severity: "high" | "medium" | "low"; reason: string; fact: string; createdAt: string },
) {
  await runQuery(
    `MATCH (a:Claim {id: $newer}), (b:Claim {id: $older})
     CREATE (a)-[:${type} {id: $id, category: $category, severity: $severity, reason: $reason, fact: $fact,
       detectedBy: 'fact-check-agent', dismissed: false, crossPrep: false, createdAt: $createdAt}]->(b)`,
    { newer, older, id: randomUUID(), ...p },
  );
}

/** Mirrors directions.extractor (+ compliance links). */
async function direction(d: {
  caseId: string;
  orderId: string;
  paraLabel: string;
  hearingId: string;
  orderDate: string;
  text: string;
  kind: "direction" | "undertaking" | "costs" | "notice" | "stay";
  dueDate?: string | null;
  dueText?: string | null;
  to: Who[];
}) {
  const id = randomUUID();
  await runQuery(
    `MATCH (o:Document {id: $orderId}), (ch:Chunk {id: $chunkId})
     CREATE (o)-[:GIVES]->(d:Direction {id: $id, caseId: $caseId, sourceId: $orderId, hearingId: $hearingId, text: $text, kind: $kind,
       dueDate: $dueDate, dueText: $dueText, orderDate: $orderDate, status: 'pending', manualStatus: null, manualNote: null, manualAt: null,
       createdBy: 'intake-agent', createdAt: $now, updatedAt: $now}), (ch)-[:CONTAINS]->(d)`,
    {
      ...d,
      id,
      chunkId: await chunkId(d.orderId, d.paraLabel),
      dueDate: d.dueDate ?? null,
      dueText: d.dueText ?? null,
      now: nowIso(),
    },
  );
  for (const p of d.to) await runQuery("MATCH (d:Direction {id: $id}), (p:Person {id: $pid}) CREATE (d)-[:TO]->(p)", { id, pid: p.id });
  return id;
}

async function compliedBy(directionId: string, documentId: string, p: { onTime: boolean; daysLate: number; evidence: string; reason: string }) {
  await runQuery(
    `MATCH (d:Direction {id: $directionId}), (o:Document {id: $documentId})
     CREATE (d)-[:COMPLIED_BY {onTime: $onTime, daysLate: $daysLate, evidence: $evidence, reason: $reason, detectedBy: 'compliance-agent', createdAt: $now}]->(o)`,
    { directionId, documentId, ...p, now: nowIso() },
  );
}

async function vacatedBy(directionId: string, documentId: string, reason: string) {
  await runQuery(
    `MATCH (d:Direction {id: $directionId}), (o:Document {id: $documentId})
     CREATE (d)-[:VACATED_BY {reason: $reason, detectedBy: 'compliance-agent', createdAt: $now}]->(o)`,
    { directionId, documentId, reason, now: nowIso() },
  );
}

async function person(caseId: string, input: Record<string, unknown>) {
  return (await addPerson(caseId, addPersonBody.parse(input))).person;
}

async function hearing(caseId: string, input: Record<string, unknown>) {
  const h = (await createHearing(caseId, createHearingBody.parse(input))) as unknown as { hearing: { id: string } };
  return h.hearing.id;
}

// ---------------------------------------------------------------------------------------------

async function kumarVGupta(firmId: string) {
  const kase = await createCase(firmId, createCaseBody.parse({
    caseNumber: "CS 412/2020",
    title: "Ramesh Kumar v. Suresh Gupta",
    court: "Civil Judge (Senior Division)",
    caseType: "civil",
    stage: "Evidence",
    filedOn: "2020-07-20",
    description: "Suit for recovery of Rs. 5,00,000 paid in cash in March 2019.",
  }));
  const caseId = kase.id;

  const ramesh = await person(caseId, { kind: "party", name: "Ramesh Kumar", role: "plaintiff" });
  const suresh = await person(caseId, { kind: "party", name: "Suresh Gupta", role: "defendant" });
  await person(caseId, { kind: "lawyer", name: "Adv. Kavita Rao", representsId: ramesh.id });
  await person(caseId, { kind: "lawyer", name: "Adv. Imran Sheikh", representsId: suresh.id });
  const judge = await person(caseId, { kind: "judge", name: "Ms. Neha Verma" });
  await person(caseId, { kind: "witness", name: "Ramesh Kumar", code: "PW1", calledById: ramesh.id });
  const anil = await person(caseId, { kind: "witness", name: "Anil Sharma", code: "PW2", witnessType: "eye", calledById: ramesh.id });
  await person(caseId, { kind: "witness", name: "Suresh Gupta", code: "DW1", calledById: suresh.id });

  const H = async (date: string, purpose: string, extra: Record<string, unknown> = {}) =>
    hearing(caseId, { date, purpose, judgeId: judge.id, ...extra });
  const h1 = await H("2020-08-14", "Summons issued", { outcome: "Summons issued to the defendant." });
  const h2 = await H("2021-03-10", "Appearance of defendant", { outcome: "Defendant appeared. Time given for written statement." });
  const h3 = await H("2021-05-18", "Written statement", { outcome: "Written statement taken on record." });
  const h4 = await H("2021-11-02", "Framing of issues", { outcome: "Four issues framed. Status quo on the shop premises." });
  const h5 = await H("2022-04-21", "Plaintiff evidence: PW1 and PW2", { outcome: "Affidavits of PW1 and PW2 tendered. Deposit direction vacated." });
  const h6 = await H("2023-02-06", "Defendant evidence: affidavit of DW1", { outcome: "Affidavit of DW1 taken on record." });
  const h7 = await H("2024-07-19", "Cross-examination of PW1 Ramesh Kumar", { outcome: "Cross concluded. Listed for defendant evidence." });
  await H("2025-03-11", "Defendant evidence", {
    adjourned: true,
    adjournmentReason: "Counsel for the defendant sought time.",
    adjournedAtRequestOfId: suresh.id,
    outcome: "Adjourned at the request of the defendant, costs of Rs. 2,000.",
  });
  const h9 = await H("2026-09-15", "Orders on rejoinder and receipts", { outcome: "Rejoinder and receipts directed." });
  await H("2026-10-24", "Cross-examination of DW1 Suresh Gupta");
  const h8 = (await queryOne<{ id: string }>("MATCH (h:Hearing {caseId: $caseId, date: '2025-03-11'}) RETURN h.id AS id", { caseId }))!.id;
  void h1;

  // Documents ------------------------------------------------------------------------------
  const plaint = await doc(caseId, {
    title: "Plaint",
    type: "plaint",
    date: "2020-07-20",
    filedOn: "2020-07-20",
    filedById: ramesh.id,
    text: para(
      "IN THE COURT OF THE CIVIL JUDGE (SENIOR DIVISION)\nCS 412/2020\nRamesh Kumar ... Plaintiff\nVersus\nSuresh Gupta ... Defendant\nSUIT FOR RECOVERY OF RS. 5,00,000",
      "1. That the plaintiff and the defendant run shops in the same market and have known each other for over ten years.",
      "2. That the defendant approached the plaintiff in February 2019 for money to restock his shop.",
      "3. That the plaintiff paid Rs. 5,00,000 in cash to the defendant in March 2019 at the defendant's shop.",
      "4. That the defendant executed a promissory note dated 12.03.2019 acknowledging receipt of Rs. 5,00,000.",
      "5. That the defendant promised to return the amount by 31.12.2019.",
      "6. That no part of the said amount has been repaid till date despite repeated requests.",
      "7. That the cause of action arose on 31.12.2019 and continues.",
      "8. That a legal notice dated 02.06.2020 was duly served on the defendant, but no reply was received.",
    ),
  });
  const order1 = await doc(caseId, {
    title: "Order dated 10.03.2021",
    type: "order",
    orderKind: "procedural",
    hearingId: h2,
    text: para(
      "ORDER\nCS 412/2020",
      "1. Defendant appears through counsel Adv. Imran Sheikh.",
      "2. Defendant to file written statement within 30 days.",
      "3. List on 18.05.2021.",
    ),
  });
  const ws = await doc(caseId, {
    title: "Written statement",
    type: "written_statement",
    hearingId: h3,
    filedById: suresh.id,
    text: para(
      "IN THE COURT OF THE CIVIL JUDGE (SENIOR DIVISION)\nCS 412/2020\nWRITTEN STATEMENT ON BEHALF OF THE DEFENDANT",
      "1. That the defendant denies having received any payment of Rs. 5,00,000 from the plaintiff at any point of time.",
      "2. That the alleged promissory note dated 12.03.2019 is forged and fabricated, and the defendant never signed it.",
      "3. That the plaintiff and the defendant run shops in the same market, and the plaintiff has borne a grudge since a parking dispute in 2018.",
      "4. That the suit is barred by limitation and is liable to be dismissed on this ground alone.",
      "5. That no legal notice was ever served upon the defendant before the suit was filed.",
    ),
  });
  const order2 = await doc(caseId, {
    title: "Order dated 02.11.2021",
    type: "order",
    orderKind: "interim",
    hearingId: h4,
    text: para(
      "ORDER\nCS 412/2020",
      "1. Arguments on framing of issues heard.",
      "2. Issues framed: (i) Whether the plaintiff paid Rs. 5,00,000 to the defendant? OPP (ii) Whether the promissory note is genuine? OPP (iii) Whether the suit is within limitation? OPD (iv) Relief.",
      "3. Parties to lead evidence.",
      "4. Application of the plaintiff for interim relief allowed in part.",
      "5. Parties to maintain status quo regarding the shop premises till further orders.",
      "6. Defendant to deposit Rs. 1,00,000 with the court pending trial.",
    ),
  });
  const affPw2 = await doc(caseId, {
    title: "Affidavit of PW2 Anil Sharma",
    type: "affidavit",
    hearingId: h5,
    filedById: ramesh.id,
    text: para(
      "AFFIDAVIT OF PW2 ANIL SHARMA",
      "1. That I run a tailoring shop in the same market as both parties.",
      "2. That I am a friend of the plaintiff.",
      "3. That I was present when Ramesh Kumar handed over the cash to Suresh Gupta at his shop in March 2019.",
    ),
  });
  const order3 = await doc(caseId, {
    title: "Order dated 21.04.2022",
    type: "order",
    orderKind: "interim",
    hearingId: h5,
    text: para(
      "ORDER\nCS 412/2020",
      "1. Affidavits of PW1 and PW2 tendered in evidence.",
      "2. The direction dated 02.11.2021 to deposit Rs. 1,00,000 is vacated in view of the statement of the defendant.",
    ),
  });
  const affDw1 = await doc(caseId, {
    title: "Affidavit of DW1",
    type: "affidavit",
    hearingId: h6,
    filedById: suresh.id,
    text: para(
      "AFFIDAVIT OF DW1 SURESH GUPTA",
      "1. That I received the said amount in March 2019 as a friendly loan.",
      "2. That I have repaid Rs. 2,00,000 of the said loan in December 2019.",
      "3. That the plaintiff never asked for the money back before filing the suit.",
    ),
  });
  const expert = await doc(caseId, {
    title: "Handwriting expert report",
    type: "evidence",
    date: "2024-01-04",
    filedOn: "2024-01-04",
    text: para(
      "REPORT OF THE HANDWRITING EXPERT ON EX. P1",
      "1. The questioned signature on Ex. P1 (promissory note dated 12.03.2019) was compared with admitted signatures of the defendant.",
      "2. Specimen signatures were taken in court on 06.02.2023.",
      "3. The signature on Ex. P1 matches the admitted signature of the defendant.",
    ),
  });
  const order4 = await doc(caseId, {
    title: "Order dated 11.03.2025",
    type: "order",
    orderKind: "procedural",
    hearingId: h8,
    text: para(
      "ORDER\nCS 412/2020",
      "1. Counsel for the defendant seeks time. Adjourned at the request of the defendant subject to costs of Rs. 2,000 payable to the plaintiff.",
      "2. List for defendant evidence.",
    ),
  });
  const order5 = await doc(caseId, {
    title: "Order dated 15.09.2026",
    type: "order",
    orderKind: "procedural",
    hearingId: h9,
    text: para(
      "ORDER\nCS 412/2020",
      "1. Costs of Rs. 2,000 imposed on 11.03.2025 have been paid to the plaintiff.",
      "2. Plaintiff to file rejoinder to the written statement within three weeks.",
      "3. Defendant to produce the original receipts of the alleged repayment by 22.10.2026.",
      "4. List on 24.10.2026 for cross-examination of DW1.",
    ),
  });
  const passbook = await doc(caseId, {
    title: "Bank passbook, page 14",
    type: "evidence",
    date: "2019-03-12",
    filedOn: "2022-04-21",
    filedById: ramesh.id,
    text: para("PASSBOOK EXTRACT", "1. 12.03.2019 cash withdrawal Rs. 5,00,000."),
  });
  const note = await doc(caseId, {
    title: "Promissory note, 12.03.2019 (scan)",
    type: "evidence",
    date: "2019-03-12",
    filedOn: "2020-07-20",
    filedById: ramesh.id,
    text: "Ex. P1",
  });

  const { transcript } = await createTranscript(h7, {
    text: [
      "Court: Witness PW1 is present. Cross-examination by Ld. Counsel for Defendant.",
      "Ld. Counsel for Defendant: Did you hand over the cash personally?",
      "PW1: Yes. I gave Rs. 5,00,000 in cash at his shop in March 2019.",
      "Ld. Counsel for Defendant: Was anyone else present?",
      "PW1: My friend Anil Sharma was present when I gave the money.",
      "Ld. Counsel for Defendant: Is it correct that you never asked for the money back before 2020?",
      "PW1: I asked him many times in 2019. He returned Rs. 2,00,000 in December 2019.",
      "Court: Cross concluded. List for defendant evidence.",
    ].join("\n"),
  }, { background: false });
  const transcriptId = (transcript as { id: string }).id;

  return { caseId, ramesh, suresh, anil, judge, docs: { plaint, order1, ws, order2, affPw2, order3, affDw1, expert, order4, order5, passbook, note }, transcriptId, hearings: { h2, h3, h4, h5, h6, h7, h8, h9 } };
}

async function fillKumarAgentResults(k: Awaited<ReturnType<typeof kumarVGupta>>) {
  const { caseId, ramesh, suresh, anil, docs, transcriptId, hearings } = k;
  const pay = await subject(caseId, "Payment of Rs. 5,00,000", "payment");
  const rep = await subject(caseId, "Repayment", "payment");
  const pnote = await subject(caseId, "Promissory note", "document");
  const notice = await subject(caseId, "Legal notice", "event");
  const lim = await subject(caseId, "Limitation", "legal_issue");

  const fromDoc = async (documentId: string, label: string, statedOn: string, hearingId: string | null) => ({
    from: { label: "Chunk" as const, id: await chunkId(documentId, label) },
    sourceType: "document" as const,
    sourceId: documentId,
    hearingId,
    statedOn,
    caseId,
  });
  const fromTurn = async (seq: number) => ({
    from: { label: "Segment" as const, id: await segmentId(transcriptId, seq) },
    sourceType: "transcript" as const,
    sourceId: transcriptId,
    hearingId: hearings.h7,
    statedOn: "2024-07-19",
    caseId,
  });

  const pl3 = await claim({ ...(await fromDoc(docs.plaint, "3", "2020-07-20", null)), text: "Ramesh Kumar paid Rs. 5,00,000 in cash to Suresh Gupta in March 2019.", quote: "the plaintiff paid Rs. 5,00,000 in cash to the defendant in March 2019", kind: "allegation", madeBy: ramesh, subjects: [pay] });
  const pl4 = await claim({ ...(await fromDoc(docs.plaint, "4", "2020-07-20", null)), text: "Suresh Gupta signed a promissory note on 12.03.2019 acknowledging Rs. 5,00,000.", quote: "the defendant executed a promissory note dated 12.03.2019", kind: "allegation", madeBy: ramesh, subjects: [pnote, pay] });
  const pl6 = await claim({ ...(await fromDoc(docs.plaint, "6", "2020-07-20", null)), text: "No part of the Rs. 5,00,000 has been repaid.", quote: "no part of the said amount has been repaid till date", kind: "allegation", madeBy: ramesh, subjects: [rep] });
  const pl8 = await claim({ ...(await fromDoc(docs.plaint, "8", "2020-07-20", null)), text: "A legal notice dated 02.06.2020 was served on Suresh Gupta.", quote: "a legal notice dated 02.06.2020 was duly served on the defendant", kind: "allegation", madeBy: ramesh, subjects: [notice] });

  const ws1 = await claim({ ...(await fromDoc(docs.ws, "1", "2021-05-18", hearings.h3)), text: "Suresh Gupta never received Rs. 5,00,000 from Ramesh Kumar.", quote: "the defendant denies having received any payment of Rs. 5,00,000 from the plaintiff at any point of time", kind: "denial", madeBy: suresh, subjects: [pay] });
  const ws2 = await claim({ ...(await fromDoc(docs.ws, "2", "2021-05-18", hearings.h3)), text: "The promissory note of 12.03.2019 is forged; Suresh Gupta never signed it.", quote: "the alleged promissory note dated 12.03.2019 is forged and fabricated", kind: "denial", madeBy: suresh, subjects: [pnote] });
  await claim({ ...(await fromDoc(docs.ws, "3", "2021-05-18", hearings.h3)), text: "Ramesh Kumar has a grudge against Suresh Gupta since a 2018 parking dispute.", quote: "the plaintiff has borne a grudge since a parking dispute in 2018", kind: "allegation", madeBy: suresh, subjects: [] });
  await claim({ ...(await fromDoc(docs.ws, "4", "2021-05-18", hearings.h3)), text: "The suit is barred by limitation.", quote: "the suit is barred by limitation", kind: "allegation", madeBy: suresh, subjects: [lim] });
  const ws5 = await claim({ ...(await fromDoc(docs.ws, "5", "2021-05-18", hearings.h3)), text: "No legal notice was served on Suresh Gupta before the suit.", quote: "no legal notice was ever served upon the defendant", kind: "denial", madeBy: suresh, subjects: [notice] });

  const pw2 = await claim({ ...(await fromDoc(docs.affPw2, "3", "2022-04-21", hearings.h5)), text: "Anil Sharma saw Ramesh Kumar hand the cash to Suresh Gupta in March 2019.", quote: "I was present when Ramesh Kumar handed over the cash to Suresh Gupta", kind: "fact", madeBy: anil, onBehalfOf: ramesh, subjects: [pay] });

  const dw1 = await claim({ ...(await fromDoc(docs.affDw1, "1", "2023-02-06", hearings.h6)), text: "Suresh Gupta received the Rs. 5,00,000 in March 2019 as a friendly loan.", quote: "I received the said amount in March 2019 as a friendly loan", kind: "admission", madeBy: suresh, subjects: [pay] });
  const dw2 = await claim({ ...(await fromDoc(docs.affDw1, "2", "2023-02-06", hearings.h6)), text: "Suresh Gupta repaid Rs. 2,00,000 of the loan in December 2019.", quote: "I have repaid Rs. 2,00,000 of the said loan", kind: "admission", madeBy: suresh, subjects: [rep, pay] });

  const ex3 = await claim({ ...(await fromDoc(docs.expert, "3", "2024-01-04", null)), text: "The signature on the promissory note matches Suresh Gupta's admitted signature.", quote: "The signature on Ex. P1 matches the admitted signature of the defendant", kind: "fact", madeBy: null, subjects: [pnote] });

  const t3 = await claim({ ...(await fromTurn(3)), text: "Ramesh Kumar handed over Rs. 5,00,000 in cash at Suresh Gupta's shop in March 2019.", quote: "I gave Rs. 5,00,000 in cash at his shop in March 2019", kind: "fact", madeBy: ramesh, subjects: [pay] });
  const t5 = await claim({ ...(await fromTurn(5)), text: "Anil Sharma was present when the money was given.", quote: "My friend Anil Sharma was present when I gave the money", kind: "fact", madeBy: ramesh, subjects: [pay] });
  const t7 = await claim({ ...(await fromTurn(7)), text: "Suresh Gupta returned Rs. 2,00,000 in December 2019.", quote: "He returned Rs. 2,00,000 in December 2019", kind: "admission", madeBy: ramesh, subjects: [rep] });

  const fresh = "2026-10-12T05:14:00.000Z";
  const older = "2024-07-20T10:00:00.000Z";
  await link("CONTRADICTS", dw1, ws1, { category: "self", severity: "high", fact: "Whether Suresh Gupta received Rs. 5,00,000", reason: "He cannot both never have received the money and have received it as a loan.", createdAt: fresh });
  await link("CONTRADICTS", dw2, ws1, { category: "self", severity: "high", fact: "Whether Suresh Gupta received Rs. 5,00,000", reason: "Repaying part of “the said loan” assumes he received it.", createdAt: fresh });
  await link("CONTRADICTS", ex3, ws2, { category: "record", severity: "high", fact: "Whether Suresh Gupta signed the promissory note", reason: "The forensic report on record identifies his signature on the note he calls forged.", createdAt: fresh });
  await link("CONTRADICTS", t7, pl6, { category: "self", severity: "medium", fact: "Whether any amount was repaid", reason: "The plaintiff now admits a repayment his plaint said never happened.", createdAt: older });
  await link("DISPUTES", ws1, pl3, { category: "opposite", severity: "high", fact: "Whether Rs. 5,00,000 was paid", reason: "The plaintiff says he paid; the defendant denies receiving anything.", createdAt: older });
  await link("DISPUTES", ws2, pl4, { category: "opposite", severity: "high", fact: "Whether the promissory note is genuine", reason: "The plaintiff relies on the note; the defendant calls it forged.", createdAt: older });
  await link("DISPUTES", ws5, pl8, { category: "opposite", severity: "low", fact: "Whether a legal notice was served", reason: "The plaintiff says notice was served; the defendant denies it.", createdAt: older });
  await link("SUPPORTS", pw2, pl3, { category: "same_side", severity: "medium", fact: "Whether Rs. 5,00,000 was paid", reason: "An eyewitness confirms the cash payment.", createdAt: older });
  await link("SUPPORTS", t3, pl3, { category: "self", severity: "low", fact: "Whether Rs. 5,00,000 was paid", reason: "Repeats the plaint under cross-examination.", createdAt: older });
  await link("SUPPORTS", t5, pw2, { category: "same_side", severity: "low", fact: "Whether Rs. 5,00,000 was paid", reason: "Names the same eyewitness.", createdAt: older });
  await link("SUPPORTS", t7, dw2, { category: "opposite", severity: "medium", fact: "Whether Rs. 2,00,000 was repaid", reason: "Both sides now say Rs. 2,00,000 was returned in December 2019.", createdAt: older });

  // Directions and compliance
  const dWs = await direction({ caseId, orderId: docs.order1, paraLabel: "2", hearingId: hearings.h2, orderDate: "2021-03-10", text: "Defendant to file written statement within 30 days.", kind: "direction", dueDate: "2021-04-09", dueText: "within 30 days", to: [suresh] });
  await compliedBy(dWs, docs.ws, { onTime: false, daysLate: 39, evidence: "Written statement filed on 18.05.2021", reason: "Filed 39 days after the deadline." });
  await direction({ caseId, orderId: docs.order2, paraLabel: "5", hearingId: hearings.h4, orderDate: "2021-11-02", text: "Parties to maintain status quo regarding the shop premises till further orders.", kind: "stay", to: [ramesh, suresh] });
  const dDep = await direction({ caseId, orderId: docs.order2, paraLabel: "6", hearingId: hearings.h4, orderDate: "2021-11-02", text: "Defendant to deposit Rs. 1,00,000 with the court pending trial.", kind: "direction", to: [suresh] });
  await vacatedBy(dDep, docs.order3, "Vacated by order of 21.04.2022, para 2.");
  const dCosts = await direction({ caseId, orderId: docs.order4, paraLabel: "1", hearingId: hearings.h8, orderDate: "2025-03-11", text: "Costs of Rs. 2,000 on the defendant for seeking adjournment.", kind: "costs", to: [suresh] });
  await compliedBy(dCosts, docs.order5, { onTime: true, daysLate: 0, evidence: "Order 15.09.2026 para 1 records the costs as paid", reason: "Recorded as paid by the court." });
  await direction({ caseId, orderId: docs.order5, paraLabel: "2", hearingId: hearings.h9, orderDate: "2026-09-15", text: "Plaintiff to file rejoinder to the written statement within three weeks.", kind: "direction", dueDate: "2026-10-06", dueText: "within three weeks", to: [ramesh] });
  await direction({ caseId, orderId: docs.order5, paraLabel: "3", hearingId: hearings.h9, orderDate: "2026-09-15", text: "Defendant to produce the original receipts of the alleged repayment by 22.10.2026.", kind: "direction", dueDate: "2026-10-22", dueText: "by 22.10.2026", to: [suresh] });

  // Processing state the UI shows: everything analysed, except one waiting and one unreadable scan.
  await runQuery(
    `MATCH (d:Document {caseId: $caseId})
     OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:Chunk)-[:CONTAINS]->(c:Claim)
     WITH d, count(c) AS claims
     SET d.status = 'ready', d.analysis = 'done', d.note = null, d.analysisError = null, d.claimCount = claims,
         d.analyzedAt = coalesce(d.filedOn, d.date, $now)`,
    { caseId, now: nowIso() },
  );
  await runQuery(
    "MATCH (d:Document {id: $id}) SET d.analyzedAt = '2026-10-12T05:12:00.000Z'",
    { id: docs.affDw1 },
  );
  await runQuery(
    "MATCH (d:Document {id: $id}) SET d.status = 'extracted', d.analysis = 'pending', d.analysisError = 'Waiting for OPENAI_API_KEY', d.analyzedAt = null",
    { id: docs.passbook },
  );
  await runQuery("MATCH (:Document {id: $id})-[:HAS_CHUNK]->(c:Chunk) DETACH DELETE c", { id: docs.note });
  await runQuery(
    `MATCH (d:Document {id: $id}) SET d.status = 'stored', d.analysis = 'skipped', d.chunkCount = 0, d.source = 'file',
       d.mimeType = 'application/pdf', d.fileName = 'promissory-note-scan.pdf', d.analyzedAt = null,
       d.note = 'Scanned PDF with no text layer. Upload a clearer copy or paste the text.'`,
    { id: docs.note },
  );
  await runQuery(
    `MATCH (t:Transcript {id: $id})
     OPTIONAL MATCH (t)-[:HAS_SEGMENT]->(:Segment)-[:CONTAINS]->(c:Claim)
     WITH t, count(c) AS claims
     SET t.status = 'ready', t.analysis = 'done', t.note = null, t.analysisError = null, t.claimCount = claims, t.analyzedAt = '2024-07-20T09:00:00.000Z'`,
    { id: transcriptId },
  );
}

async function otherCases(firmId: string, kumarCaseId: string): Promise<string[]> {
  // Counter-suit, linked to the main case.
  const g = await createCase(firmId, createCaseBody.parse({ caseNumber: "CS 98/2022", title: "Suresh Gupta v. Ramesh Kumar", court: "Civil Judge (Senior Division)", caseType: "civil", stage: "Evidence", filedOn: "2022-02-14" }));
  await person(g.id, { kind: "party", name: "Suresh Gupta", role: "plaintiff" });
  await person(g.id, { kind: "party", name: "Ramesh Kumar", role: "defendant" });
  await hearing(g.id, { date: "2022-03-30", purpose: "Appearance" });
  await hearing(g.id, { date: "2026-10-24", purpose: "Evidence" });
  await linkCases(kumarCaseId, g.id, "Counter-suit over the same payment");

  // Consumer complaint with unpaid costs.
  const iyer = await createCase(firmId, createCaseBody.parse({ caseNumber: "CC 88/2023", title: "Meera Iyer v. Coastal Builders Pvt. Ltd.", court: "District Consumer Commission", caseType: "civil", stage: "Arguments", filedOn: "2023-05-02" }));
  const meera = await person(iyer.id, { kind: "party", name: "Meera Iyer", role: "complainant" });
  const coastal = await person(iyer.id, { kind: "party", name: "Coastal Builders Pvt. Ltd.", role: "respondent" });
  void meera;
  const ih = await hearing(iyer.id, { date: "2026-08-20", purpose: "Arguments", adjourned: true, adjournedAtRequestOfId: coastal.id });
  await hearing(iyer.id, { date: "2026-11-05", purpose: "Arguments" });
  const iorder = await doc(iyer.id, {
    title: "Order dated 20.08.2026",
    type: "order",
    orderKind: "procedural",
    hearingId: ih,
    text: para("ORDER\nCC 88/2023", "1. Adjourned at the request of the opposite party subject to costs of Rs. 5,000 payable within 30 days.", "2. List on 05.11.2026 for arguments."),
  });
  await direction({ caseId: iyer.id, orderId: iorder, paraLabel: "1", hearingId: ih, orderDate: "2026-08-20", text: "Opposite party to pay costs of Rs. 5,000 within 30 days.", kind: "costs", dueDate: "2026-09-19", dueText: "within 30 days", to: [coastal] });

  const patel = await createCase(firmId, createCaseBody.parse({ caseNumber: "COMS 17/2024", title: "Patel Textiles v. Union Bank", court: "Commercial Court", caseType: "civil", stage: "Pleadings", filedOn: "2024-06-11" }));
  await person(patel.id, { kind: "party", name: "Patel Textiles", role: "plaintiff" });
  await person(patel.id, { kind: "party", name: "Union Bank", role: "defendant" });
  await hearing(patel.id, { date: "2026-11-12", purpose: "Completion of pleadings" });

  for (const id of [g.id, iyer.id, patel.id]) {
    await runQuery(
      "MATCH (d:Document {caseId: $id}) SET d.status = 'ready', d.analysis = 'done', d.note = null, d.analysisError = null, d.analyzedAt = coalesce(d.filedOn, d.date)",
      { id },
    );
  }
  return [g.id, iyer.id, patel.id];
}

/**
 * A criminal case linked to Kumar v. Gupta: the FIR for the same payment, and a prosecution witness
 * whose deposition does not match it (the "witness against the FIR" finding).
 */
async function stateVGupta(firmId: string, kumarCaseId: string): Promise<string> {
  const kase = await createCase(firmId, createCaseBody.parse({
    caseNumber: "FIR 214/2021 / SC 310/2022",
    title: "State v. Suresh Gupta",
    court: "Additional Sessions Judge, Tis Hazari",
    caseType: "criminal",
    stage: "Prosecution evidence",
    filedOn: "2021-09-03",
  }));
  const caseId = kase.id;
  const ramesh = await person(caseId, { kind: "party", name: "Ramesh Kumar", role: "complainant" });
  const suresh = await person(caseId, { kind: "party", name: "Suresh Gupta", role: "accused" });
  await person(caseId, { kind: "lawyer", name: "Adv. Mohit Chawla", representsId: suresh.id });
  const judge = await person(caseId, { kind: "judge", name: "Mr. Arvind Saxena" });
  const anil = await person(caseId, { kind: "witness", name: "Anil Sharma", code: "PW2", witnessType: "eye", calledById: ramesh.id });
  void judge;

  const h1 = await hearing(caseId, { date: "2021-10-05", purpose: "Cognizance" });
  const h2 = await hearing(caseId, { date: "2023-04-18", purpose: "Prosecution evidence", appearances: [{ personId: anil.id, present: true }] });
  await hearing(caseId, { date: "2026-11-18", purpose: "Prosecution evidence" });
  void h1;

  const fir = await doc(caseId, {
    title: "FIR No. 214/2021",
    type: "fir",
    date: "2021-09-03",
    filedById: ramesh.id,
    text: para(
      "FIRST INFORMATION REPORT\nFIR No. 214/2021, PS Karol Bagh. Sections 406, 420 IPC.",
      "1. That the complainant Ramesh Kumar paid Rs. 5,00,000 in cash to Suresh Gupta on 12.03.2019 at the accused's shop in Karol Bagh, in the presence of Anil Sharma.",
      "2. That the accused signed a promissory note for Rs. 5,00,000 the same day and has since refused to repay the amount.",
      "3. That the accused has thereby cheated the complainant and committed criminal breach of trust.",
    ),
  });
  const dep = await doc(caseId, {
    title: "Deposition of PW2 Anil Sharma",
    type: "deposition",
    date: "2023-04-18",
    filedOn: "2023-04-18",
    hearingId: h2,
    text: para(
      "DEPOSITION OF PW2 ANIL SHARMA\nExamination in chief, 18.04.2023.",
      "1. I know the complainant Ramesh Kumar and the accused Suresh Gupta.",
      "2. I was present at the accused's shop on 20.03.2019 when Ramesh Kumar handed over Rs. 5,00,000 in cash to Suresh Gupta.",
      "3. I did not see Suresh Gupta sign any document at the shop.",
    ),
  });
  const order = await doc(caseId, {
    title: "Order dated 18.04.2023",
    type: "order",
    orderKind: "procedural",
    hearingId: h2,
    text: para(
      "ORDER\nSC 310/2022, 18.04.2023",
      "1. PW2 Anil Sharma examined in chief. Cross-examination deferred.",
      "2. The prosecution shall produce the original promissory note on or before the next date of hearing.",
      "3. List on 18.11.2026 for prosecution evidence.",
    ),
  });

  const pay = await subject(caseId, "Payment of Rs. 5,00,000", "payment");
  const note = await subject(caseId, "Promissory note", "document");
  const fromDoc = async (documentId: string, label: string, statedOn: string, hearingId: string | null) => ({
    from: { label: "Chunk" as const, id: await chunkId(documentId, label) },
    sourceType: "document" as const,
    sourceId: documentId,
    hearingId,
    statedOn,
    caseId,
  });
  const f1 = await claim({ ...(await fromDoc(fir, "1", "2021-09-03", null)), text: "Ramesh Kumar paid Rs. 5,00,000 in cash to Suresh Gupta on 12.03.2019 at his shop, in the presence of Anil Sharma.", quote: "paid Rs. 5,00,000 in cash to Suresh Gupta on 12.03.2019", kind: "allegation", madeBy: ramesh, subjects: [pay] });
  const f2 = await claim({ ...(await fromDoc(fir, "2", "2021-09-03", null)), text: "Suresh Gupta signed a promissory note for Rs. 5,00,000 on the same day and has refused to repay it.", quote: "signed a promissory note for Rs. 5,00,000 the same day", kind: "allegation", madeBy: ramesh, subjects: [note, pay] });
  const d2 = await claim({ ...(await fromDoc(dep, "2", "2023-04-18", h2)), text: "Anil Sharma saw Ramesh Kumar hand over Rs. 5,00,000 in cash to Suresh Gupta at the shop on 20.03.2019.", quote: "on 20.03.2019 when Ramesh Kumar handed over Rs. 5,00,000 in cash", kind: "fact", madeBy: anil, onBehalfOf: ramesh, subjects: [pay] });
  const d3 = await claim({ ...(await fromDoc(dep, "3", "2023-04-18", h2)), text: "Anil Sharma did not see Suresh Gupta sign any document at the shop.", quote: "I did not see Suresh Gupta sign any document", kind: "fact", madeBy: anil, onBehalfOf: ramesh, subjects: [note] });
  await link("CONTRADICTS", d2, f1, { category: "record", severity: "high", fact: "Date of the payment", reason: "The FIR says the cash was paid on 12.03.2019, but PW2 places it on 20.03.2019.", createdAt: "2023-04-18T10:00:00.000Z" });
  await link("CONTRADICTS", d3, f2, { category: "record", severity: "medium", fact: "Whether a document was signed", reason: "The FIR says a promissory note was signed that day; PW2 saw no document signed.", createdAt: "2023-04-18T10:00:01.000Z" });

  await direction({
    caseId, orderId: order, paraLabel: "2", hearingId: h2, orderDate: "2023-04-18",
    text: "Prosecution to produce the original promissory note on or before the next date of hearing.",
    kind: "direction", dueDate: "2026-11-18", dueText: "before the next date", to: [ramesh],
  });
  await runQuery("MATCH (o:Document {id: $id}) SET o.summary = $summary, o.nextDate = '2026-11-18'", {
    id: order,
    summary: "PW2 examined in chief; the prosecution is to produce the original promissory note before the next date.",
  });
  await runQuery(
    `MATCH (d:Document {caseId: $caseId})
     OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:Chunk)-[:CONTAINS]->(c:Claim)
     WITH d, count(c) AS claims
     SET d.status = 'ready', d.analysis = 'done', d.note = null, d.analysisError = null, d.claimCount = claims,
         d.analyzedAt = coalesce(d.filedOn, d.date)`,
    { caseId },
  );
  await linkCases(kumarCaseId, caseId, "FIR for cheating over the same Rs. 5,00,000 payment");
  return caseId;
}

/**
 * Embeds the demo text (document passages, transcript turns, claims) so the Q&A agent can search it
 * by meaning. Only vectors are written; statuses stay as the seed set them.
 */
export async function embedDemoCases(caseIds: string[]) {
  for (const label of ["Chunk", "Segment", "Claim"] as const) {
    const rows = await runQuery<{ id: string; text: string }>(
      `MATCH (n:${label}) WHERE n.caseId IN $ids AND n.embedding IS NULL RETURN n.id AS id, n.text AS text`,
      { ids: caseIds },
    );
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      const vectors = await embedTexts(batch.map((r) => r.text.slice(0, 6000)));
      await runQuery(`UNWIND $rows AS row MATCH (n:${label} {id: row.id}) SET n.embedding = vecf32(row.vec)`, {
        rows: batch.map((r, j) => ({ id: r.id, vec: vectors[j]! })),
      });
    }
  }
}

/**
 * Adds the demo cases to a firm: the same data as `npm run seed`, but into an existing firm. Nothing
 * is queued for the agents (their results are written directly). With an OpenAI key the text is
 * embedded in the background so questions work; that is the only AI call.
 * Does nothing if the firm already has them; removes what it created if something goes wrong.
 */
export async function loadDemoCases(firmId: string): Promise<{ loaded: boolean; caseId: string | null }> {
  const existing = await queryOne<{ id: string }>("MATCH (c:Case {firmId: $firmId, demo: true}) RETURN c.id AS id LIMIT 1", { firmId });
  if (existing) return { loaded: false, caseId: existing.id };

  const created: string[] = [];
  try {
    const kumar = await kumarVGupta(firmId);
    created.push(kumar.caseId);
    created.push(...(await otherCases(firmId, kumar.caseId)));
    created.push(await stateVGupta(firmId, kumar.caseId));
    await fillKumarAgentResults(kumar);
    await runQuery("MATCH (c:Case) WHERE c.id IN $ids SET c.demo = true", { ids: created });
    // Questions need the text searchable. Done in the background, so loading stays instant.
    if (isAIEnabled()) {
      enqueue(`embed:demo:${firmId}`, async () => embedDemoCases(created));
    }
    return { loaded: true, caseId: kumar.caseId };
  } catch (e) {
    await deleteCases(created);
    throw e;
  }
}

/** Builds the demo firm. Expects FalkorDB to be connected and the schema initialised. */
export async function seed() {
  await wipeDemo();
  const user = await register({ name: "Kavita Rao", email: DEMO_EMAIL, password: DEMO_PASSWORD, firmName: "Rao & Associates" });
  const { caseId } = await loadDemoCases(user.firmId);
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, firmId: user.firmId, caseId: caseId! };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { connectFalkorDB, disconnectFalkorDB } = await import("../common/db/index.js");
  const { initGraphSchema } = await import("../module/graph/index.js");
  await connectFalkorDB();
  await initGraphSchema();
  const out = await seed();
  console.log(`\nDemo ready. Sign in with ${out.email} / ${out.password}\n`);
  await disconnectFalkorDB();
  process.exit(0);
}
