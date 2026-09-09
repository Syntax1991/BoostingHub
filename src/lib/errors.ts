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
  "CHARACTER_NOT_FOUND",
  "CHARACTER_NOT_OWNED",
  "CHARACTER_INACTIVE",
  "CHARACTER_ALREADY_EXISTS",
  "INVALID_CHARACTER_NAME",
  "INVALID_REALM",
  "INVALID_SPECIALIZATION",
  "INVALID_CLASS_SPECIALIZATION",
  "INVALID_CHARACTER_ROLE",
  "CHARACTER_CLASS_IMMUTABLE",
  "BOOSTER_ACCESS_REQUIRED",
  "BOOSTER_ACCESS_DIFFICULTY_MISMATCH",
  "RUN_NOT_MANAGEABLE",
  "SIGNUP_WITHDRAWN",
  "INVALID_ROSTER_SELECTION",
  "ROSTER_VALIDATION_FAILED",
  "ROSTER_ALREADY_CHANGED",
  "BOOSTER_ACCESS_INVALID",
  "BOOSTER_ACCESS_NOT_FOUND",
  "BOOSTER_ACCESS_ALREADY_PENDING",
  "BOOSTER_ACCESS_ALREADY_APPROVED",
  "BOOSTER_ACCESS_INVALID_TRANSITION",
  "BOOSTER_ACCESS_ROLE_INVALID",
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
