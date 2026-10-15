export interface ApiErrorDetail {
  field?: string;
  message: string;
}

/**
 * Operational error that carries an HTTP status. Throw it anywhere; the
 * global error handler turns it into the standard error response.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errors: ApiErrorDetail[];
  public readonly isOperational = true;

  constructor(
    statusCode: number,
    message: string,
    options: { code?: string; errors?: ApiErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = options.code ?? ApiError.defaultCode(statusCode);
    this.errors = options.errors ?? [];
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message = "Bad request", errors?: ApiErrorDetail[]) {
    return new ApiError(400, message, { errors });
  }
  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, message);
  }
  static forbidden(message = "Forbidden") {
    return new ApiError(403, message);
  }
  static notFound(message = "Resource not found") {
    return new ApiError(404, message);
  }
  static conflict(message = "Conflict") {
    return new ApiError(409, message);
  }
  static validation(errors: ApiErrorDetail[], message = "Validation failed") {
    return new ApiError(422, message, { errors });
  }
  static internal(message = "Internal server error", cause?: unknown) {
    return new ApiError(500, message, { cause });
  }
  static serviceUnavailable(message = "Service unavailable", cause?: unknown) {
    return new ApiError(503, message, { cause });
  }

  private static defaultCode(status: number): string {
    switch (status) {
      case 400: return "BAD_REQUEST";
      case 401: return "UNAUTHORIZED";
      case 403: return "FORBIDDEN";
      case 404: return "NOT_FOUND";
      case 409: return "CONFLICT";
      case 422: return "VALIDATION_ERROR";
      case 503: return "SERVICE_UNAVAILABLE";
      default: return status >= 500 ? "INTERNAL_ERROR" : "ERROR";
    }
  }
}
