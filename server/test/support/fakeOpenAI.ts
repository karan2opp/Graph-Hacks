/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for the OpenAI API, so the whole pipeline (read, embed, extract claims and
 * directions, fact-check, compliance, Q&A) runs for real against the graph with no key and no
 * network. Answers are rule-based and deterministic: enough to drive every code path and to
 * predict exactly what lands in the graph, not to understand text.
 */

export interface FakeOpenAI {
  url: string;
  /** Every request, in order: path plus parsed JSON body. */
  calls: { path: string; body: any }[];
  /** What OCR returns for any image. */
  ocrText: string;
  close: () => Promise<void>;
}

// ---------------------------------------------------------------- embeddings

const STOP = new Set(
  "the and for with from that this was were are has have had any did does into about over under not his her its their our your you they them who what when where which will shall said been".split(" "),
);
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ed|es|s|e)$/, "") : w);

/** Bag of stemmed words hashed into the vector: texts that share words end up close. */
export function embed(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  const words = text.toLowerCase().replace(/(\d),(?=\d)/g, "$1").match(/[a-z0-9]+/g) ?? [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    let h = 2166136261;
    for (const ch of stem(w)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    v[(h >>> 0) % dims]! += 1;
  }
  if (!v.some(Boolean)) v[0] = 1;
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0));
  return v.map((x) => x / norm);
}

// ---------------------------------------------------------------- reading prompts

const NEG = /\b(not|never|no|den(?:y|ies|ied))\b/i;
const PARA_NUMBER = /^\s*\(?(\d{1,3}|[ivxlc]{1,6})[.)]\s+/i;

/** "[C3] (page 1, para 2)" / "[T4] Turn 4. DW1 (= Mohan Lal):" blocks, up to the end of the prompt. */
function blocks(prompt: string) {
  const marks = [...prompt.matchAll(/^\[([CT]\d+)\] (.*)$/gm)];
  return marks.map((m, i) => ({
    ref: m[1]!,
    label: m[2]!,
    text: prompt.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1]!.index : prompt.length).trim(),
  }));
}

/** Sentences of a block; in a numbered document only the numbered paragraphs count (not headings). */
function sentences(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const numbered = lines.some((l) => PARA_NUMBER.test(l));
  const paras: string[] = [];
  for (const line of lines) {
    if (PARA_NUMBER.test(line)) paras.push(line.replace(PARA_NUMBER, ""));
    else if (numbered && paras.length) paras[paras.length - 1] += ` ${line}`;
    else if (!numbered) paras.push(line);
  }
  return paras.flatMap((p) => p.split(/(?<=[.?!])\s+(?=[A-Z])/)).map((s) => s.trim()).filter(Boolean);
}

