import { Router } from "express";
import { validate } from "../../common/middleware/index.js";
import { ApiRequest, ApiResponse } from "../../common/utils/index.js";
import {
  clearSessionCookie,
  rateLimit,
  readSessionToken,
  requireAuth,
  requireOwner,
  setSessionCookie,
} from "./auth.middleware.js";
import {
  inviteBody,
  inviteTokenParams,
  loginBody,
  registerBody,
  userIdParams,
  type InviteInput,
  type LoginInput,
  type RegisterInput,
} from "./auth.schema.js";
import {
  createInvite,
  createSession,
  destroySession,
  listMembers,
  login,
  previewInvite,
  register,
  removeMember,
} from "./auth.service.js";

const byIpAndEmail = (req: { ip?: string; body?: { email?: unknown } }) =>
  `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`;

/** Public: sign up, sign in, sign out, invite preview. */
export const publicAuthRouter = Router();

publicAuthRouter.post(
  "/auth/register",
  rateLimit({ windowMs: 60 * 60_000, max: 10, key: (req) => `register:${req.ip}` }),
  validate({ body: registerBody }),
  async (req, res) => {
    const user = await register(ApiRequest.from<RegisterInput>(req).body);
    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    ApiResponse.created(user, "Account created").send(res);
  },
);

publicAuthRouter.post(
  "/auth/login",
  rateLimit({ windowMs: 15 * 60_000, max: 10, key: (req) => `login:${byIpAndEmail(req)}` }),
  validate({ body: loginBody }),
  async (req, res) => {
    const user = await login(ApiRequest.from<LoginInput>(req).body);
    const session = await createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    ApiResponse.ok(user, "Signed in").send(res);
  },
);

publicAuthRouter.post("/auth/logout", async (req, res) => {
  const token = readSessionToken(req);
  if (token) await destroySession(token);
  clearSessionCookie(res);
  ApiResponse.ok(null, "Signed out").send(res);
});

publicAuthRouter.get("/invites/:token", validate({ params: inviteTokenParams }), async (req, res) => {
  const { token } = ApiRequest.from<unknown, unknown, { token: string }>(req).params;
  ApiResponse.ok(await previewInvite(token)).send(res);
});

/** Signed in: who am I, and my firm. */
export const accountRouter = Router();
accountRouter.use(requireAuth);

accountRouter.get("/auth/me", (req, res) => {
  ApiResponse.ok(req.user).send(res);
});

accountRouter.get("/firm", async (req, res) => {
  const { firmId, firmName } = req.user!;
  ApiResponse.ok({ id: firmId, name: firmName, ...(await listMembers(firmId)) }).send(res);
});

accountRouter.post("/firm/invites", requireOwner, validate({ body: inviteBody }), async (req, res) => {
  const invite = await createInvite(req.user!.firmId, req.user!.id, ApiRequest.from<InviteInput>(req).body);
  ApiResponse.created(invite, "Invite created").send(res);
});

accountRouter.delete("/firm/members/:userId", requireOwner, validate({ params: userIdParams }), async (req, res) => {
  const { userId } = ApiRequest.from<unknown, unknown, { userId: string }>(req).params;
  await removeMember(req.user!.firmId, req.user!.id, userId);
  ApiResponse.ok(null, "Member removed").send(res);
});
