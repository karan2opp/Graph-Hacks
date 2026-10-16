import { runQuery } from "../../common/db/index.js";

/**
 * The model never sees database ids. People, subjects and sources get short refs
 * (P1, S1, C1, T1) in the prompt, and its answers are mapped back through these tables.
 */

export interface PersonRef {
  ref: string;
  id: string;
  name: string;
  kind: string;
  role: string | null;
  code: string | null;
  represents: string[]; // party refs
}

export interface SubjectRef {
  ref: string;
  id: string;
  name: string;
  type: string;
}

export const SUBJECT_TYPES = ["property", "money", "document", "event", "person", "other"] as const;

export async function loadPeople(caseId: string): Promise<PersonRef[]> {
  const rows = await runQuery<Omit<PersonRef, "ref" | "represents"> & { represents: string[] }>(
    `MATCH (p:Person {caseId: $caseId})
     OPTIONAL MATCH (p)-[pi:PARTY_IN]->(:Case)
     OPTIONAL MATCH (p)-[:REPRESENTS]->(rp:Party)
     WITH p, pi, collect(rp.id) AS represents
     RETURN p.id AS id, p.name AS name, [l IN labels(p) WHERE l <> 'Person'][0] AS kind, pi.role AS role,
            p.code AS code, represents
     ORDER BY p.createdAt`,
    { caseId },
  );
  const refs = rows.map((r, i) => ({ ...r, ref: `P${i + 1}` }));
  const refOf = new Map(refs.map((r) => [r.id, r.ref]));
  return refs.map((r) => ({ ...r, represents: r.represents.map((id) => refOf.get(id)!).filter(Boolean) }));
}

export async function loadSubjects(caseId: string): Promise<SubjectRef[]> {
  const rows = await runQuery<Omit<SubjectRef, "ref">>(
    "MATCH (s:Subject {caseId: $caseId}) RETURN s.id AS id, s.name AS name, s.type AS type ORDER BY s.createdAt",
    { caseId },
  );
  return rows.map((r, i) => ({ ...r, ref: `S${i + 1}` }));
}

export function describePeople(people: PersonRef[]): string {
  if (!people.length) return "(no people recorded yet)";
  return people
    .map((p) => {
      const extra = [
        p.role,
        p.code,
        p.represents.length ? `counsel for ${p.represents.join(", ")}` : null,
      ].filter(Boolean);
      return `${p.ref}: ${p.name} (${p.kind}${extra.length ? `, ${extra.join(", ")}` : ""})`;
    })
    .join("\n");
}

export function describeSubjects(subjects: SubjectRef[]): string {
  if (!subjects.length) return "(none yet)";
  return subjects.map((s) => `${s.ref}: ${s.name} (${s.type})`).join("\n");
}

/** Splits source blocks into batches that fit one model call. */
export function batchBlocks<T extends { text: string }>(blocks: T[], maxChars = 12000): T[][] {
  const batches: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const b of blocks) {
    if (cur.length && size + b.text.length > maxChars) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(b);
    size += b.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** True when the quote really appears in the source (ignoring case, spacing and punctuation). */
export const quoteFound = (quote: string, source: string) => !!quote.trim() && squash(source).includes(squash(quote));
