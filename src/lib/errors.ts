export const DOMAIN_ERROR_CODES = [
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  "ACCOUNT_DISABLED",
  "VALIDATION_FAILED",
  "CHARACTER_NOT_ELIGIBLE",
  "SIGNUP_CLOSED",
  "LOCKOUT_CONFLICT",
  "INVALID_STATE_TRANSITION",
  "NOT_FOUND",
  "DUPLICATE_SIGNUP",
  "CHARACTER_NOT_OWNED",
  "CHARACTER_INACTIVE",
  "BOOSTER_ACCESS_REQUIRED",
  "BOOSTER_ACCESS_DIFFICULTY_MISMATCH",
  "RUN_NOT_MANAGEABLE",
  "SIGNUP_WITHDRAWN",
  "INVALID_ROSTER_SELECTION",
  "ROSTER_VALIDATION_FAILED",
  "ROSTER_ALREADY_CHANGED",
  "BOOSTER_ACCESS_INVALID",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Expected business failure. Controllers map these to user-facing messages
 * instead of leaking database or infrastructure errors.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;

  constructor(code: DomainErrorCode, message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
