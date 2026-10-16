/* eslint-disable @typescript-eslint/no-explicit-any */
import { embedTexts } from "../../common/ai/index.js";
import { queryOne, runQuery } from "../../common/db/index.js";
import { nameKey, todayIST } from "../../common/utils/index.js";
import { getCaseOverview, listPeople } from "../case/index.js";
import { complianceReport, listDirections } from "../compliance/index.js";
import { listChunks } from "../document/index.js";
import { listContradictions, listDisputes } from "../factcheck/index.js";
import { getHearing, listHearings } from "../hearing/index.js";
import { listClaims, listSubjects } from "../intake/index.js";
import { getTranscript } from "../transcript/index.js";
import { fmtDate, type CitationRegistry } from "./qa.citations.js";

/**
 * The Q&A agent's tools. Each one is a fixed graph query (the model never writes Cypher),
 * returns compact JSON with a ref on every citable item, and records the graph pattern it
 * walked so the answer can show its path.
 */

export interface TraceStep {
  tool: string;
  args: Record<string, unknown>;
  pattern: string;
  found: number;
}

export interface ToolContext {
  caseId: string;
  hearingId: string | null; // the hearing the lawyer has open, for "this hearing"
  cites: CitationRegistry;
  trace: TraceStep[];
}

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  pattern: string;
  run: (ctx: ToolContext, args: any) => Promise<{ found: number; result: unknown }>;
}

const today = todayIST;
const VECTOR_MAX_DISTANCE = 0.65;

// ---------------------------------------------------------------- citation helpers

function citeClaim(ctx: ToolContext, row: any) {
  const s = row.source;
  const isDoc = s.type === "document";
  const label = isDoc
    ? `${s.title}, p${s.page}${s.paraLabel ? ` para ${s.paraLabel}` : ""}`
    : `Hearing ${fmtDate(s.hearingDate)}, turn ${s.turn}`;
  const ref = ctx.cites.add({
    kind: "claim",
    nodeId: row.claim.id,
    label,
    quote: row.claim.quote,
    date: row.claim.statedOn,
    documentId: isDoc ? s.documentId : null,
    hearingId: isDoc ? null : s.hearingId,
    page: isDoc ? s.page : null,
    para: isDoc ? s.paraLabel : null,
    turn: isDoc ? null : s.turn,
    speaker: isDoc ? null : s.speakerLabel,
  });
  return {
    ref,
    claim: row.claim.text,
    kind: row.claim.kind,
    by: row.madeBy?.name ?? null,
    onBehalfOf: row.onBehalfOf?.name ?? null,
    said: fmtDate(row.claim.statedOn),
    source: label,
    about: row.subjects.map((x: any) => x.name),
    privateNote: row.claim.internal || undefined,
  };
}

function citeDirection(ctx: ToolContext, row: any) {
  const label = `${row.order.title}${row.order.page ? `, p${row.order.page}` : ""}${row.order.paraLabel ? ` para ${row.order.paraLabel}` : ""}`;
  const ref = ctx.cites.add({
    kind: "direction",
    nodeId: row.direction.id,
    label,
    quote: row.direction.text,
    date: row.direction.orderDate,
    documentId: row.order.documentId,
    page: row.order.page,
    para: row.order.paraLabel,
  });
  const compliedBy = row.compliedBy
    ? {
        ref: ctx.cites.add({ kind: "document", nodeId: row.compliedBy.documentId, label: row.compliedBy.title, date: row.compliedBy.date, documentId: row.compliedBy.documentId }),
        filed: fmtDate(row.compliedBy.date),
        evidence: row.compliedBy.evidence,
        onTime: row.compliedBy.onTime,
        daysLate: row.compliedBy.daysLate || undefined,
      }
    : null;
  return {
    ref,
    direction: row.direction.text,
    kind: row.direction.kind,
    state: row.state,
    ordered: fmtDate(row.direction.orderDate),
    due: fmtDate(row.direction.dueDate) ?? row.direction.dueText ?? null,
    assignedTo: row.assignedTo.map((a: any) => a.name),
    compliedBy,
    courtNotedNonCompliance: row.noncomplianceRecorded?.length
      ? row.noncomplianceRecorded.map((n: any) => ({ order: n.title, date: fmtDate(n.date), quote: n.quote }))
      : undefined,
    vacatedBy: row.vacatedBy ? row.vacatedBy.title : undefined,
    lawyerOverride: row.manual ? `${row.manual.status}: ${row.manual.note ?? ""}` : undefined,
  };
}

