import { randomUUID } from "node:crypto";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError, todayIST } from "../../common/utils/index.js";
import { requireCase } from "../case/index.js";
import type { CreateHearingInput, UpdateHearingInput } from "./hearing.schema.js";

export interface HearingNode {
  id: string;
  caseId: string;
  date: string;
  purpose: string | null;
  status: "scheduled" | "held";
  courtRoom: string | null;
  adjourned: boolean;
  adjournmentReason: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

const today = todayIST;

export async function requireHearing(hearingId: string): Promise<HearingNode> {
  const row = await queryOne<{ h: HearingNode }>("MATCH (h:Hearing {id: $hearingId}) RETURN h {.*} AS h", { hearingId });
  if (!row) throw ApiError.notFound("Hearing not found");
  return row.h;
}

/** Every person referenced by a hearing must belong to its case, with the right kind. */
async function checkPeople(caseId: string, input: Partial<CreateHearingInput>) {
  const checks: [string | undefined, string, string][] = [
    [input.judgeId, "Judge", "judgeId"],
    [input.adjournedAtRequestOfId, "Party", "adjournedAtRequestOfId"],
  ];
  for (const [id, label, field] of checks) {
    if (!id) continue;
    const found = await queryOne(`MATCH (p:${label} {id: $id, caseId: $caseId}) RETURN p.id AS id`, { id, caseId });
    if (!found) throw ApiError.badRequest(`${field}: no ${label.toLowerCase()} with this id in the case`);
  }
  const ids = [...new Set((input.appearances ?? []).map((a) => a.personId))];
  if (ids.length) {
    const row = await queryOne<{ n: number }>(
      "MATCH (p:Person {caseId: $caseId}) WHERE p.id IN $ids RETURN count(p) AS n",
      { caseId, ids },
    );
    if (row!.n !== ids.length) throw ApiError.badRequest("appearances: some people are not part of this case");
  }
}

async function assertDateFree(caseId: string, date: string, exceptId?: string) {
  const clash = await queryOne(
    "MATCH (h:Hearing {caseId: $caseId, date: $date}) WHERE h.id <> $exceptId RETURN h.id AS id",
    { caseId, date, exceptId: exceptId ?? "" },
  );
  if (clash) throw ApiError.conflict(`A hearing on ${date} already exists for this case`);
}

/** Rebuilds the (Hearing)-[:NEXT]->(Hearing) chain in date order for one case. */
async function rebuildTimeline(caseId: string) {
  await runQuery("MATCH (:Case {id: $caseId})-[:HAS_HEARING]->(:Hearing)-[r:NEXT]->() DELETE r", { caseId });
  await runQuery(
    `MATCH (:Case {id: $caseId})-[:HAS_HEARING]->(h:Hearing)
     WITH h ORDER BY h.date
     WITH collect(h) AS hs
     UNWIND range(0, size(hs) - 2) AS i
     WITH hs[i] AS a, hs[i + 1] AS b
     CREATE (a)-[:NEXT]->(b)`,
    { caseId },
  );
}

/** Replaces judge / adjournment / appearance edges with what the input says. */
async function writeRelations(hearingId: string, input: Partial<CreateHearingInput>) {
  if (input.judgeId !== undefined) {
    await runQuery("MATCH (h:Hearing {id: $hearingId})-[r:PRESIDED_BY]->() DELETE r", { hearingId });
    await runQuery(
      "MATCH (h:Hearing {id: $hearingId}), (j:Judge {id: $judgeId}) CREATE (h)-[:PRESIDED_BY]->(j)",
      { hearingId, judgeId: input.judgeId },
    );
  }
  if (input.adjournedAtRequestOfId !== undefined) {
    await runQuery("MATCH (h:Hearing {id: $hearingId})-[r:ADJOURNED_AT_REQUEST_OF]->() DELETE r", { hearingId });
    await runQuery(
      "MATCH (h:Hearing {id: $hearingId}), (p:Party {id: $partyId}) CREATE (h)-[:ADJOURNED_AT_REQUEST_OF]->(p)",
      { hearingId, partyId: input.adjournedAtRequestOfId },
    );
  }
  if (input.appearances !== undefined) {
    await runQuery("MATCH (:Person)-[r:APPEARED_IN]->(:Hearing {id: $hearingId}) DELETE r", { hearingId });
    await runQuery(
      `UNWIND $appearances AS a
       MATCH (p:Person {id: a.personId}), (h:Hearing {id: $hearingId})
       CREATE (p)-[:APPEARED_IN {present: a.present}]->(h)`,
      { hearingId, appearances: input.appearances },
    );
  }
}

export async function createHearing(caseId: string, input: CreateHearingInput) {
  await requireCase(caseId);
  await assertDateFree(caseId, input.date);
  await checkPeople(caseId, input);

  const id = randomUUID();
  const now = nowIso();
  await runQuery(
    `MATCH (c:Case {id: $caseId})
     CREATE (c)-[:HAS_HEARING]->(h:Hearing {id: $id, caseId: $caseId, date: $date, purpose: $purpose, status: $status,
       courtRoom: $courtRoom, adjourned: $adjourned, adjournmentReason: $adjournmentReason, outcome: $outcome,
       createdAt: $now, updatedAt: $now})`,
    {
      caseId,
      id,
      date: input.date,
      purpose: input.purpose ?? null,
      status: input.status ?? (input.date <= today() ? "held" : "scheduled"),
      courtRoom: input.courtRoom ?? null,
      adjourned: input.adjourned ?? false,
      adjournmentReason: input.adjournmentReason ?? null,
      outcome: input.outcome ?? null,
      now,
    },
  );
  await writeRelations(id, input);
  await rebuildTimeline(caseId);
  return getHearing(id);
}

export async function updateHearing(hearingId: string, input: UpdateHearingInput) {
  const h = await requireHearing(hearingId);
  if (input.date && input.date !== h.date) await assertDateFree(h.caseId, input.date, hearingId);
  await checkPeople(h.caseId, input);

  const { judgeId: _j, adjournedAtRequestOfId: _a, appearances: _p, ...fields } = input;
  await runQuery("MATCH (h:Hearing {id: $hearingId}) SET h += $fields, h.updatedAt = $now", {
    hearingId,
    fields,
    now: nowIso(),
  });
  await writeRelations(hearingId, input);
  if (input.date) await rebuildTimeline(h.caseId);
  return getHearing(hearingId);
}

/** Case timeline: every hearing in date order with what is attached to it. */
export async function listHearings(caseId: string) {
  await requireCase(caseId);
  return runQuery(
    `MATCH (:Case {id: $caseId})-[:HAS_HEARING]->(h:Hearing)
     OPTIONAL MATCH (h)-[:PRESIDED_BY]->(j:Judge)
     OPTIONAL MATCH (d:Document)-[:SUBMITTED_IN]->(h)
     WITH h, j, count(d) AS documents, sum(CASE WHEN d.type = 'order' THEN 1 ELSE 0 END) AS orders
     OPTIONAL MATCH (h)-[:RECORDED_IN]->(t:Transcript {current: true})
     RETURN h {.*} AS hearing, j.name AS judge, documents, orders, t IS NOT NULL AS hasTranscript
     ORDER BY h.date`,
    { caseId },
  );
}

/** One hearing with judge, attendance, documents, transcript and its neighbours on the timeline. */
export async function getHearing(hearingId: string) {
  await requireHearing(hearingId);
  const row = await queryOne(
    `MATCH (c:Case)-[:HAS_HEARING]->(h:Hearing {id: $hearingId})
     OPTIONAL MATCH (h)-[:PRESIDED_BY]->(j:Judge)
     OPTIONAL MATCH (h)-[:ADJOURNED_AT_REQUEST_OF]->(ap:Party)
     OPTIONAL MATCH (prev:Hearing)-[:NEXT]->(h)
     OPTIONAL MATCH (h)-[:NEXT]->(next:Hearing)
     RETURN h {.*} AS hearing,
            c {.id, .caseNumber, .title} AS case,
            CASE WHEN j IS NULL THEN NULL ELSE {id: j.id, name: j.name} END AS judge,
            CASE WHEN ap IS NULL THEN NULL ELSE {id: ap.id, name: ap.name} END AS adjournedAtRequestOf,
            CASE WHEN prev IS NULL THEN NULL ELSE {id: prev.id, date: prev.date} END AS previous,
            CASE WHEN next IS NULL THEN NULL ELSE {id: next.id, date: next.date} END AS next`,
    { hearingId },
  );
  const [appearances, documents, transcript] = await Promise.all([
    runQuery(
      `MATCH (p:Person)-[a:APPEARED_IN]->(:Hearing {id: $hearingId})
       RETURN p.id AS id, p.name AS name, [l IN labels(p) WHERE l <> 'Person'][0] AS kind, a.present AS present
       ORDER BY kind, name`,
      { hearingId },
    ),
    runQuery(
      `MATCH (d:Document)-[:SUBMITTED_IN]->(:Hearing {id: $hearingId})
       RETURN d {.id, .title, .type, .date, .status, .orderKind, .fileUrl} AS document ORDER BY d.date`,
      { hearingId },
    ),
    queryOne(
      `MATCH (:Hearing {id: $hearingId})-[:RECORDED_IN]->(t:Transcript {current: true})
       RETURN t {.id, .version, .status, .segmentCount, .createdAt} AS transcript`,
      { hearingId },
    ),
  ]);
  return { ...row, appearances, documents: documents.map((d) => d.document), transcript: transcript?.transcript ?? null };
}
