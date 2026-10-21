// Spring ProblemDetail (RFC 9457)
export type ProblemDetail = {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
};

export type ApiErrorKind = "http" | "network" | "timeout";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly problem?: ProblemDetail;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; problem?: ProblemDetail; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = options.status;
    this.problem = options.problem;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