function citeDocument(ctx: ToolContext, d: { id: string; title: string; date?: string | null; type?: string }) {
  return ctx.cites.add({ kind: "document", nodeId: d.id, label: d.title, date: d.date ?? null, documentId: d.id });
}

function citeHearing(ctx: ToolContext, h: { id: string; date: string }) {
  return ctx.cites.add({ kind: "hearing", nodeId: h.id, label: `Hearing ${fmtDate(h.date)}`, date: h.date, hearingId: h.id });
}

/** "last" / "next" / a date / the hearing open in the UI. */
async function resolveHearing(ctx: ToolContext, date?: string | null, which?: string | null) {
  if (date) {
    return queryOne<{ id: string; date: string }>(
      "MATCH (h:Hearing {caseId: $caseId, date: $date}) RETURN h.id AS id, h.date AS date",
      { caseId: ctx.caseId, date },
    );
  }
  if (!which && ctx.hearingId) {
    return queryOne<{ id: string; date: string }>("MATCH (h:Hearing {id: $id}) RETURN h.id AS id, h.date AS date", { id: ctx.hearingId });
  }
  const next = which === "next";
  return queryOne<{ id: string; date: string }>(
    `MATCH (h:Hearing {caseId: $caseId}) WHERE ${next ? "h.date >= $today" : "h.date <= $today"}
     RETURN h.id AS id, h.date AS date ORDER BY h.date ${next ? "ASC" : "DESC"} LIMIT 1`,
    { caseId: ctx.caseId, today: today() },
  );
}

/** Finds people by name or role word ("defendant", "PW1", "Mehta"). */
async function resolvePeople(caseId: string, who: string) {
  const people = await listPeople(caseId);
  const key = nameKey(who);
  const byName = people.filter((p) => nameKey(p.name).includes(key) || key.includes(nameKey(p.name)));
  if (byName.length) return byName;
  return people.filter(
    (p) => (p.role && key.includes(p.role)) || (p.code && key.replace(/\s/g, "").includes(p.code.toLowerCase())),
  );
}

// ---------------------------------------------------------------- tools

