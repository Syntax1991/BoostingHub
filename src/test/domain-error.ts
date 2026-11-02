import { expect } from "vitest";
import { isDomainError } from "@/lib/errors";

/**
 * Awaits `promise` and asserts it rejected with a DomainError of `code`. A
 * resolved promise or a non-domain error fails with what actually happened.
 * Pass the code as a literal: it is the public contract under test.
 */
export async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  let outcome: unknown = "resolved";
  try {
    await promise;
  } catch (error) {
    outcome = isDomainError(error) ? error.code : error;
  }
  expect(outcome).toBe(code);
}
