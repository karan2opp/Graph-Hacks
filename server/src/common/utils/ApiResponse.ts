import type { Response } from "express";
import type { ApiErrorDetail } from "./ApiError.js";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ResponseMeta {
  requestId?: string;
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

/**
 * Every API response, success or failure, has this exact shape:
 * { success, statusCode, message, data, errors?, code?, meta?, timestamp }
 */
export class ApiResponse<T = unknown> {
  public readonly success: boolean;
  public readonly timestamp = new Date().toISOString();

  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly data: T | null = null,
    public readonly meta?: ResponseMeta,
    public readonly errors?: ApiErrorDetail[],
    public readonly code?: string,
  ) {
    this.success = statusCode < 400;
  }

  static ok<T>(data: T, message = "Success", meta?: ResponseMeta) {
    return new ApiResponse<T>(200, message, data, meta);
  }
  static created<T>(data: T, message = "Created", meta?: ResponseMeta) {
    return new ApiResponse<T>(201, message, data, meta);
  }
  static paginated<T>(items: T[], pagination: PaginationMeta, message = "Success") {
    return new ApiResponse<T[]>(200, message, items, { pagination });
  }
  static error(
    statusCode: number,
    message: string,
    errors?: ApiErrorDetail[],
    code?: string,
  ) {
    return new ApiResponse<null>(statusCode, message, null, undefined, errors, code);
  }

  /** Serialise and send. Adds the request id to meta when present. */
  send(res: Response): Response {
    const requestId = res.locals.requestId as string | undefined;
    const body = requestId ? { ...this, meta: { ...this.meta, requestId } } : this;
    return res.status(this.statusCode).json(body);
  }
}