export const TOOLS: Tool[] = [
  {
    name: "search_case",
    description:
      "Search everything in the case by meaning: claims, document passages and hearing transcript turns. Use for open questions ('where did anyone mention the loan?').",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    pattern: "vector search (Claim | Chunk | Segment) → (Document | Hearing) source",
    async run(ctx, { query }) {
      const [vec] = await embedTexts([query]);
      const hits = async (label: string, extra = "") => {
        try {
          return await runQuery<{ id: string; score: number }>(
            `CALL db.idx.vector.queryNodes('${label}', 'embedding', 10, vecf32($vec)) YIELD node, score
             WHERE node.caseId = $caseId AND score <= $max ${extra}
             RETURN node.id AS id, score`,
            { vec, caseId: ctx.caseId, max: VECTOR_MAX_DISTANCE },
          );
        } catch {
          return [];
        }
      };
      const [claimHits, chunkHits, segHits] = await Promise.all([
        hits("Claim", "AND node.superseded = false"),
        hits("Chunk"),
        hits("Segment"),
      ]);
      const score = new Map([...claimHits, ...chunkHits, ...segHits].map((h) => [h.id, h.score]));

      const claims = claimHits.length ? await listClaims(ctx.caseId, { ids: claimHits.map((h) => h.id) }) : [];
      const chunks = chunkHits.length
        ? await runQuery<any>(
            `MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk) WHERE c.id IN $ids
             RETURN c.id AS id, c.text AS text, c.page AS page, c.paraLabel AS para, d.id AS docId, d.title AS title,
                    coalesce(d.filedOn, d.date) AS date, d.private AS private`,
            { ids: chunkHits.map((h) => h.id) },
          )
        : [];
      const segs = segHits.length
        ? await runQuery<any>(
            `MATCH (h:Hearing)-[:RECORDED_IN]->(:Transcript {current: true})-[:HAS_SEGMENT]->(s:Segment) WHERE s.id IN $ids
             OPTIONAL MATCH (s)-[:SPOKEN_BY]->(p:Person)
             RETURN s.id AS id, s.seq AS turn, s.speakerLabel AS label, s.text AS text, h.id AS hearingId, h.date AS date, p.name AS speaker`,
            { ids: segHits.map((h) => h.id) },
          )
        : [];

      const items = [
        ...claims.map((r: any) => ({ score: score.get(r.claim.id)!, item: { type: "claim", ...citeClaim(ctx, r) } })),
        ...chunks.map((c: any) => {
          const label = `${c.title}, p${c.page}${c.para ? ` para ${c.para}` : ""}`;
          const ref = ctx.cites.add({ kind: "chunk", nodeId: c.id, label, quote: c.text.slice(0, 300), date: c.date, documentId: c.docId, page: c.page, para: c.para });
          return { score: score.get(c.id)!, item: { type: "document passage", ref, source: label, filed: fmtDate(c.date), text: c.text.slice(0, 700), privateNote: c.private || undefined } };
        }),
        ...segs.map((s: any) => {
          const label = `Hearing ${fmtDate(s.date)}, turn ${s.turn}`;
          const ref = ctx.cites.add({ kind: "segment", nodeId: s.id, label, quote: s.text.slice(0, 300), date: s.date, hearingId: s.hearingId, turn: s.turn, speaker: s.label });
          return { score: score.get(s.id)!, item: { type: "transcript turn", ref, source: label, speaker: `${s.label}${s.speaker ? ` (${s.speaker})` : ""}`, text: s.text.slice(0, 700) } };
        }),
      ]
        .sort((a, b) => a.score - b.score)
        .slice(0, 14)
        .map((x) => x.item);
      return { found: items.length, result: items };
    },
  },
  {
    name: "get_timeline",
    description: "All hearings of the case in date order, with judge, purpose, adjournments and what is attached to each.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    pattern: "(Case)-[:HAS_HEARING]->(Hearing)-[:NEXT]->(Hearing) …",
    async run(ctx) {
      const rows = (await listHearings(ctx.caseId)) as any[];
      return {
        found: rows.length,
        result: rows.map((r) => ({
          ref: citeHearing(ctx, r.hearing),
          date: fmtDate(r.hearing.date),
          status: r.hearing.status,
          purpose: r.hearing.purpose,
          judge: r.judge,
          adjourned: r.hearing.adjourned || undefined,
          adjournmentReason: r.hearing.adjournmentReason ?? undefined,
          outcome: r.hearing.outcome ?? undefined,
          orders: r.orders,
          documents: r.documents,
          transcript: r.hasTranscript,
        })),
      };
    },
  },
  {
    name: "get_hearing",
    description:
      "One hearing in full: judge, who appeared, documents submitted, the ORDERS passed with their directions, and transcript size. Give a date (YYYY-MM-DD), or which='last'/'next'. With neither, uses the hearing open in the app (or the last one).",
    parameters: {
      type: "object",
      properties: {
        date: { type: ["string", "null"], description: "YYYY-MM-DD" },
        which: { type: ["string", "null"], enum: ["last", "next", null] },
      },
      required: ["date", "which"],
      additionalProperties: false,
    },
    pattern: "(Hearing)-[:PRESIDED_BY]->(Judge), (Person)-[:APPEARED_IN]->(Hearing), (Document {type:'order'})-[:SUBMITTED_IN]->(Hearing), (order)-[:GIVES]->(Direction)",
    async run(ctx, { date, which }) {
      const h = await resolveHearing(ctx, date, which);
      if (!h) return { found: 0, result: { error: "No such hearing in this case" } };
      const full = (await getHearing(h.id)) as any;
      const directions = (await listDirections(ctx.caseId)) as any[];
      const docs = full.documents as any[];
      const orders = docs.filter((d) => d.type === "order");
      const orderSummaries = orders.length
        ? await runQuery<any>("MATCH (o:Document) WHERE o.id IN $ids RETURN o.id AS id, o.summary AS summary, o.nextDate AS nextDate", { ids: orders.map((o) => o.id) })
        : [];
      return {
        found: 1,
        result: {
          ref: citeHearing(ctx, h),
          date: fmtDate(full.hearing.date),
          status: full.hearing.status,
          purpose: full.hearing.purpose,
          judge: full.judge?.name ?? null,
          adjourned: full.hearing.adjourned,
          adjournmentReason: full.hearing.adjournmentReason,
          adjournedAtRequestOf: full.adjournedAtRequestOf?.name ?? null,
          appearances: full.appearances.map((a: any) => `${a.name} (${a.kind}${a.present ? "" : ", absent"})`),
          previousHearing: fmtDate(full.previous?.date),
          nextHearing: fmtDate(full.next?.date),
          orders: orders.map((o) => ({
            ref: citeDocument(ctx, o),
            title: o.title,
            kind: o.orderKind,
            summary: orderSummaries.find((s) => s.id === o.id)?.summary ?? null,
            nextDateFixed: fmtDate(orderSummaries.find((s) => s.id === o.id)?.nextDate),
            directions: directions.filter((d) => d.order.documentId === o.id).map((d) => citeDirection(ctx, d)),
          })),
          otherDocuments: docs.filter((d) => d.type !== "order").map((d) => ({ ref: citeDocument(ctx, d), title: d.title, type: d.type })),
          transcript: full.transcript ? { turns: full.transcript.segmentCount, version: full.transcript.version } : null,
          note: orders.length ? undefined : "No order sheet has been uploaded for this hearing.",
        },
      };
    },
  },
  {
    name: "get_people",
    description: "Parties (with role), lawyers (whom they represent and since when), judges and witnesses (code, side).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    pattern: "(Party)-[:PARTY_IN]->(Case), (Lawyer)-[:REPRESENTS]->(Party), (Witness)-[:CALLED_BY]->(Party)",
    async run(ctx) {
      const people = await listPeople(ctx.caseId);
      return {
        found: people.length,
        result: people.map((p) => ({
          name: p.name,
          kind: p.kind,
          role: p.role ?? undefined,
          code: p.code ?? undefined,
          represents: p.represents.length ? p.represents.map((r) => `${r.name}${r.from ? ` from ${fmtDate(r.from)}` : ""}${r.to ? ` to ${fmtDate(r.to)}` : ""}`) : undefined,
          calledBy: p.calledBy?.name,
        })),
      };
    },
  },
  {
    name: "get_claims",
    description:
      "Claims (who said what, where) filtered by a person (name or role like 'defendant', 'PW1') and/or a subject (e.g. 'payment', 'property'). Includes claims made by that person's lawyer or witnesses on their behalf.",
    parameters: {
      type: "object",
      properties: { person: { type: ["string", "null"] }, subject: { type: ["string", "null"] } },
      required: ["person", "subject"],
      additionalProperties: false,
    },
    pattern: "(Claim)-[:MADE_BY|ON_BEHALF_OF]->(Person), (Claim)-[:ABOUT]->(Subject), (Chunk|Segment)-[:CONTAINS]->(Claim)",
    async run(ctx, { person, subject }) {
      let personIds: (string | undefined)[] = [undefined];
      if (person) {
        const found = await resolvePeople(ctx.caseId, person);
        if (!found.length) return { found: 0, result: { error: `No person matching "${person}"` } };
        personIds = found.map((p) => p.id);
      }
      let subjectIds: (string | undefined)[] = [undefined];
      if (subject) {
        const words = nameKey(subject).split(" ").filter((w) => w.length > 2);
        const subs = ((await listSubjects(ctx.caseId)) as any[]).filter((s) => words.some((w) => nameKey(s.subject.name).includes(w)));
        if (!subs.length) return { found: 0, result: { error: `No subject matching "${subject}"` } };
        subjectIds = subs.map((s) => s.subject.id);
      }
      const seen = new Set<string>();
      const rows: any[] = [];
      for (const personId of personIds) {
        for (const subjectId of subjectIds) {
          for (const r of (await listClaims(ctx.caseId, { personId, subjectId })) as any[]) {
            if (!seen.has(r.claim.id)) {
              seen.add(r.claim.id);
              rows.push(r);
            }
          }
        }
      }
      return { found: rows.length, result: rows.slice(0, 40).map((r) => citeClaim(ctx, r)) };
    },
  },
  {
    name: "get_contradictions",
    description:
      "Contradictions found by the fact-check agent: the same person over time ('self'), the same side ('same_side'), or a statement against a document of record ('record'). Each has both citations and the reason.",
    parameters: {
      type: "object",
      properties: { category: { type: ["string", "null"], enum: ["self", "same_side", "record", null] } },
      required: ["category"],
      additionalProperties: false,
    },
    pattern: "(Claim)-[:CONTRADICTS {category, reason}]->(Claim)-[:MADE_BY]->(Person)",
    async run(ctx, { category }) {
      const rows = (await listContradictions(ctx.caseId, category ?? undefined)) as any[];
      return {
        found: rows.length,
        result: rows.map((p) => ({ category: p.category, severity: p.severity, reason: p.reason, earlier: citeClaim(ctx, p.earlier), later: citeClaim(ctx, p.later) })),
      };
    },
  },
  {
    name: "get_disputes",
    description: "Points in dispute: where the two sides assert incompatible facts (not contradictions, just the dispute).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    pattern: "(Claim)-[:DISPUTES]->(Claim), sides from (Person)-[:PARTY_IN|REPRESENTS|CALLED_BY]",
    async run(ctx) {
      const rows = (await listDisputes(ctx.caseId)) as any[];
      return { found: rows.length, result: rows.map((p) => ({ reason: p.reason, one: citeClaim(ctx, p.earlier), other: citeClaim(ctx, p.later) })) };
    },
  },
  {
    name: "get_directions",
    description:
      "Court directions from all orders with their state (pending, overdue, complied, in_force, vacated), who must comply, due date, and the evidence of compliance. Filter by status if useful.",
    parameters: {
      type: "object",
      properties: { status: { type: ["string", "null"], enum: ["pending", "overdue", "complied", "in_force", "vacated", null] } },
      required: ["status"],
      additionalProperties: false,
    },
    pattern: "(order:Document)-[:GIVES]->(Direction)-[:TO]->(Party), (Direction)-[:COMPLIED_BY|VACATED_BY]->(Document)",
    async run(ctx, { status }) {
      const rows = (await listDirections(ctx.caseId, status ?? undefined)) as any[];
      return { found: rows.length, result: rows.map((r) => citeDirection(ctx, r)) };
    },
  },
  {
    name: "get_compliance",
    description: "Compliance overview: next hearing, what is overdue, what falls due before the next hearing, and each party's record (on time, late, overdue, adjournments sought).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    pattern: "(Direction)-[:TO]->(Party) with COMPLIED_BY state, (Hearing)-[:ADJOURNED_AT_REQUEST_OF]->(Party)",
    async run(ctx) {
      const r = (await complianceReport(ctx.caseId)) as any;
      return {
        found: r.overdue.length + r.dueBeforeNextHearing.length,
        result: {
          nextHearing: r.nextHearing ? { date: fmtDate(r.nextHearing.date), purpose: r.nextHearing.purpose } : null,
          overdue: r.overdue.map((d: any) => citeDirection(ctx, d)),
          dueBeforeNextHearing: r.dueBeforeNextHearing.map((d: any) => citeDirection(ctx, d)),
          inForce: r.inForce.map((d: any) => citeDirection(ctx, d)),
          byParty: r.byParty.map((p: any) => ({ ...p, party: `${p.party.name} (${p.party.role})` })),
        },
      };
    },
  },
  {
    name: "read_transcript",
    description: "Read the turns of a hearing's transcript, optionally a range of turn numbers (e.g. to see what was said around a turn).",
    parameters: {
      type: "object",
      properties: {
        date: { type: ["string", "null"], description: "YYYY-MM-DD; null = hearing open in the app or last hearing" },
        fromTurn: { type: ["integer", "null"] },
        toTurn: { type: ["integer", "null"] },
      },
      required: ["date", "fromTurn", "toTurn"],
      additionalProperties: false,
    },
    pattern: "(Hearing)-[:RECORDED_IN]->(Transcript {current:true})-[:HAS_SEGMENT]->(Segment)-[:SPOKEN_BY]->(Person)",
    async run(ctx, { date, fromTurn, toTurn }) {
      const h = await resolveHearing(ctx, date, null);
      if (!h) return { found: 0, result: { error: "No such hearing" } };
      try {
        const t = (await getTranscript(h.id, { from: fromTurn ?? undefined, to: toTurn ?? (fromTurn ? undefined : 40) })) as any;
        const turns = t.segments.map((s: any) => ({
          ref: ctx.cites.add({ kind: "segment", nodeId: s.id, label: `Hearing ${fmtDate(h.date)}, turn ${s.seq}`, quote: s.text.slice(0, 300), date: h.date, hearingId: h.id, turn: s.seq, speaker: s.speakerLabel }),
          turn: s.seq,
          speaker: `${s.speakerLabel}${s.speaker ? ` (${s.speaker.name})` : ""}`,
          text: s.text,
        }));
        return { found: turns.length, result: { hearing: fmtDate(h.date), totalTurns: t.segmentCount, turns } };
      } catch {
        return { found: 0, result: { error: `No transcript uploaded for the hearing on ${fmtDate(h.date)}` } };
      }
    },
  },
  {
    name: "read_document",
    description: "Read a document's text by (part of) its title, optionally one page. Use to quote the exact words of a filing or order.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, page: { type: ["integer", "null"] } },
      required: ["title", "page"],
      additionalProperties: false,
    },
    pattern: "(Document)-[:BELONGS_TO]->(Case), (Document)-[:HAS_CHUNK]->(Chunk)",
    async run(ctx, { title, page }) {
      const docs = await runQuery<any>(
        "MATCH (d:Document)-[:BELONGS_TO]->(:Case {id: $caseId}) RETURN d.id AS id, d.title AS title, d.type AS type, coalesce(d.filedOn, d.date) AS date",
        { caseId: ctx.caseId },
      );
      const key = nameKey(title);
      const doc = docs.find((d) => nameKey(d.title) === key) ?? docs.find((d) => nameKey(d.title).includes(key) || key.includes(nameKey(d.title)));
      if (!doc) return { found: 0, result: { error: `No document titled like "${title}"`, available: docs.map((d) => d.title) } };
      const chunks = (await listChunks(doc.id, page ?? undefined)) as any[];
      let budget = 6000;
      const parts = [];
      for (const c of chunks) {
        if (budget <= 0) break;
        const label = `${doc.title}, p${c.page}${c.paraLabel ? ` para ${c.paraLabel}` : ""}`;
        parts.push({ ref: ctx.cites.add({ kind: "chunk", nodeId: c.id, label, quote: c.text.slice(0, 300), date: doc.date, documentId: doc.id, page: c.page, para: c.paraLabel }), page: c.page, para: c.paraLabel, text: c.text.slice(0, budget) });
        budget -= c.text.length;
      }
      return { found: parts.length, result: { title: doc.title, type: doc.type, filed: fmtDate(doc.date), passages: parts, truncated: budget <= 0 || undefined } };
    },
  },
  {
    name: "get_linked_cases",
    description: "Cases linked to this one (e.g. a criminal case or FIR about the same property), with their documents.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    pattern: "(Case)-[:LINKED_TO]-(Case)<-[:BELONGS_TO]-(Document)",
    async run(ctx) {
      const overview = (await getCaseOverview(ctx.caseId)) as any;
      const result = [];
      for (const l of overview.linkedCases) {
        const docs = await runQuery<any>(
          "MATCH (d:Document)-[:BELONGS_TO]->(:Case {id: $id}) RETURN d.id AS id, d.title AS title, d.type AS type, coalesce(d.filedOn, d.date) AS date ORDER BY date",
          { id: l.case.id },
        );
        result.push({
          case: `${l.case.caseNumber}: ${l.case.title} (${l.case.court}, ${l.case.caseType})`,
          reason: l.reason,
          documents: docs.map((d) => ({ ref: citeDocument(ctx, d), title: d.title, type: d.type, date: fmtDate(d.date) })),
        });
      }
      return { found: result.length, result };
    },
  },
];

export const toolDefinitions = TOOLS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.parameters, strict: true },
}));

export async function runTool(ctx: ToolContext, name: string, rawArgs: string) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { error: "Arguments were not valid JSON" };
  }
  try {
    const { found, result } = await tool.run(ctx, args);
    ctx.trace.push({ tool: name, args, pattern: tool.pattern, found });
    return result;
  } catch (e) {
    ctx.trace.push({ tool: name, args, pattern: tool.pattern, found: 0 });
    return { error: (e as Error).message };
  }
}
