import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { newFirm, startServer, type Client, type TestServer } from "./helpers.js";

let srv: TestServer;
let a: Client;
let b: Client;
let caseId: string;
let hearingId: string;
let documentId: string;

before(async () => {
  srv = await startServer();
  a = (await newFirm(srv.base, "Firm A")).c;
  b = (await newFirm(srv.base, "Firm B")).c;

  const kase = await a.post("/cases", { caseNumber: "CS 412/2020", title: "Ramesh Kumar v. Suresh Gupta", court: "Civil Judge (Sr. Div.)", caseType: "civil" });
  assert.equal(kase.status, 201);
  caseId = kase.body.data.id;
  const h = await a.post(`/cases/${caseId}/hearings`, { date: "2021-03-10", purpose: "Written statement" });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  hearingId = h.body.data.hearing.id;
  const d = await a.post(`/cases/${caseId}/documents`, { title: "Written statement", type: "written_statement", text: "1. The defendant denies receipt." });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  documentId = d.body.data.id;
});
after(async () => srv.close());

describe("firm isolation", () => {
  it("lists only the firm's own cases", async () => {
    assert.equal((await a.get("/cases")).body.data.length, 1);
    assert.equal((await b.get("/cases")).body.data.length, 0);
  });

  it("answers 404 for another firm's case, hearing and document", async () => {
    for (const path of [`/cases/${caseId}`, `/cases/${caseId}/people`, `/hearings/${hearingId}`, `/documents/${documentId}`, `/cases/${caseId}/directions`]) {
      const res = await b.get(path);
      assert.equal(res.status, 404, path);
    }
  });

  it("blocks writes into another firm's case", async () => {
    assert.equal((await b.patch(`/cases/${caseId}`, { stage: "arguments" })).status, 404);
    assert.equal((await b.post(`/cases/${caseId}/people`, { kind: "judge", name: "Ms. X" })).status, 404);
    assert.equal((await b.post(`/cases/${caseId}/documents`, { title: "x", type: "note", text: "x" })).status, 404);
  });

  it("refuses to link a case from another firm", async () => {
    const other = await b.post("/cases", { caseNumber: "CS 1/2024", title: "Other v. Other", court: "Civil Judge", caseType: "civil" });
    const res = await a.post(`/cases/${caseId}/links`, { linkedCaseId: other.body.data.id });
    assert.equal(res.status, 404);
  });

  it("lets two firms use the same case number", async () => {
    const res = await b.post("/cases", { caseNumber: "CS 412/2020", title: "Same number", court: "Civil Judge (Sr. Div.)", caseType: "civil" });
    assert.equal(res.status, 201);
  });

  it("still serves the owner", async () => {
    assert.equal((await a.get(`/cases/${caseId}`)).status, 200);
    assert.equal((await a.get(`/documents/${documentId}`)).status, 200);
  });
});

describe("shared services", () => {
  it("exposes no direct file storage routes", async () => {
    assert.equal((await a.del("/media/some-file-id")).status, 404);
    assert.equal((await a.get("/media/auth")).status, 404);
  });

  it("caps each firm's calls to the AI agents per hour", async () => {
    const { c } = await newFirm(srv.base, "Busy firm");
    const kase = await c.post("/cases", { caseNumber: "CS 7/2024", title: "Busy v. Busy", court: "Civil Judge", caseType: "civil" });
    const ask = () => c.post(`/cases/${kase.body.data.id}/ask`, { question: "What is pending?" });
    for (let i = 0; i < 60; i++) assert.notEqual((await ask()).status, 429, `call ${i + 1}`);
    const res = await ask();
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "RATE_LIMITED");
    // Another firm has its own budget.
    assert.notEqual((await a.post(`/cases/${caseId}/ask`, { question: "What is pending?" })).status, 429);
  });
});
