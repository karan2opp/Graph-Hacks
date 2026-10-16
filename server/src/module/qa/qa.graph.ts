import { runQuery } from "../../common/db/index.js";
import { fmtDate, type Citation } from "./qa.citations.js";

/**
 * The evidence behind an answer as a small graph for the UI: every cited item plus the nodes it
 * hangs off (who said it, what it is about, where it was said or filed) and the fact-check /
 * compliance edges between them. Chunks and transcript turns are folded into their Document or
 * Hearing so the picture stays readable.
 */
export interface GraphNode {
  id: string;
  label: string; // Claim, Person kind, Subject, Document, Hearing, Direction
  name: string;
  ref?: string; // citation ref when this node was cited
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
}

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function evidenceGraph(cited: Citation[]): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (n: GraphNode) => {
    const prev = nodes.get(n.id);
    nodes.set(n.id, { ...prev, ...n, ref: n.ref ?? prev?.ref });
  };
  const edge = (e: GraphEdge) => edges.set(`${e.from}|${e.type}|${e.to}`, e);
  const ids = (kind: Citation["kind"]) => cited.filter((c) => c.kind === kind).map((c) => c.nodeId);
  const refOf = new Map(cited.map((c) => [c.nodeId, c.ref]));

  const claimIds = ids("claim");
  if (claimIds.length) {
    const rows = await runQuery<{
      id: string; text: string; personId: string | null; person: string | null; personKind: string | null;
      subjects: { id: string; name: string }[]; docId: string | null; doc: string | null; hearingId: string | null; hearingDate: string | null;
    }>(
      `MATCH (c:Claim) WHERE c.id IN $ids
       OPTIONAL MATCH (c)-[:MADE_BY]->(p:Person)
       OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(:Chunk)-[:CONTAINS]->(c)
       OPTIONAL MATCH (h:Hearing)-[:RECORDED_IN]->(:Transcript)-[:HAS_SEGMENT]->(:Segment)-[:CONTAINS]->(c)
       OPTIONAL MATCH (c)-[:ABOUT]->(s:Subject)
       WITH c, p, d, h, collect(DISTINCT {id: s.id, name: s.name}) AS subjects
       RETURN c.id AS id, c.text AS text, p.id AS personId, p.name AS person,
              [l IN labels(p) WHERE l <> 'Person'][0] AS personKind, subjects,
              d.id AS docId, d.title AS doc, h.id AS hearingId, h.date AS hearingDate`,
      { ids: claimIds },
    );
    for (const r of rows) {
      node({ id: r.id, label: "Claim", name: short(r.text), ref: refOf.get(r.id) });
      if (r.personId) {
        node({ id: r.personId, label: r.personKind ?? "Person", name: r.person! });
        edge({ from: r.id, to: r.personId, type: "MADE_BY" });
      }
      for (const s of r.subjects.filter((x) => x.id)) {
        node({ id: s.id, label: "Subject", name: s.name });
        edge({ from: r.id, to: s.id, type: "ABOUT" });
      }
      if (r.docId) {
        node({ id: r.docId, label: "Document", name: r.doc! });
        edge({ from: r.docId, to: r.id, type: "CONTAINS" });
      } else if (r.hearingId) {
        node({ id: r.hearingId, label: "Hearing", name: `Hearing ${fmtDate(r.hearingDate)}` });
        edge({ from: r.hearingId, to: r.id, type: "CONTAINS" });
      }
    }
    const links = await runQuery<{ a: string; b: string; type: string; reason: string | null }>(
      `MATCH (a:Claim)-[r:CONTRADICTS|DISPUTES|SUPPORTS]->(b:Claim) WHERE a.id IN $ids AND b.id IN $ids
       RETURN a.id AS a, b.id AS b, type(r) AS type, r.reason AS reason`,
      { ids: claimIds },
    );
    for (const l of links) edge({ from: l.a, to: l.b, type: l.type, label: l.reason ?? undefined });
  }

  const directionIds = ids("direction");
  if (directionIds.length) {
    const rows = await runQuery<{
      id: string; text: string; orderId: string; order: string; to: { id: string; name: string; kind: string }[];
      compliedId: string | null; complied: string | null; hearingId: string | null; hearingDate: string | null;
    }>(
      `MATCH (o:Document)-[:GIVES]->(d:Direction) WHERE d.id IN $ids
       OPTIONAL MATCH (d)-[:TO]->(p:Person)
       OPTIONAL MATCH (d)-[:COMPLIED_BY]->(cd:Document)
       OPTIONAL MATCH (o)-[:SUBMITTED_IN]->(h:Hearing)
       WITH d, o, cd, h, collect(DISTINCT {id: p.id, name: p.name, kind: [l IN labels(p) WHERE l <> 'Person'][0]}) AS to
       RETURN d.id AS id, d.text AS text, o.id AS orderId, o.title AS order, to,
              cd.id AS compliedId, cd.title AS complied, h.id AS hearingId, h.date AS hearingDate`,
      { ids: directionIds },
    );
    for (const r of rows) {
      node({ id: r.id, label: "Direction", name: short(r.text), ref: refOf.get(r.id) });
      node({ id: r.orderId, label: "Document", name: r.order });
      edge({ from: r.orderId, to: r.id, type: "GIVES" });
      if (r.hearingId) {
        node({ id: r.hearingId, label: "Hearing", name: `Hearing ${fmtDate(r.hearingDate)}` });
        edge({ from: r.orderId, to: r.hearingId, type: "SUBMITTED_IN" });
      }
      for (const p of r.to.filter((x) => x.id)) {
        node({ id: p.id, label: p.kind, name: p.name });
        edge({ from: r.id, to: p.id, type: "TO" });
      }
      if (r.compliedId) {
        node({ id: r.compliedId, label: "Document", name: r.complied! });
        edge({ from: r.id, to: r.compliedId, type: "COMPLIED_BY" });
      }
    }
  }

  for (const c of cited) {
    if (c.kind === "chunk" || c.kind === "document") {
      if (c.documentId) node({ id: c.documentId, label: "Document", name: c.label.split(", p")[0]!, ref: c.ref });
    } else if (c.kind === "segment" || c.kind === "hearing") {
      if (c.hearingId) node({ id: c.hearingId, label: "Hearing", name: `Hearing ${fmtDate(c.date)}`, ref: c.ref });
    }
  }

  const speakers = ids("segment");
  if (speakers.length) {
    const rows = await runQuery<{ hearingId: string; personId: string; name: string; kind: string }>(
      `MATCH (h:Hearing)-[:RECORDED_IN]->(:Transcript)-[:HAS_SEGMENT]->(s:Segment)-[:SPOKEN_BY]->(p:Person) WHERE s.id IN $ids
       RETURN DISTINCT h.id AS hearingId, p.id AS personId, p.name AS name, [l IN labels(p) WHERE l <> 'Person'][0] AS kind`,
      { ids: speakers },
    );
    for (const r of rows) {
      node({ id: r.personId, label: r.kind, name: r.name });
      edge({ from: r.personId, to: r.hearingId, type: "SPOKE_IN" });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
