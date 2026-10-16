export interface ParsedTurn {
  seq: number; // turn number in the hearing, from 1
  speakerLabel: string;
  time: string | null; // only if the transcript happens to carry "[10:42]" style times
  text: string;
}

export interface ParsedTranscript {
  header: string | null; // lines before the first speaker (court name, date, coram)
  turns: ParsedTurn[];
  labels: string[]; // distinct speaker labels in order of first appearance
}

// "[10:42:05] Ld. Counsel for Plaintiff: text"  or  "JUDGE: text"
const LINE = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([^:\n]{1,60}?)\s*:\s*(.*)$/;
const MAX_LABEL_WORDS = 7;

/** Words that make a label obviously a speaker even if it appears only once. */
const ROLE_WORDS =
  /\b(judge|court|bench|magistrate|presiding|counsel|advocate|adv|lawyer|plaintiff|defendant|petitioner|respondent|appellant|complainant|accused|prosecutor|prosecution|app|pp|witness|pw\s*-?\s*\d+|dw\s*-?\s*\d+|cw\s*-?\s*\d+|io|sho|clerk|reader|usher|interpreter|steno|stenographer|ahlmad|naib|peon)\b/i;

function candidateLabel(line: string): { label: string; time: string | null; rest: string } | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const label = m[2]!.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}(]/u.test(label)) return null; // must start with a letter
  if (/[?!]/.test(label) || /[.,;]$/.test(label)) return null;
  if (label.split(" ").length > MAX_LABEL_WORDS) return null;
  return { label, time: m[1] ?? null, rest: m[3] ?? "" };
}

/**
 * Splits a hearing transcript into numbered turns. A turn starts at a line beginning with
 * "Speaker:" and runs until the next speaker line. To avoid treating "Note: ..." inside a
 * statement as a new speaker, a label counts only if it repeats, contains a role word, or
 * is in `knownLabels` (labels we can match to a person).
 */
export function parseTranscript(raw: string, isKnownLabel: (label: string) => boolean = () => false): ParsedTranscript {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  const counts = new Map<string, number>();
  for (const line of lines) {
    const c = candidateLabel(line);
    if (c) counts.set(c.label.toLowerCase(), (counts.get(c.label.toLowerCase()) ?? 0) + 1);
  }
  const isSpeaker = (label: string) =>
    (counts.get(label.toLowerCase()) ?? 0) >= 2 || ROLE_WORDS.test(label) || isKnownLabel(label);

  const header: string[] = [];
  const turns: ParsedTurn[] = [];
  const labels: string[] = [];
  let cur: ParsedTurn | null = null;

  for (const line of lines) {
    const c = candidateLabel(line);
    if (c && isSpeaker(c.label)) {
      if (cur) turns.push(cur);
      cur = { seq: turns.length + 1, speakerLabel: c.label, time: c.time, text: c.rest.trim() };
      if (!labels.some((l) => l.toLowerCase() === c.label.toLowerCase())) labels.push(c.label);
    } else if (cur) {
      cur.text = cur.text ? `${cur.text}\n${line.trim()}` : line.trim();
    } else if (line.trim()) {
      header.push(line.trim());
    }
  }
  if (cur) turns.push(cur);

  for (const t of turns) t.text = t.text.replace(/\n{3,}/g, "\n\n").trim();
  return { header: header.length ? header.join("\n") : null, turns: turns.filter((t) => t.text), labels };
}
