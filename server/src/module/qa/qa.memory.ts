import { randomUUID } from "node:crypto";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import type { Citation } from "./qa.citations.js";
import type { TraceStep } from "./qa.tools.js";

/**
 * Conversations live in the graph next to the case, so the assistant remembers across sessions
 * and every answer is linked to the evidence it cited:
 *   (Case)-[:HAS_CONVERSATION]->(Conversation)-[:HAS_MESSAGE]->(Message)-[:CITES]->(Claim|Chunk|Segment|Direction|Document|Hearing)
 */

const LABEL_OF: Record<Citation["kind"], string> = {
  claim: "Claim",
  chunk: "Chunk",
  segment: "Segment",
  direction: "Direction",
  document: "Document",
  hearing: "Hearing",
};

export async function startConversation(caseId: string, title: string): Promise<string> {
  const id = randomUUID();
  await runQuery(
    `MATCH (c:Case {id: $caseId})
     CREATE (c)-[:HAS_CONVERSATION]->(:Conversation {id: $id, caseId: $caseId, title: $title, createdAt: $now, updatedAt: $now})`,
    { caseId, id, title: title.slice(0, 120), now: nowIso() },
  );
  return id;
}

export async function requireConversation(conversationId: string, caseId?: string) {
  const row = await queryOne<{ caseId: string }>(
    "MATCH (c:Conversation {id: $conversationId}) RETURN c.caseId AS caseId",
    { conversationId },
  );
  if (!row || (caseId && row.caseId !== caseId)) throw ApiError.notFound("Conversation not found");
  return row;
}

/** The last turns, oldest first, as chat history for the model. */
export async function recentHistory(conversationId: string, limit = 8) {
  const rows = await runQuery<{ role: "user" | "assistant"; text: string }>(
    `MATCH (:Conversation {id: $conversationId})-[:HAS_MESSAGE]->(m:Message)
     RETURN m.role AS role, m.text AS text, m.seq AS seq ORDER BY seq DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
    { conversationId },
  );
  return rows.reverse();
}

export async function saveMessage(
  conversationId: string,
  message: { role: "user" | "assistant"; text: string; citations?: Citation[]; trace?: TraceStep[]; hearingId?: string | null },
): Promise<string> {
  const id = randomUUID();
  const now = nowIso();
  await runQuery(
    `MATCH (c:Conversation {id: $conversationId})
     OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(prev:Message)
     WITH c, count(prev) AS n
     CREATE (c)-[:HAS_MESSAGE]->(:Message {id: $id, seq: n + 1, role: $role, text: $text, citations: $citations,
       trace: $trace, hearingId: $hearingId, createdAt: $now})
     SET c.updatedAt = $now`,
    {
      conversationId,
      id,
      role: message.role,
      text: message.text,
      citations: JSON.stringify(message.citations ?? []),
      trace: JSON.stringify(message.trace ?? []),
      hearingId: message.hearingId ?? null,
      now,
    },
  );
  for (const [kind, label] of Object.entries(LABEL_OF)) {
    const nodeIds = (message.citations ?? []).filter((c) => c.kind === kind).map((c) => c.nodeId);
    if (!nodeIds.length) continue;
    await runQuery(
      `MATCH (m:Message {id: $id}) UNWIND $nodeIds AS nid MATCH (n:${label} {id: nid}) CREATE (m)-[:CITES]->(n)`,
      { id, nodeIds },
    );
  }
  return id;
}

export async function listConversations(caseId: string) {
  return runQuery(
    `MATCH (:Case {id: $caseId})-[:HAS_CONVERSATION]->(c:Conversation)
     OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:Message)
     WITH c, count(m) AS messages
     RETURN c {.id, .title, .createdAt, .updatedAt} AS conversation, messages
     ORDER BY c.updatedAt DESC`,
    { caseId },
  );
}

export async function getConversation(conversationId: string) {
  await requireConversation(conversationId);
  const conv = await queryOne(
    "MATCH (c:Conversation {id: $conversationId}) RETURN c {.id, .caseId, .title, .createdAt, .updatedAt} AS c",
    { conversationId },
  );
  const messages = await runQuery<{ id: string; seq: number; role: string; text: string; citations: string; trace: string; createdAt: string }>(
    `MATCH (:Conversation {id: $conversationId})-[:HAS_MESSAGE]->(m:Message)
     RETURN m.id AS id, m.seq AS seq, m.role AS role, m.text AS text, m.citations AS citations, m.trace AS trace, m.createdAt AS createdAt
     ORDER BY m.seq`,
    { conversationId },
  );
  return {
    ...(conv?.c as object),
    messages: messages.map((m) => ({ ...m, citations: JSON.parse(m.citations), trace: JSON.parse(m.trace) })),
  };
}
