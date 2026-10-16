import { runQuery } from "../../common/db/index.js";
import { requireCase } from "../case/index.js";

export interface ClaimFilter {
  personId?: string; // made by, or on behalf of
  subjectId?: string;
  sourceId?: string; // document or transcript
  includeSuperseded?: boolean;
  ids?: string[]; // exact claims (used by the fact-check views)
}

/**
 * Claims with everything needed to cite them: who said it, about what, and exactly where
 * (document page/para, or hearing date and turn number).
 */
export async function listClaims(caseId: string, f: ClaimFilter = {}) {
  await requireCase(caseId);
  return runQuery(
    `MATCH (c:Claim {caseId: $caseId})
     WHERE ($includeSuperseded OR c.superseded = false)
       AND ($ids IS NULL OR c.id IN $ids)
       AND ($sourceId IS NULL OR c.sourceId = $sourceId)
       AND ($personId IS NULL OR (c)-[:MADE_BY|ON_BEHALF_OF]->(:Person {id: $personId}))
       AND ($subjectId IS NULL OR (c)-[:ABOUT]->(:Subject {id: $subjectId}))
     OPTIONAL MATCH (c)-[:MADE_BY]->(m:Person)
     OPTIONAL MATCH (c)-[:ON_BEHALF_OF]->(ob:Person)
     OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(ch:Chunk)-[:CONTAINS]->(c)
     OPTIONAL MATCH (sg:Segment)-[:CONTAINS]->(c)
     OPTIONAL MATCH (h:Hearing {id: c.hearingId})
     OPTIONAL MATCH (c)-[:ABOUT]->(s:Subject)
     WITH c, m, ob, ch, d, sg, h, collect(DISTINCT {id: s.id, name: s.name, type: s.type}) AS subjects
     RETURN c {.id, .text, .quote, .quoteVerified, .kind, .eventDate, .statedOn, .internal, .superseded} AS claim,
            CASE WHEN m IS NULL THEN NULL ELSE {id: m.id, name: m.name, kind: [l IN labels(m) WHERE l <> 'Person'][0]} END AS madeBy,
            CASE WHEN ob IS NULL THEN NULL ELSE {id: ob.id, name: ob.name} END AS onBehalfOf,
            [x IN subjects WHERE x.id IS NOT NULL] AS subjects,
            CASE WHEN ch IS NOT NULL
              THEN {type: 'document', documentId: d.id, title: d.title, docType: d.type, page: ch.page, para: ch.para, paraLabel: ch.paraLabel}
              ELSE {type: 'transcript', hearingId: h.id, hearingDate: h.date, turn: sg.seq, speakerLabel: sg.speakerLabel}
            END AS source
     ORDER BY c.statedOn, ch.seq, sg.seq`,
    {
      caseId,
      personId: f.personId ?? null,
      subjectId: f.subjectId ?? null,
      sourceId: f.sourceId ?? null,
      includeSuperseded: f.includeSuperseded ?? false,
      ids: f.ids ?? null,
    },
  );
}

export async function listSubjects(caseId: string) {
  await requireCase(caseId);
  return runQuery(
    `MATCH (s:Subject {caseId: $caseId})
     OPTIONAL MATCH (c:Claim {superseded: false})-[:ABOUT]->(s)
     OPTIONAL MATCH (c)-[:MADE_BY]->(p:Person)
     RETURN s {.id, .name, .type} AS subject, count(DISTINCT c) AS claims, collect(DISTINCT p.name) AS mentionedBy
     ORDER BY claims DESC`,
    { caseId },
  );
}

/**
 * Directions with their order, assignees and deadline state. A direction is `complied` when it has a
 * COMPLIED_BY edge, `overdue` when its due date has passed without one, otherwise `pending`.
 */
export async function listDirections(caseId: string, status?: "pending" | "overdue" | "complied") {
  await requireCase(caseId);
  const today = new Date().toISOString().slice(0, 10);
  const rows = await runQuery<{ state: string } & Record<string, unknown>>(
    `MATCH (o:Document)-[:GIVES]->(d:Direction {caseId: $caseId})
     OPTIONAL MATCH (d)-[:TO]->(p:Person)
     OPTIONAL MATCH (ch:Chunk)-[:CONTAINS]->(d)
     OPTIONAL MATCH (d)-[:COMPLIED_BY]->(cd:Document)
     OPTIONAL MATCH (h:Hearing {id: d.hearingId})
     WITH d, o, ch, h, cd, collect(DISTINCT {id: p.id, name: p.name}) AS assignees
     WITH d, o, ch, h, cd, assignees,
          CASE WHEN cd IS NOT NULL THEN 'complied'
               WHEN d.dueDate IS NOT NULL AND d.dueDate < $today THEN 'overdue'
               ELSE 'pending' END AS state
     WHERE $status IS NULL OR state = $status
     RETURN d {.id, .text, .kind, .dueDate, .dueText, .orderDate} AS direction, state,
            [a IN assignees WHERE a.id IS NOT NULL] AS assignedTo,
            {documentId: o.id, title: o.title, page: ch.page, paraLabel: ch.paraLabel, hearingDate: h.date} AS order,
            CASE WHEN cd IS NULL THEN NULL ELSE {id: cd.id, title: cd.title} END AS compliedBy
     ORDER BY d.dueDate, d.orderDate`,
    { caseId, status: status ?? null, today },
  );
  return rows;
}
