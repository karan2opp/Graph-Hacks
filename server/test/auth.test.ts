import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PASSWORD, client, newFirm, startServer, type TestServer } from "./helpers.js";

let srv: TestServer;
before(async () => (srv = await startServer()));
after(async () => srv.close());

describe("registration and sessions", () => {
  it("creates a firm owner and signs them in with an httpOnly cookie", async () => {
    const c = client(srv.base);
    const res = await c.post("/auth/register", { name: "Kavita Rao", email: "Kavita@Example.test", password: PASSWORD, firmName: "Rao Chambers" });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.email, "kavita@example.test");
    assert.equal(res.body.data.role, "owner");
    assert.equal(res.body.data.firmName, "Rao Chambers");
    assert.equal(res.body.data.passwordHash, undefined);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /cm_session=/);
    assert.match(setCookie, /HttpOnly/i);

    const me = await c.get("/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.data.name, "Kavita Rao");
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await client(srv.base).post("/auth/register", { name: "Other", email: "kavita@example.test", password: PASSWORD, firmName: "X Firm" });
    assert.equal(res.status, 409);
  });

  it("validates input with field-level errors", async () => {
    const res = await client(srv.base).post("/auth/register", { name: "A", email: "nope", password: "short", firmName: "" });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, "VALIDATION_ERROR");
    assert.ok(res.body.errors!.length > 0);
  });

  it("signs out and the old cookie stops working", async () => {
    const { c } = await newFirm(srv.base);
    const cookieBefore = c.cookie;
    assert.equal((await c.post("/auth/logout")).status, 200);
    assert.equal((await c.get("/auth/me")).status, 401);
    const replay = await fetch(`${srv.base}/auth/me`, { headers: { cookie: cookieBefore } });
    assert.equal(replay.status, 401);
  });

  it("signs in with the right password and refuses the wrong one", async () => {
    const { email } = await newFirm(srv.base);
    const bad = await client(srv.base).post("/auth/login", { email, password: "wrong-password-1" });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.message, "Email or password is incorrect");
    const unknown = await client(srv.base).post("/auth/login", { email: "ghost@example.test", password: "wrong-password-1" });
    assert.equal(unknown.body.message, bad.body.message);

    const c = client(srv.base);
    assert.equal((await c.post("/auth/login", { email, password: PASSWORD })).status, 200);
    assert.equal((await c.get("/auth/me")).status, 200);
  });

  it("rate-limits repeated sign-in attempts", async () => {
    const c = client(srv.base);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await c.post("/auth/login", { email: "spray@example.test", password: "x" })).status);
    assert.ok(statuses.slice(0, 10).every((s) => s === 401));
    assert.equal(statuses[11], 429);
  });

  it("requires a session for protected routes", async () => {
    const res = await client(srv.base).get("/cases");
    assert.equal(res.status, 401);
  });
});

describe("firm invites", () => {
  it("lets an owner invite a member who then joins the firm", async () => {
    const owner = await newFirm(srv.base, "Sheikh & Associates");
    const inv = await owner.c.post("/firm/invites", { email: "junior@example.test" });
    assert.equal(inv.status, 201);
    const token = inv.body.data.token as string;

    const preview = await client(srv.base).get(`/invites/${token}`);
    assert.equal(preview.body.data.firmName, "Sheikh & Associates");

    const wrong = await client(srv.base).post("/auth/register", { name: "Wrong", email: "other@example.test", password: PASSWORD, inviteToken: token });
    assert.equal(wrong.status, 400);

    const junior = client(srv.base);
    const joined = await junior.post("/auth/register", { name: "Junior", email: "junior@example.test", password: PASSWORD, inviteToken: token });
    assert.equal(joined.status, 201);
    assert.equal(joined.body.data.role, "member");
    assert.equal(joined.body.data.firmId, owner.user.firmId);

    const reuse = await client(srv.base).post("/auth/register", { name: "Again", email: "again@example.test", password: PASSWORD, inviteToken: token });
    assert.equal(reuse.status, 400);

    // Members can't invite or remove people.
    assert.equal((await junior.post("/firm/invites", { email: "x@example.test" })).status, 403);

    const firm = await owner.c.get("/firm");
    assert.equal(firm.body.data.members.length, 2);

    const removed = await owner.c.del(`/firm/members/${joined.body.data.id}`);
    assert.equal(removed.status, 200);
    assert.equal((await junior.get("/auth/me")).status, 401);
  });
});
