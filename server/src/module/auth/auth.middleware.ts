import type { CookieOptions, Request, RequestHandler, Response, Router } from "express";
import { env, isProd } from "../../config/env.js";
import { queryOne } from "../../common/db/index.js";
import { ApiError } from "../../common/utils/index.js";
import { userForToken } from "./auth.service.js";

export const SESSION_COOKIE = "cm_session";

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProd || env.COOKIE_SAMESITE === "none",
  sameSite: env.COOKIE_SAMESITE,
  path: "/",
});

export function setSessionCookie(res: Response, token: string, expiresAt: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: new Date(expiresAt) });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readSessionToken(req: Request): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** 401 unless the request carries a live session. Sets `req.user`. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = readSessionToken(req);
  const user = token ? await userForToken(token) : null;
  if (!user) return next(ApiError.unauthorized("Please sign in to continue"));
  req.user = user;
  next();
};

export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== "owner") return next(ApiError.forbidden("Only firm owners can do this"));
  next();
};

/**
 * How each route parameter resolves to the firm that owns it. Every resource lives under a case,
 * and every case belongs to one firm.
 */
const OWNER_QUERY: Record<string, { label: string; cypher: string }> = {
  caseId: { label: "Case", cypher: "MATCH (c:Case {id: $id}) RETURN c.firmId AS firmId" },
  linkedCaseId: { label: "Case", cypher: "MATCH (c:Case {id: $id}) RETURN c.firmId AS firmId" },
  hearingId: { label: "Hearing", cypher: "MATCH (h:Hearing {id: $id}) MATCH (c:Case {id: h.caseId}) RETURN c.firmId AS firmId" },
  documentId: { label: "Document", cypher: "MATCH (d:Document {id: $id}) MATCH (c:Case {id: d.caseId}) RETURN c.firmId AS firmId" },
  transcriptId: {
    label: "Transcript",
    cypher: "MATCH (h:Hearing)-[:RECORDED_IN]->(:Transcript {id: $id}) MATCH (c:Case {id: h.caseId}) RETURN c.firmId AS firmId",
  },
  claimId: { label: "Claim", cypher: "MATCH (x:Claim {id: $id}) MATCH (c:Case {id: x.caseId}) RETURN c.firmId AS firmId" },
  directionId: { label: "Direction", cypher: "MATCH (x:Direction {id: $id}) MATCH (c:Case {id: x.caseId}) RETURN c.firmId AS firmId" },
  conversationId: {
    label: "Conversation",
    cypher: "MATCH (x:Conversation {id: $id}) MATCH (c:Case {id: x.caseId}) RETURN c.firmId AS firmId",
  },
  linkId: {
    label: "Finding",
    cypher: "MATCH (a:Claim)-[r:CONTRADICTS|DISPUTES|SUPPORTS {id: $id}]->(:Claim) MATCH (c:Case {id: a.caseId}) RETURN c.firmId AS firmId",
  },
};

/** True when the resource exists and belongs to this firm. */
export async function ownsResource(firmId: string, param: string, id: string) {
  const q = OWNER_QUERY[param];
  if (!q) return false;
  const row = await queryOne<{ firmId: string | null }>(q.cypher, { id });
  return row?.firmId === firmId;
}

/**
 * Registers firm checks for every known id parameter on a router. Resources of another firm
 * answer 404, the same as ones that don't exist, so ids can't be probed.
 */
export function guardParams(router: Router) {
  for (const [param, { label }] of Object.entries(OWNER_QUERY)) {
    router.param(param, async (req, _res, next, value: string) => {
      try {
        if (!req.user) return next(ApiError.unauthorized("Please sign in to continue"));
        if (!(await ownsResource(req.user.firmId, param, value))) return next(ApiError.notFound(`${label} not found`));
        next();
      } catch (e) {
        next(e);
      }
    });
  }
}

/**
 * Fixed-window limiter for sign-in and sign-up.
 * ponytail: in-memory per process; move to FalkorDB/Redis if the API runs on more than one instance.
 */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = opts.key(req);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return next();
    }
    if (++entry.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      return next(new ApiError(429, "Too many attempts. Wait a few minutes and try again.", { code: "RATE_LIMITED" }));
    }
    next();
  };
}
