import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { newFirm, startServer, type TestServer } from "./helpers.js";

let srv: TestServer;
before(async () => {
  srv = await startServer();
});
after(async () => srv.close());

describe("loading the demo cases into a firm", () => {
  it("adds five cases with their findings, once, and only to that firm", async () => {
    const { c } = await newFirm(srv.base);
    const other = await newFirm(srv.base);

    assert.equal((await c.get("/demo")).body.data.loaded, false);
    assert.equal((await c.get("/cases")).body.data.length, 0);

    const first = await c.post("/demo");
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.loaded, true);
    assert.ok(first.body.data.caseId);

    assert.equal((await c.get("/demo")).body.data.loaded, true);
    const cards = (await c.get("/cases")).body.data;
    assert.equal(cards.length, 5);

    // the main case is complete and linked to the counter-suit and the criminal case
    const kumar = cards.find((x: { case: { id: string } }) => x.case.id === first.body.data.caseId);
    assert.equal(kumar.linked.length, 2);
    assert.equal((await c.get(`/cases/${kumar.case.id}/contradictions`)).body.data.length, 4);

    // the criminal case: FIR against a prosecution witness, and a pending direction
    const crim = cards.find((x: { case: { caseType: string } }) => x.case.caseType === "criminal");
    assert.equal(crim.case.title, "State v. Suresh Gupta");
    const contra = (await c.get(`/cases/${crim.case.id}/contradictions`)).body.data;
    assert.equal(contra.length, 2);
    assert.ok(contra.every((x: { category: string }) => x.category === "record"));
    const dirs = (await c.get(`/cases/${crim.case.id}/directions`)).body.data;
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0].state, "pending");

    // nothing was queued for the agents: documents are already analysed
    const docs = (await c.get(`/cases/${crim.case.id}/documents`)).body.data;
    assert.ok(docs.every((d: { document: { analysis?: string; status: string } }) => d.document.status === "ready"));

    // loading again changes nothing
    const again = await c.post("/demo");
    assert.equal(again.body.data.loaded, false);
    assert.equal((await c.get("/cases")).body.data.length, 5);

    // another firm sees nothing of it
    assert.equal((await other.c.get("/cases")).body.data.length, 0);
    assert.equal((await other.c.get("/demo")).body.data.loaded, false);
    assert.equal((await other.c.get(`/cases/${kumar.case.id}`)).status, 404);
  });

  it("needs a signed-in user", async () => {
    const res = await fetch(`${srv.base}/demo`, { method: "POST" });
    assert.equal(res.status, 401);
  });
});
