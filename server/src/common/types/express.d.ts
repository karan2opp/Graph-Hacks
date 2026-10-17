declare global {
  namespace Express {
    interface Request {
      /** Populated by the `validate()` middleware. */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
      /** Populated by `requireAuth`. */
      user?: { id: string; email: string; name: string; firmId: string; firmName: string; role: "owner" | "member" };
    }
  }
}
export {};
