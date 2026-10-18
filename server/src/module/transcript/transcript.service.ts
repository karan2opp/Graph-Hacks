import { createHash, randomUUID } from "node:crypto";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import { requireHearing } from "../hearing/index.js";
import { queueTranscriptEmbedding } from "../ingestion/index.js";
import { queueTranscriptAnalysis } from "../intake/index.js";
import type { CreateTranscriptInput, SegmentsQuery } from "./transcript.schema.js";
import { parseTranscript } from "./transcript.parser.js";
import { knownLabelChecker, resolveSpeakers } from "./speaker.resolver.js";

export interface TranscriptNode {
  id: string;
  hearingId: string;
  caseId: string;
  version: number;
  current: boolean;
  hash: string;
  header: string | null;
  segmentCount: number;
  speakers: string; // JSON: [{ label, personId, name }]
  status: "extracted" | "embedding" | "ready" | "failed";
  note: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const SEGMENT_WRITE_BATCH = 100;

async function requireTranscript(transcriptId: string): Promise<TranscriptNode> {
  const row = await queryOne<{ t: TranscriptNode }>("MATCH (t:Transcript {id: $transcriptId}) RETURN t {.*} AS t", {
    transcriptId,
  });
  if (!row) throw ApiError.notFound("Transcript not found");
  return row.t;
}

async function checkOverrides(caseId: string, overrides: Record<string, string>) {
  const ids = [...new Set(Object.values(overrides))];
  if (!ids.length) return;
  const row = await queryOne<{ n: number }>("MATCH (p:Person {caseId: $caseId}) WHERE p.id IN $ids RETURN count(p) AS n", {
    caseId,
    ids,
  });
  if (row!.n !== ids.length) throw ApiError.badRequest("speakerMap: some people are not part of this case");
}

/** (Re)links every segment of a transcript to the person behind its speaker label. */
async function linkSpeakers(transcriptId: string, mapping: Map<string, string | null>) {
  const pairs = [...mapping.entries()].map(([label, personId]) => ({ label, personId }));
  await runQuery(
    `UNWIND $pairs AS pair
     MATCH (:Transcript {id: $transcriptId})-[:HAS_SEGMENT]->(s:Segment {speakerLabel: pair.label})
     OPTIONAL MATCH (s)-[r:SPOKEN_BY]->()
     DELETE r`,
    { transcriptId, pairs },
  );
  await runQuery(
    `UNWIND $pairs AS pair
     MATCH (:Transcript {id: $transcriptId})-[:HAS_SEGMENT]->(s:Segment {speakerLabel: pair.label}), (p:Person {id: pair.personId})
     CREATE (s)-[:SPOKEN_BY]->(p)`,
    { transcriptId, pairs: pairs.filter((p) => p.personId) },
  );
  const names = await runQuery<{ id: string; name: string }>(
    "MATCH (p:Person) WHERE p.id IN $ids RETURN p.id AS id, p.name AS name",
    { ids: pairs.map((p) => p.personId).filter(Boolean) },
  );
  const speakers = pairs.map((p) => ({ ...p, name: names.find((n) => n.id === p.personId)?.name ?? null }));
  await runQuery("MATCH (t:Transcript {id: $transcriptId}) SET t.speakers = $speakers, t.updatedAt = $now", {
    transcriptId,
    speakers: JSON.stringify(speakers),
    now: nowIso(),
  });
  return speakers;
}

/**
 * Stores a hearing transcript as a new version: numbered turns (Segments), speakers linked to
 * people, embeddings queued. Earlier versions are kept with `current: false`.
 */
export async function createTranscript(hearingId: string, input: CreateTranscriptInput, opts: { background?: boolean } = {}) {
  const hearing = await requireHearing(hearingId);
  const overrides = input.speakerMap ?? {};
  await checkOverrides(hearing.caseId, overrides);

  const hash = createHash("sha256").update(input.text).digest("hex");
  const latest = await queryOne<{ t: TranscriptNode }>(
    `MATCH (:Hearing {id: $hearingId})-[:RECORDED_IN]->(t:Transcript)
     RETURN t {.*} AS t ORDER BY t.version DESC LIMIT 1`,
    { hearingId },
  );
  if (latest?.t.hash === hash && latest.t.current) {
    return { transcript: await getTranscript(hearingId), created: false };
  }

  const isKnown = await knownLabelChecker(hearing.caseId, hearingId);
  const overrideLabels = new Set(Object.keys(overrides).map((l) => l.toLowerCase()));
  const parsed = parseTranscript(input.text, (l) => overrideLabels.has(l.toLowerCase()) || isKnown(l));
  if (!parsed.turns.length) {
    throw ApiError.badRequest('No speaker turns found. Each turn should start with "Speaker: ..."');
  }

  const id = randomUUID();
  const now = nowIso();
  const version = (latest?.t.version ?? 0) + 1;
  await runQuery("MATCH (:Hearing {id: $hearingId})-[:RECORDED_IN]->(t:Transcript) SET t.current = false", {
    hearingId,
  });
  await runQuery(
    `MATCH (h:Hearing {id: $hearingId})
     CREATE (h)-[:RECORDED_IN]->(:Transcript {id: $id, hearingId: $hearingId, caseId: $caseId, version: $version,
       current: true, hash: $hash, header: $header, segmentCount: $count, speakers: '[]', status: 'extracted', analysis: 'pending',
       note: null, error: null, createdAt: $now, updatedAt: $now})`,
    { hearingId, id, caseId: hearing.caseId, version, hash, header: parsed.header, count: parsed.turns.length, now },
  );

  for (let i = 0; i < parsed.turns.length; i += SEGMENT_WRITE_BATCH) {
    await runQuery(
      `MATCH (t:Transcript {id: $id})
       UNWIND $turns AS turn
       CREATE (t)-[:HAS_SEGMENT]->(:Segment {id: turn.id, transcriptId: $id, hearingId: $hearingId, caseId: $caseId,
         seq: turn.seq, speakerLabel: turn.speakerLabel, time: turn.time, text: turn.text})`,
      {
        id,
        hearingId,
        caseId: hearing.caseId,
        turns: parsed.turns.slice(i, i + SEGMENT_WRITE_BATCH).map((t) => ({ ...t, id: randomUUID() })),
      },
    );
  }

  const mapping = await resolveSpeakers(hearing.caseId, hearingId, parsed.labels, overrides);
  await linkSpeakers(id, mapping);
  if (opts.background !== false) {
    queueTranscriptEmbedding(id);
    queueTranscriptAnalysis(id);
  }

  return { transcript: await getTranscript(hearingId), created: true };
}

/** Lawyer fixes speaker labels after upload. Turn numbers never change. */
export async function updateSpeakers(transcriptId: string, overrides: Record<string, string>) {
  const t = await requireTranscript(transcriptId);
  await checkOverrides(t.caseId, overrides);
  const current = new Map<string, string | null>(
    (JSON.parse(t.speakers) as { label: string; personId: string | null }[]).map((s) => [s.label, s.personId]),
  );
  for (const [label, personId] of Object.entries(overrides)) {
    const key = [...current.keys()].find((l) => l.toLowerCase() === label.toLowerCase());
    if (!key) throw ApiError.badRequest(`speakerMap: "${label}" is not a speaker in this transcript`);
    current.set(key, personId);
  }
  await linkSpeakers(transcriptId, current);
  return getTranscript(t.hearingId, { version: t.version });
}

export async function listTranscriptVersions(hearingId: string) {
  await requireHearing(hearingId);
  return runQuery(
    `MATCH (:Hearing {id: $hearingId})-[:RECORDED_IN]->(t:Transcript)
     RETURN t {.id, .version, .current, .segmentCount, .status, .createdAt} AS transcript ORDER BY t.version DESC`,
    { hearingId },
  );
}

/** Current (or a given) version with its turns; `from`/`to` select a range of turn numbers. */
export async function getTranscript(hearingId: string, query: SegmentsQuery = {}) {
  await requireHearing(hearingId);
  const row = await queryOne<{ t: TranscriptNode }>(
    `MATCH (:Hearing {id: $hearingId})-[:RECORDED_IN]->(t:Transcript)
     WHERE ($version IS NULL AND t.current = true) OR t.version = $version
     RETURN t {.*} AS t`,
    { hearingId, version: query.version ?? null },
  );
  if (!row) throw ApiError.notFound(query.version ? `Transcript version ${query.version} not found` : "No transcript for this hearing");
  const { hash: _h, speakers, ...t } = row.t;
  const segments = await runQuery(
    `MATCH (:Transcript {id: $id})-[:HAS_SEGMENT]->(s:Segment)
     WHERE ($from IS NULL OR s.seq >= $from) AND ($to IS NULL OR s.seq <= $to)
     OPTIONAL MATCH (s)-[:SPOKEN_BY]->(p:Person)
     RETURN s.id AS id, s.seq AS seq, s.speakerLabel AS speakerLabel, s.time AS time, s.text AS text,
            CASE WHEN p IS NULL THEN NULL ELSE {id: p.id, name: p.name, kind: [l IN labels(p) WHERE l <> 'Person'][0]} END AS speaker,
            s.embedding IS NOT NULL AS embedded
     ORDER BY s.seq`,
    { id: t.id, from: query.from ?? null, to: query.to ?? null },
  );
  const parsedSpeakers = JSON.parse(speakers) as { label: string; personId: string | null; name: string | null }[];
  return {
    ...t,
    speakers: parsedSpeakers,
    unmatchedSpeakers: parsedSpeakers.filter((s) => !s.personId).map((s) => s.label),
    segments,
  };
}
