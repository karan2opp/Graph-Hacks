import type { Request } from "express";
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema> & { skip: number };

/**
 * Typed view over an Express request. Controllers wrap `req` with
 * `ApiRequest.from(req)` so request data is read the same way everywhere.
 */
export class ApiRequest<B = unknown, Q = Record<string, unknown>, P = Record<string, string>> {
  private constructor(private readonly req: Request) {}

  static from<B = unknown, Q = Record<string, unknown>, P = Record<string, string>>(req: Request) {
    return new ApiRequest<B, Q, P>(req);
  }

  get id(): string | undefined {
    return this.req.res?.locals.requestId as string | undefined;
  }
  /** Validated body when a `validate()` middleware ran, raw body otherwise. */
  get body(): B {
    return (this.req.validated?.body ?? this.req.body) as B;
  }
  get query(): Q {
    return (this.req.validated?.query ?? this.req.query) as Q;
  }
  get params(): P {
    return (this.req.validated?.params ?? this.req.params) as P;
  }
  get file() {
    return this.req.file;
  }
  get pagination(): Pagination {
    const { page, limit } = paginationSchema.parse(this.req.query);
    return { page, limit, skip: (page - 1) * limit };
  }
}
