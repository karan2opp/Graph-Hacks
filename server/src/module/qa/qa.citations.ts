/**
 * Every item a tool hands to the model gets a short ref ([S1], [S2], ...) registered here.
 * The model cites refs; only registered refs resolve, so citations cannot be invented.
 */
export type CitationKind = "claim" | "chunk" | "segment" | "direction" | "document" | "hearing";

export interface Citation {
  ref: string;
  kind: CitationKind;
  nodeId: string;
  label: string; // "Written Statement, p1 para 1" or "Hearing 15 Apr 2021, turn 3"
  quote: string | null;
  date: string | null;
  documentId: string | null;
  hearingId: string | null;
  page: number | null;
  para: string | null;
  turn: number | null;
  speaker: string | null;
}

export class CitationRegistry {
  private byNode = new Map<string, Citation>();
  private byRef = new Map<string, Citation>();

  add(c: Omit<Citation, "ref" | "quote" | "date" | "documentId" | "hearingId" | "page" | "para" | "turn" | "speaker"> &
    Partial<Citation>): string {
    const existing = this.byNode.get(c.nodeId);
    if (existing) return existing.ref;
    const full: Citation = {
      quote: null, date: null, documentId: null, hearingId: null, page: null, para: null, turn: null, speaker: null,
      ...c,
      ref: `S${this.byRef.size + 1}`,
    };
    this.byNode.set(c.nodeId, full);
    this.byRef.set(full.ref, full);
    return full.ref;
  }

  /** Citations whose refs appear in the answer, in order of first use. */
  used(text: string): Citation[] {
    const seen = new Set<string>();
    const out: Citation[] = [];
    for (const m of text.matchAll(/\bS\d+\b/g)) {
      const c = this.byRef.get(m[0]);
      if (c && !seen.has(c.ref)) {
        seen.add(c.ref);
        out.push(c);
      }
    }
    return out;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2021-04-15 -> 15 Apr 2021 */
export const fmtDate = (d: string | null | undefined) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d ?? null;
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
};
