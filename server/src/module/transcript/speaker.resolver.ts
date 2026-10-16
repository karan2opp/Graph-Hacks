import { runQuery } from "../../common/db/index.js";
import { nameKey } from "../../common/utils/index.js";

interface Candidate {
  id: string;
  name: string;
  nameKey: string;
  kind: "Party" | "Lawyer" | "Judge" | "Witness";
  role: string | null; // party role
  code: string | null; // witness code
  sides: string[]; // roles of the parties a lawyer represents
  presiding: boolean; // judge of this hearing
  appeared: boolean; // present at this hearing
}

const SIDE_A = ["plaintiff", "petitioner", "appellant", "complainant", "prosecution"];
const SIDE_B = ["defendant", "respondent", "accused"];

const JUDGE_WORDS = /\b(judge|court|bench|magistrate|presiding|my lord)\b/i;
const COUNSEL_WORDS = /\b(counsel|advocate|adv|lawyer|ld|learned|app|pp|prosecutor)\b/i;
const PROSECUTOR = /\b(app|pp|prosecutor|prosecution)\b/i;
const WITNESS_CODE = /\b(pw|dw|cw)\s*-?\s*(\d+)\b/i;

function sideOf(label: string): "A" | "B" | null {
  const l = label.toLowerCase();
  if (PROSECUTOR.test(l) || SIDE_A.some((w) => l.includes(w))) return "A";
  if (SIDE_B.some((w) => l.includes(w))) return "B";
  return null;
}
const roleSide = (role: string | null) => (role && SIDE_A.includes(role) ? "A" : role && SIDE_B.includes(role) ? "B" : null);

/** Picks the only candidate, preferring people present at the hearing when there are several. */
function only(list: Candidate[]): Candidate | null {
  if (list.length === 1) return list[0]!;
  const present = list.filter((c) => c.appeared);
  return present.length === 1 ? present[0]! : null;
}

async function loadCandidates(caseId: string, hearingId: string): Promise<Candidate[]> {
  return runQuery<Candidate>(
    `MATCH (p:Person {caseId: $caseId})
     OPTIONAL MATCH (p)-[pi:PARTY_IN]->(:Case)
     OPTIONAL MATCH (p)-[:REPRESENTS]->(:Party)-[rp:PARTY_IN]->(:Case)
     OPTIONAL MATCH (h:Hearing {id: $hearingId})-[pb:PRESIDED_BY]->(p)
     OPTIONAL MATCH (p)-[ap:APPEARED_IN {present: true}]->(:Hearing {id: $hearingId})
     RETURN p.id AS id, p.name AS name, p.nameKey AS nameKey, [l IN labels(p) WHERE l <> 'Person'][0] AS kind,
            pi.role AS role, p.code AS code, collect(DISTINCT rp.role) AS sides,
            pb IS NOT NULL AS presiding, ap IS NOT NULL AS appeared`,
    { caseId, hearingId },
  );
}

function matchLabel(label: string, people: Candidate[]): Candidate | null {
  const key = nameKey(label);
  const tokens = key.split(" ").filter((t) => t.length >= 3);

  // 1. By name: "Priya Mehta", "Adv. Mehta", "Ramesh Kumar (Plaintiff)"
  const exact = people.filter((p) => p.nameKey === key);
  if (exact.length === 1) return exact[0]!;
  const byName = people.filter((p) => {
    const nameTokens = p.nameKey.split(" ").filter((t) => t.length >= 3);
    return nameTokens.length > 0 && tokens.some((t) => nameTokens.includes(t));
  });
  if (byName.length) return only(byName);

  // 2. Witness code: "PW1", "PW-2 (SI Rajesh)"
  const code = WITNESS_CODE.exec(label);
  if (code) {
    const wanted = `${code[1]!.toUpperCase()}${code[2]}`;
    return only(people.filter((p) => p.kind === "Witness" && p.code === wanted));
  }

  // 3. The bench
  if (JUDGE_WORDS.test(label)) {
    const judges = people.filter((p) => p.kind === "Judge");
    return only(judges.filter((p) => p.presiding)) ?? only(judges);
  }

  // 4. Counsel for a side: "Ld. Counsel for Defendant", "APP"
  const side = sideOf(label);
  if (COUNSEL_WORDS.test(label) && side) {
    return only(people.filter((p) => p.kind === "Lawyer" && p.sides.some((r) => roleSide(r) === side)));
  }

  // 5. A party by role: "Plaintiff", "Accused"
  if (side) {
    const word = [...SIDE_A, ...SIDE_B].find((w) => label.toLowerCase().includes(w));
    return only(people.filter((p) => p.kind === "Party" && p.role === word));
  }
  return null;
}

/**
 * Maps each speaker label of a hearing transcript to a person in the case.
 * `overrides` (label -> personId) from the lawyer always win. Unresolved labels map to null.
 */
export async function resolveSpeakers(
  caseId: string,
  hearingId: string,
  labels: string[],
  overrides: Record<string, string> = {},
): Promise<Map<string, string | null>> {
  const people = await loadCandidates(caseId, hearingId);
  const result = new Map<string, string | null>();
  for (const label of labels) {
    const override = Object.entries(overrides).find(([k]) => k.toLowerCase() === label.toLowerCase())?.[1];
    result.set(label, override ?? matchLabel(label, people)?.id ?? null);
  }
  return result;
}

/** True when the label names someone in the case; used by the parser to accept one-off labels. */
export async function knownLabelChecker(caseId: string, hearingId: string) {
  const people = await loadCandidates(caseId, hearingId);
  return (label: string) => matchLabel(label, people) !== null;
}
