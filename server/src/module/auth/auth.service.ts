import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { nowIso, queryOne, runQuery } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import { hashPassword, newToken, sha256, verifyPassword } from "./auth.crypto.js";
import type { InviteInput, LoginInput, RegisterInput } from "./auth.schema.js";

export type Role = "owner" | "member";
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  firmId: string;
  firmName: string;
  role: Role;
}

const INVITE_TTL_DAYS = 7;
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const USER_VIEW = `u.id AS id, u.email AS email, u.name AS name, f.id AS firmId, f.name AS firmName, m.role AS role`;

async function emailTaken(email: string) {
  return Boolean(await queryOne("MATCH (u:User {email: $email}) RETURN u.id AS id", { email }));
}

async function findInvite(token: string) {
  return queryOne<{ id: string; email: string; role: Role; firmId: string; firmName: string; expiresAt: string; usedAt: string | null }>(
    `MATCH (i:Invite {tokenHash: $hash})-[:FOR_FIRM]->(f:Firm)
     RETURN i.id AS id, i.email AS email, i.role AS role, f.id AS firmId, f.name AS firmName, i.expiresAt AS expiresAt, i.usedAt AS usedAt`,
    { hash: sha256(token) },
  );
}

async function usableInvite(token: string) {
  const invite = await findInvite(token);
  if (!invite || invite.usedAt || invite.expiresAt < nowIso()) {
    throw ApiError.badRequest("This invite link is invalid or has expired. Ask your firm for a new one.");
  }
  return invite;
}

/** Public preview for the invite page: which firm, which email. */
export async function previewInvite(token: string) {
  const invite = await usableInvite(token);
  return { firmName: invite.firmName, email: invite.email, role: invite.role };
}

/** Creates a user and either a new firm (they own it) or a membership from an invite. */
export async function register(input: RegisterInput): Promise<SessionUser> {
  if (await emailTaken(input.email)) throw ApiError.conflict("An account with this email already exists. Sign in instead.");

  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const now = nowIso();

  if ("inviteToken" in input) {
    const invite = await usableInvite(input.inviteToken);
    if (invite.email !== input.email) throw ApiError.badRequest(`This invite was sent to ${invite.email}. Register with that address.`);
    await runQuery(
      `MATCH (f:Firm {id: $firmId}), (i:Invite {id: $inviteId})
       CREATE (u:User {id: $userId, email: $email, name: $name, passwordHash: $passwordHash, createdAt: $now})-[:MEMBER_OF {role: $role, since: $now}]->(f)
       SET i.usedAt = $now`,
      { firmId: invite.firmId, inviteId: invite.id, userId, email: input.email, name: input.name, passwordHash, role: invite.role, now },
    );
  } else {
    await runQuery(
      `CREATE (f:Firm {id: $firmId, name: $firmName, createdAt: $now})
       CREATE (u:User {id: $userId, email: $email, name: $name, passwordHash: $passwordHash, createdAt: $now})-[:MEMBER_OF {role: 'owner', since: $now}]->(f)`,
      { firmId: randomUUID(), firmName: input.firmName, userId, email: input.email, name: input.name, passwordHash, now },
    );
  }
  return (await getUser(userId))!;
}

export async function getUser(userId: string): Promise<SessionUser | null> {
  return queryOne<SessionUser>(`MATCH (u:User {id: $userId})-[m:MEMBER_OF]->(f:Firm) RETURN ${USER_VIEW}`, { userId });
}

/** Same error for unknown email and wrong password, so accounts can't be enumerated. */
export async function login(input: LoginInput): Promise<SessionUser> {
  const row = await queryOne<{ id: string; passwordHash: string }>(
    "MATCH (u:User {email: $email}) RETURN u.id AS id, u.passwordHash AS passwordHash",
    { email: input.email },
  );
  const ok = row ? await verifyPassword(input.password, row.passwordHash) : await verifyPassword(input.password, DUMMY_HASH);
  if (!row || !ok) throw ApiError.unauthorized("Email or password is incorrect");
  const user = await getUser(row.id);
  if (!user) throw ApiError.unauthorized("Email or password is incorrect");
  return user;
}
// Keeps login timing the same whether or not the email exists.
const DUMMY_HASH = await hashPassword("timing-equaliser-1");

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const expiresAt = daysFromNow(env.SESSION_TTL_DAYS);
  await runQuery(
    "CREATE (:Session {id: $id, tokenHash: $hash, userId: $userId, createdAt: $now, expiresAt: $expiresAt})",
    { id: randomUUID(), hash: sha256(token), userId, now: nowIso(), expiresAt },
  );
  return { token, expiresAt };
}

export async function userForToken(token: string): Promise<SessionUser | null> {
  return queryOne<SessionUser>(
    `MATCH (s:Session {tokenHash: $hash}) WHERE s.expiresAt > $now
     MATCH (u:User {id: s.userId})-[m:MEMBER_OF]->(f:Firm)
     RETURN ${USER_VIEW}`,
    { hash: sha256(token), now: nowIso() },
  );
}

export async function destroySession(token: string) {
  await runQuery("MATCH (s:Session {tokenHash: $hash}) DELETE s", { hash: sha256(token) });
}

export async function listMembers(firmId: string) {
  const [members, invites] = await Promise.all([
    runQuery<{ id: string; name: string; email: string; role: Role; since: string }>(
      `MATCH (u:User)-[m:MEMBER_OF]->(:Firm {id: $firmId})
       RETURN u.id AS id, u.name AS name, u.email AS email, m.role AS role, m.since AS since ORDER BY m.since`,
      { firmId },
    ),
    runQuery<{ id: string; email: string; role: Role; expiresAt: string }>(
      `MATCH (i:Invite)-[:FOR_FIRM]->(:Firm {id: $firmId}) WHERE i.usedAt IS NULL AND i.expiresAt > $now
       RETURN i.id AS id, i.email AS email, i.role AS role, i.expiresAt AS expiresAt ORDER BY i.createdAt DESC`,
      { firmId, now: nowIso() },
    ),
  ]);
  return { members, invites };
}

/** Returns the raw token once; only its hash is kept. */
export async function createInvite(firmId: string, invitedBy: string, input: InviteInput) {
  if (await emailTaken(input.email)) throw ApiError.conflict("This person already has an account");
  const token = newToken();
  const expiresAt = daysFromNow(INVITE_TTL_DAYS);
  await runQuery(
    `MATCH (f:Firm {id: $firmId})
     CREATE (:Invite {id: $id, tokenHash: $hash, email: $email, role: $role, invitedBy: $invitedBy, createdAt: $now, expiresAt: $expiresAt, usedAt: null})-[:FOR_FIRM]->(f)`,
    { firmId, id: randomUUID(), hash: sha256(token), email: input.email, role: input.role, invitedBy, now: nowIso(), expiresAt },
  );
  return { token, email: input.email, role: input.role, expiresAt };
}

export async function removeMember(firmId: string, actingUserId: string, userId: string) {
  if (userId === actingUserId) throw ApiError.badRequest("You can't remove yourself");
  const row = await queryOne<{ id: string }>(
    "MATCH (u:User {id: $userId})-[:MEMBER_OF]->(:Firm {id: $firmId}) RETURN u.id AS id",
    { userId, firmId },
  );
  if (!row) throw ApiError.notFound("Member not found");
  await runQuery("MATCH (s:Session {userId: $userId}) DELETE s", { userId });
  await runQuery("MATCH (u:User {id: $userId}) DETACH DELETE u", { userId });
}
