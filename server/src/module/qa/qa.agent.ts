import type OpenAI from "openai";
import { getOpenAI } from "../../common/ai/index.js";
import { queryOne } from "../../common/db/index.js";
import { ApiError, todayIST } from "../../common/utils/index.js";
import { env } from "../../config/env.js";
import { listPeople, requireCase } from "../case/index.js";
import { CitationRegistry, fmtDate, type Citation } from "./qa.citations.js";
import { evidenceGraph } from "./qa.graph.js";
import { recentHistory, requireConversation, saveMessage, startConversation } from "./qa.memory.js";
import { runTool, toolDefinitions, type ToolContext, type TraceStep } from "./qa.tools.js";

const MAX_TOOL_ROUNDS = 6;

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

async function systemPrompt(caseId: string, hearingId: string | null) {
  const c = await requireCase(caseId);
  const people = await listPeople(caseId);
  const cast = people
    .filter((p) => p.kind !== "Judge")
    .map((p) =>
      p.kind === "Party"
        ? `${p.name} (${p.role})`
        : p.kind === "Lawyer"
          ? `${p.name} (counsel for ${p.represents.map((r) => r.name).join(", ")})`
          : `${p.name} (${p.code ?? "witness"}${p.calledBy ? `, called by ${p.calledBy.name}` : ""})`,
    )
    .join("; ");
  const open = hearingId
    ? await queryOne<{ date: string }>("MATCH (h:Hearing {id: $hearingId}) RETURN h.date AS date", { hearingId })
    : null;

  return `You are the case assistant for lawyers working on ${c.caseNumber}, "${c.title}" (${c.court}, ${c.caseType}; stage: ${c.stage}).
Today is ${fmtDate(todayIST())}. People: ${cast || "none recorded"}.${open ? `\nThe lawyer has the hearing of ${fmtDate(open.date)} open: "this hearing" means that one.` : ""}

You answer questions about this one case using tools over its memory graph: hearings, orders and directions,
documents, hearing transcripts, extracted claims, and the contradictions and compliance found by other agents.

Rules:
- Find facts with tools. Never answer from general knowledge or assumptions about the case.
- End every factual sentence with the refs of its sources, like [S3] or [S2, S5], copied from tool results. Never invent refs.
- Keep the court's record apart from what someone claimed: "the court directed..." vs "the defendant stated...".
- When sources conflict, say so and cite both. Mention contradictions or overdue directions when they bear on the question.
- If the tools do not contain the answer, say what is missing. Do not guess. A sentence saying something
  is NOT in the record has no refs at all: a ref must back up what that source actually says.
- Lead with the answer in one or two sentences, then short bullet points. Write dates like 15 Apr 2021.
- Private lawyer notes are internal; say so when you rely on one.
- You are a case-memory aid, not legal advice. Give strategy suggestions only if asked, and label them as suggestions.`;
}

export interface AskInput {
  caseId: string;
  question: string;
  conversationId?: string;
  hearingId?: string | null;
}

export interface AskResult {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: Citation[];
  trace: TraceStep[];
  graph: Awaited<ReturnType<typeof evidenceGraph>>;
}

/**
 * The Q&A agent: a tool-calling loop over fixed graph queries. Returns the answer, the sources it
 * cited, the tools it used (the path it took) and the evidence subgraph, and stores the exchange
 * in the conversation's memory.
 */
export async function askCase(input: AskInput): Promise<AskResult> {
  await requireCase(input.caseId);
  if (input.hearingId) {
    const h = await queryOne("MATCH (h:Hearing {id: $id, caseId: $caseId}) RETURN h.id AS id", {
      id: input.hearingId,
      caseId: input.caseId,
    });
    if (!h) throw ApiError.badRequest("hearingId: hearing not in this case");
  }
  const conversationId = input.conversationId
    ? (await requireConversation(input.conversationId, input.caseId), input.conversationId)
    : await startConversation(input.caseId, input.question);

  const ctx: ToolContext = {
    caseId: input.caseId,
    hearingId: input.hearingId ?? null,
    cites: new CitationRegistry(),
    trace: [],
  };
  const history = await recentHistory(conversationId);
  const messages: Msg[] = [
    { role: "system", content: await systemPrompt(input.caseId, ctx.hearingId) },
    ...history.map((m) => ({ role: m.role, content: m.text }) as Msg),
    { role: "user", content: input.question },
  ];

  const client = getOpenAI();
  let answer = "";
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    const res = await client.chat.completions.create({
      model: env.OPENAI_REASONING_MODEL,
      // Chat Completions only allows function tools with reasoning off for this model family.
      reasoning_effort: "none",
      messages,
      tools: toolDefinitions,
      tool_choice: lastRound ? "none" : "auto",
    });
    const msg = res.choices[0]!.message;
    if (!msg.tool_calls?.length) {
      answer = msg.content?.trim() ?? "";
      break;
    }
    messages.push(msg);
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const result = await runTool(ctx, call.function.name, call.function.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  if (!answer) answer = "I could not find an answer in the case record.";

  const citations = ctx.cites.used(answer);
  await saveMessage(conversationId, { role: "user", text: input.question, hearingId: ctx.hearingId });
  const messageId = await saveMessage(conversationId, {
    role: "assistant",
    text: answer,
    citations,
    trace: ctx.trace,
    hearingId: ctx.hearingId,
  });

  return { conversationId, messageId, answer, citations, trace: ctx.trace, graph: await evidenceGraph(citations) };
}
