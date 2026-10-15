declare global {
  namespace Express {
    interface Request {
      /** Populated by the `validate()` middleware. */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}
export {};
