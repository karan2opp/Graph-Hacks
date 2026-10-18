import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { client, startServer, type Client, type TestServer } from "./helpers.js";

let srv: TestServer;
let c: Client;
let caseId: string;

before(async () => {
  srv = await startServer();
  const { seed } = await import("../src/scripts/seed.js");
  const out = await seed();
  caseId = out.caseId;
  c = client(srv.base);
  const login = await c.post("/auth/login", { email: out.email, password: out.password });
  assert.equal(login.status, 200);
});
after(async () => srv.close());

describe("demo seed through the API", () => {
  it("has five case cards with what needs attention", async () => {
    const res = await c.get("/cases");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.length, 5);
    const kumar = res.body.data.find((x: { case: { id: string } }) => x.case.id === caseId);
    assert.equal(kumar.nextHearing.date, "2026-10-24");
    assert.equal(kumar.overdue, 1);
    assert.equal(kumar.newContradictions, 3);
    assert.equal(kumar.linked.length, 2);
    assert.equal(kumar.hearings, 10);
  });

  it("builds the firm dashboard", async () => {
    const res = await c.get("/dashboard");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.overdue.length, 2);
    assert.equal(res.body.data.nextHearing.date, "2026-10-24");
    assert.equal(res.body.data.newContradictions[0].count, 3);
  });

  it("records the planted contradictions with both citations", async () => {
    const res = await c.get(`/cases/${caseId}/contradictions`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 4);
    const self = res.body.data.filter((x: { category: string }) => x.category === "self");
    assert.equal(self.length, 3);
    const first = res.body.data[0];
    assert.ok(first.earlier.source && first.later.source);
  });

  it("works out direction states", async () => {
    const res = await c.get(`/cases/${caseId}/directions`);
    const states = res.body.data.map((d: { state: string }) => d.state).sort();
    assert.deepEqual(states, ["complied", "complied", "in_force", "overdue", "pending", "vacated"]);
  });

  it("keeps the transcript turns with matched speakers", async () => {
    const hearings = await c.get(`/cases/${caseId}/hearings`);
    const cross = hearings.body.data.find((h: { hearing: { date: string } }) => h.hearing.date === "2024-07-19");
    const t = await c.get(`/hearings/${cross.hearing.id}/transcript`);
    assert.equal(t.body.data.segments.length, 8);
    assert.deepEqual(t.body.data.unmatchedSpeakers, []);
  });

  it("lists documents with their processing state", async () => {
    const res = await c.get(`/cases/${caseId}/documents`);
    const statuses = res.body.data.map((d: { document: { status: string } }) => d.document.status);
    assert.ok(statuses.includes("stored"));
    assert.ok(statuses.includes("extracted"));
    assert.ok(statuses.filter((s: string) => s === "ready").length >= 9);
  });
});

describe("case brief and findings review", () => {
  it("builds the brief for the next hearing", async () => {
    const res = await c.get(`/cases/${caseId}/brief`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const b = res.body.data;
    assert.equal(b.nextHearing.date, "2026-10-24");
    assert.equal(b.overdue.length, 1);
    assert.equal(b.dueBeforeNextHearing.length, 1);
    assert.equal(b.forCross.length, 3);
    assert.equal(b.timeline.length, 10);
    assert.ok(b.timeline.some((h: { contradiction: boolean }) => h.contradiction));
    assert.ok(b.activity.length > 0);
    // Regression: a direction due in the future must not show up as a missed deadline.
    const missed = b.activity.filter((a: { agent: string }) => a.agent === "compliance");
    assert.ok(missed.every((a: { text: string }) => !a.text.includes("22.10.2026")), JSON.stringify(missed));
  });

  it("lets a lawyer dismiss a finding and flag one for cross", async () => {
    const list = await c.get(`/cases/${caseId}/contradictions`);
    const [first, second] = list.body.data;
    const flagged = await c.patch(`/links/${first.id}`, { crossPrep: true, note: "Use in cross" });
    assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
    assert.equal(flagged.body.data.crossPrep, true);

    const dismissed = await c.patch(`/links/${second.id}`, { dismissed: true });
    assert.equal(dismissed.body.data.dismissed, true);
    assert.equal((await c.get(`/cases/${caseId}/contradictions`)).body.data.length, 3);
    assert.equal((await c.get(`/cases/${caseId}/contradictions?includeDismissed=true`)).body.data.length, 4);

    assert.equal((await c.patch(`/links/${second.id}`, {})).status, 422);
    await c.patch(`/links/${second.id}`, { dismissed: false });
  });

  it("refuses to re-run agents without an OpenAI key", async () => {
    const res = await c.post(`/cases/${caseId}/factcheck`);
    assert.equal(res.status, 503);
  });
});
