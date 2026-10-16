import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import { requireCase } from "../case/index.js";
import { STANDING_KINDS } from "./compliance.agent.js";

export const DIRECTION_STATES = ["pending", "overdue", "complied", "in_force", "vacated"] as const;
export type DirectionState = (typeof DIRECTION_STATES)[number];
export const MANUAL_STATUSES = ["complied", "not_complied", "vacated", "auto"] as const;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Every direction of a case with its state, worked out from the graph each time:
 * a lawyer's manual status wins, then VACATED_BY, then COMPLIED_BY, then standing obligations
 * are "in force", then the due date decides overdue / pending.
 */
export async function listDirections(caseId: string, state?: DirectionState) {
  await requireCase(caseId);
  return runQuery(
    `MATCH (o:Document)-[:GIVES]->(d:Direction {caseId: $caseId})
     OPTIONAL MATCH (d)-[:TO]->(p:Person)
     OPTIONAL MATCH (ch:Chunk)-[:CONTAINS]->(d)
     OPTIONAL MATCH (d)-[cb:COMPLIED_BY]->(cd:Document)
     OPTIONAL MATCH (d)-[vb:VACATED_BY]->(vd:Document)
     OPTIONAL MATCH (d)-[nc:NONCOMPLIANCE_RECORDED_IN]->(nd:Document)
     OPTIONAL MATCH (h:Hearing {id: d.hearingId})
     WITH d, o, ch, h, cb, cd, vb, vd, collect(DISTINCT {id: p.id, name: p.name}) AS assignees,
          collect(DISTINCT CASE WHEN nd IS NULL THEN NULL ELSE {documentId: nd.id, title: nd.title, date: nd.date, quote: nc.quote} END) AS noncompliance
     WITH d, o, ch, h, cb, cd, vb, vd, assignees, noncompliance,
          CASE
            WHEN d.manualStatus = 'complied' THEN 'complied'
            WHEN d.manualStatus = 'vacated' THEN 'vacated'
            WHEN d.manualStatus IS NULL AND vd IS NOT NULL THEN 'vacated'
            WHEN d.manualStatus IS NULL AND cd IS NOT NULL THEN 'complied'
            WHEN d.kind IN $standing THEN 'in_force'
            WHEN d.dueDate IS NOT NULL AND d.dueDate < $today THEN 'overdue'
            ELSE 'pending'
          END AS state
     WHERE $state IS NULL OR state = $state
     RETURN d {.id, .text, .kind, .dueDate, .dueText, .orderDate} AS direction, state,
            [a IN assignees WHERE a.id IS NOT NULL] AS assignedTo,
            {documentId: o.id, title: o.title, page: ch.page, paraLabel: ch.paraLabel, hearingDate: h.date} AS order,
            CASE WHEN cd IS NULL OR d.manualStatus IS NOT NULL THEN NULL
                 ELSE {documentId: cd.id, title: cd.title, date: cd.date, evidence: cb.evidence, onTime: cb.onTime,
                       daysLate: cb.daysLate, reason: cb.reason} END AS compliedBy,
            CASE WHEN vd IS NULL THEN NULL ELSE {documentId: vd.id, title: vd.title, date: vd.date, reason: vb.reason} END AS vacatedBy,
            [n IN noncompliance WHERE n IS NOT NULL] AS noncomplianceRecorded,
            CASE WHEN d.manualStatus IS NULL THEN NULL
                 ELSE {status: d.manualStatus, note: d.manualNote, at: d.manualAt, by: 'lawyer'} END AS manual
     ORDER BY d.dueDate, d.orderDate`,
    { caseId, state: state ?? null, today: today(), standing: STANDING_KINDS },
  );
}

/** Lawyer's override. "auto" removes it and hands the direction back to the agent. */
export async function setManualStatus(directionId: string, status: (typeof MANUAL_STATUSES)[number], note?: string) {
  const d = await queryOne<{ caseId: string }>("MATCH (d:Direction {id: $directionId}) RETURN d.caseId AS caseId", {
    directionId,
  });
  if (!d) throw ApiError.notFound("Direction not found");
  await runQuery(
    `MATCH (d:Direction {id: $directionId})
     SET d.manualStatus = $status, d.manualNote = $note, d.manualAt = $at, d.updatedAt = $now`,
    {
      directionId,
      status: status === "auto" ? null : status,
      note: status === "auto" ? null : (note ?? null),
      at: status === "auto" ? null : nowIso(),
      now: nowIso(),
    },
  );
  const rows = await listDirections(d.caseId);
  return rows.find((r) => (r.direction as { id: string }).id === directionId);
}

/**
 * The compliance picture before the next date: what is overdue, what falls due before the next
 * hearing, what was done (on time or late), standing obligations, and a per-party record.
 */
export async function complianceReport(caseId: string) {
  const all = await listDirections(caseId);
  const next = await queryOne<{ date: string; purpose: string | null; id: string }>(
    `MATCH (:Case {id: $caseId})-[:HAS_HEARING]->(h:Hearing)
     WHERE h.date >= $today RETURN h.id AS id, h.date AS date, h.purpose AS purpose ORDER BY h.date LIMIT 1`,
    { caseId, today: today() },
  );
  type Row = (typeof all)[number] & {
    state: DirectionState;
    direction: { dueDate: string | null };
    assignedTo: { id: string; name: string }[];
    compliedBy: { onTime: boolean | null; daysLate: number } | null;
  };
  const rows = all as Row[];

  const parties = await runQuery<{ id: string; name: string; role: string; adjournments: number }>(
    `MATCH (p:Party {caseId: $caseId})-[pi:PARTY_IN]->(:Case)
     OPTIONAL MATCH (h:Hearing)-[:ADJOURNED_AT_REQUEST_OF]->(p)
     RETURN p.id AS id, p.name AS name, pi.role AS role, count(h) AS adjournments`,
    { caseId },
  );
  const byParty = parties.map((p) => {
    const mine = rows.filter((r) => r.assignedTo.some((a) => a.id === p.id) && r.state !== "in_force");
    return {
      party: { id: p.id, name: p.name, role: p.role },
      directions: mine.length,
      compliedOnTime: mine.filter((r) => r.state === "complied" && r.compliedBy?.onTime === true).length,
      compliedLate: mine.filter((r) => r.state === "complied" && (r.compliedBy?.daysLate ?? 0) > 0).length,
      overdue: mine.filter((r) => r.state === "overdue").length,
      pending: mine.filter((r) => r.state === "pending").length,
      adjournmentsSought: p.adjournments,
    };
  });

  return {
    nextHearing: next,
    overdue: rows.filter((r) => r.state === "overdue"),
    dueBeforeNextHearing: next
      ? rows.filter((r) => r.state === "pending" && r.direction.dueDate !== null && r.direction.dueDate <= next.date)
      : [],
    pending: rows.filter((r) => r.state === "pending"),
    complied: rows.filter((r) => r.state === "complied"),
    inForce: rows.filter((r) => r.state === "in_force"),
    vacated: rows.filter((r) => r.state === "vacated"),
    byParty,
  };
}