function people(prompt: string) {
  return [...prompt.matchAll(/^(P\d+): (.+?) \((\w+)(?:, ([a-z]+))?/gm)].map((m) => ({ ref: m[1]!, name: m[2]!, kind: m[3]!, role: m[4] ?? null }));
}

function existingSubjects(prompt: string) {
  return [...prompt.matchAll(/^(S\d+): (.+) \((\w+)\)$/gm)].map((m) => ({ ref: m[1]!, name: m[2]!, type: m[3]! }));
}

const isoFrom = (ddmmyyyy: RegExpExecArray | null) => (ddmmyyyy ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}` : null);
const DMY = /(\d{2})\.(\d{2})\.(\d{4})/;
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- the agents' structured outputs

function subjectsOf(sentence: string, existing: ReturnType<typeof existingSubjects>) {
  const found: { name: string; type: string }[] = [];
  const money = /Rs\.?\s*([\d,]+)/.exec(sentence);
  const moneyName = money ? `Payment of Rs. ${money[1]}` : /\b(amount|loan)\b/i.test(sentence) ? existing.find((s) => s.type === "money")?.name : undefined;
  if (moneyName) found.push({ name: moneyName, type: "money" });
  const shop = /Shop No\.?\s*(\d+)/i.exec(sentence);
  if (shop) found.push({ name: `Shop No. ${shop[1]}`, type: "property" });
  if (!found.length) found.push({ name: sentence.split(/\s+/).slice(0, 4).join(" "), type: "other" });
  return found.map((f) => ({ ref: existing.find((s) => s.name.toLowerCase() === f.name.toLowerCase())?.ref ?? null, ...f }));
}

function claims(prompt: string) {
  const existing = existingSubjects(prompt);
  const out = [];
  for (const b of blocks(prompt)) {
    if (/\b(court|judge)\b/i.test(b.label)) continue; // the bench gives directions, not claims
    for (const s of sentences(b.text)) {
      if (s.endsWith("?") || s.split(/\s+/).length < 4) continue;
      out.push({
        source: b.ref,
        text: s,
        quote: s,
        madeBy: null,
        onBehalfOf: null,
        kind: NEG.test(s) ? "denial" : /^I\b/.test(s) ? "admission" : "allegation",
        eventDate: isoFrom(DMY.exec(s)),
        subjects: subjectsOf(s, existing),
      });
    }
  }
  return { claims: out };
}

function courtOrder(prompt: string) {
  const orderDate = /^ORDER DATE: (\d{4}-\d{2}-\d{2})/m.exec(prompt)?.[1] ?? null;
  const cast = people(prompt);
  const inForce = prompt.split("ALREADY IN FORCE:")[1]?.split("ORDER TEXT:")[0] ?? "";
  const directions = [];
  let nextHearing: { date: string | null; purpose: string | null } = { date: null, purpose: null };
  const all: string[] = [];
  for (const b of blocks(prompt)) {
    for (const s of sentences(b.text)) {
      all.push(s);
      const put = /(?:put up|listed|adjourned to)(?: on)? (\d{2}\.\d{2}\.\d{4})(?: for (.+?))?\.?$/i.exec(s);
      if (put) {
        nextHearing = { date: isoFrom(DMY.exec(put[1]!)), purpose: put[2] ?? null };
        continue;
      }
      if (/vacated|discharged/i.test(s)) continue; // lifting an order is not a direction
      const text = s.replace(/^(plaintiff|defendant|parties) to /i, (_, who: string) => `The ${who.toLowerCase()} shall `);
      if (/status quo/i.test(s)) {
        if (/continue/i.test(s) && /status quo/i.test(inForce)) continue; // only continues one in force
        directions.push({ source: b.ref, text, kind: "stay", assignedTo: [], dueDate: null, dueText: null });
      } else if (/\b(to file|to deposit|to pay|shall)\b/i.test(s)) {
        const role = /\b(plaintiff|defendant)\b/i.exec(s)?.[1]!.toLowerCase();
        const within = /within (\d+) (day|week)s?/i.exec(s);
        directions.push({
          source: b.ref,
          text,
          kind: /deposit|pay|costs/i.test(s) ? "costs" : "direction",
          assignedTo: cast.filter((p) => p.kind === "Party" && p.role === role).map((p) => p.ref),
          dueDate: within && orderDate ? addDays(orderDate, Number(within[1]) * (within[2] === "week" ? 7 : 1)) : null,
          dueText: within?.[0] ?? null,
        });
      }
    }
  }
  return { directions, nextHearing, orderKind: "procedural", summary: all.join(" ").slice(0, 200) };
}

const facts = (s: string) =>
  new Set([/\b(paid|pay|payment|received|receive|amount|loan|rs)\b/i.test(s) && "payment", /possession/i.test(s) && "possession"].filter(Boolean));
const nature = (s: string) => (/loan/i.test(s) ? "loan" : /\bsale\b/i.test(s) ? "sale" : null);

function factCheck(prompt: string) {
  console.log("FACTCHECK PROMPT>>>
" + prompt + "
<<<");
  const pairs = [...prompt.matchAll(/^\[(R\d+)\][^\n]*\n\s*A \(.*?\): ([^\n]*)\n[^\n]*\n\s*B \(.*?\): ([^\n]*)$/gm)];
  return {
    verdicts: pairs.map(([, pair, a, b]) => {
      const fa = facts(a!);
      const shared = [...facts(b!)].find((f) => fa.has(f));
      if (!shared) return { pair, fact: "none", bothTrue: true, relation: "unrelated", severity: "low", reason: "They speak to different facts." };
      const conflict = NEG.test(a!) !== NEG.test(b!) || (nature(a!) && nature(b!) && nature(a!) !== nature(b!));
      return conflict
        ? { pair, fact: shared, bothTrue: false, relation: "contradicts", severity: "high", reason: `The two statements disagree about the ${shared}.` }
        : { pair, fact: shared, bothTrue: true, relation: "supports", severity: "medium", reason: `Both statements confirm the ${shared}.` };
    }),
  };
}

function complianceMatch(prompt: string) {
  return {
    results: prompt.split(/\n\n---\n\n/).map((part) => {
      const direction = /^DIRECTION: (.*)$/m.exec(part)?.[1] ?? "";
      const type = /^DOCUMENT: .*\(type ([^,]+),/m.exec(part)?.[1] ?? "";
      const fulfils = Boolean(type) && direction.toLowerCase().includes(type.toLowerCase());
      return { pair: /^\[(M\d+)\]/.exec(part)?.[1] ?? "", fulfils, reason: fulfils ? `The ${type} is the filing the court asked for.` : "A different filing." };
    }),
  };
}

function orderCompliance(prompt: string) {
  const order = prompt.split(/^NEW ORDER: .*$/m)[1] ?? "";
  return {
    outcomes: [...prompt.matchAll(/^(D\d+): (.*)$/gm)].map(([, ref, direction]) => {
      const lifted = /^.*status quo.*vacated.*$/im.exec(order);
      if (/status quo/i.test(direction!) && lifted)
        return { ref, outcome: "vacated", quote: lifted[0].replace(PARA_NUMBER, "").trim(), reason: "The later order lifts it." };
      if (/written statement/i.test(direction!) && /written statement filed/i.test(order))
        return { ref, outcome: "complied", quote: "Written statement filed", reason: "The order records the filing." };
      return { ref, outcome: "no_mention", quote: "", reason: "Not mentioned." };
    }),
  };
}

// ---------------------------------------------------------------- the Q&A agent

/** Which tools a question calls for. */
function plan(question: string): { name: string; args: Record<string, unknown> }[] {
  const date = /(\d{4}-\d{2}-\d{2})/.exec(question)?.[1];
  if (/contradict/i.test(question)) return [{ name: "get_contradictions", args: { category: /themselves|self/i.test(question) ? "self" : null } }];
  if (date) return [{ name: "get_hearing", args: { date, which: null } }];
  if (/\b(direct|directions|comply|complied)\b/i.test(question)) return [{ name: "get_directions", args: { status: null } }];
  return [{ name: "search_case", args: { query: question } }];
}

/** Items a tool returned that carry a citation ref and say something. */
function citable(value: unknown, out: any[] = []): any[] {
  if (Array.isArray(value)) value.forEach((v) => citable(v, out));
  else if (value && typeof value === "object") {
    const o = value as any;
    if (typeof o.ref === "string" && (o.claim || o.direction || o.text)) out.push(o);
    Object.values(o).forEach((v) => citable(v, out));
  }
  return out;
}

function agent(body: any) {
  const msgs: any[] = body.messages;
  const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
  const question: string = msgs[lastUser].content;
  const toolResults = msgs.slice(lastUser + 1).filter((m) => m.role === "tool");
  if (!toolResults.length && body.tool_choice !== "none") {
    const calls = plan(question).map((c, i) => ({ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    return { tool_calls: calls };
  }
  const items = toolResults.flatMap((m) => citable(JSON.parse(m.content))).slice(0, 4);
  if (!items.length) return { content: "The case record does not answer this." };
  const lines = items.map((i) => `- ${i.claim ?? i.direction ?? i.text} [${i.ref}]`);
  return { content: `From the record:\n${lines.join("\n")}` };
}

// ---------------------------------------------------------------- server

const STRUCTURED: Record<string, (prompt: string) => unknown> = {
  claims,
  court_order: courtOrder,
  fact_check: factCheck,
  compliance_match: complianceMatch,
  order_compliance: orderCompliance,
};

function completion(message: Record<string, unknown>) {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "fake",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: null, refusal: null, ...message },
        finish_reason: message.tool_calls ? "tool_calls" : "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function respond(fake: FakeOpenAI, path: string, body: any): unknown {
  if (path.endsWith("/embeddings")) {
    const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
    return {
      object: "list",
      model: body.model,
      data: inputs.map((text, index) => ({ object: "embedding", index, embedding: embed(text, body.dimensions ?? 1536) })),
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  }
  if (path.endsWith("/chat/completions")) {
    if (body.tools) return completion(agent(body));
    const content = body.messages[0]?.content;
    if (Array.isArray(content) && content.some((p: any) => p.type === "image_url")) return completion({ content: fake.ocrText });
    const name: string = body.response_format?.json_schema?.name;
    const handler = STRUCTURED[name];
    if (!handler) throw new Error(`fake OpenAI: no handler for response format "${name}"`);
    const user = body.messages.find((m: any) => m.role === "user")?.content ?? "";
    return completion({ content: JSON.stringify(handler(user)) });
  }
  throw new Error(`fake OpenAI: unexpected ${path}`);
}

export async function startFakeOpenAI(): Promise<FakeOpenAI> {
  const fake = { calls: [], ocrText: "" } as unknown as FakeOpenAI;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = req.url ?? "";
      try {
        const body = raw ? JSON.parse(raw) : {};
        fake.calls.push({ path, body });
        const out = respond(fake, path, body);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: (e as Error).message } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  fake.close = () => new Promise<void>((r) => server.close(() => r()));
  return fake;
}
