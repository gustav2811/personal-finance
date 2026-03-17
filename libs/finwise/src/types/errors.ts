/**
 * FinWise API error names (from docs).
 */
export type FinWiseErrorName =
  | "BadRequestError"
  | "UnauthenticatedError"
  | "ForbiddenError"
  | "NotFoundError"
  | "ConflictError";

/**
 * Field-level error detail in API error response.
 */
export interface FieldError {
  code: string;
  message: string;
  path: string[];
  received?: string;
}

/**
 * FinWise API error response body.
 */
export interface FinWiseErrorBody {
  name: FinWiseErrorName;
  message: string;
  errors?: FieldError[];
}

/**
 * Error thrown on non-2xx API responses. Carries status, requestId, and parsed body.
 */
export class FinWiseApiError extends Error {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly body: FinWiseErrorBody | undefined;

  constructor(
    message: string,
    status: number,
    requestId: string | undefined,
    body: FinWiseErrorBody | undefined
  ) {
    super(message);
    this.name = "FinWiseApiError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
    Object.setPrototypeOf(this, FinWiseApiError.prototype);
  }
}
