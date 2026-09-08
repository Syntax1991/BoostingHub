"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth/auth";
import { isDevAuthEnabled } from "@/auth/dev-auth";
import { DomainError } from "@/lib/errors";
import { userRepository } from "@/repositories/user.repository";
import { getDevAuthPassword } from "@/auth/dev-auth";
import { devLoginSchema } from "@/validators/run-filters";

/**
 * Development-only identity login. Production is rejected before any session is created.
 */
export async function signInWithDevIdentity(formData: FormData) {
  if (!isDevAuthEnabled()) {
    throw new DomainError(
      "NOT_AUTHORIZED",
      "Development authentication is disabled.",
      403,
    );
  }

  const parsed = devLoginSchema.parse({
    userId: String(formData.get("userId") ?? ""),
  });

  const identities = await userRepository.listDevIdentities();
  const identity = identities.find((item) => item.id === parsed.userId);

  if (!identity?.email) {
    throw new DomainError("NOT_FOUND", "Development identity was not found.");
  }

  const result = await auth.api.signInEmail({
    body: {
      email: identity.email,
      password: getDevAuthPassword(),
    },
    headers: await headers(),
  });

  if (!result) {
    throw new DomainError("NOT_AUTHENTICATED", "Development sign-in failed.");
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  await auth.api.signOut({
    headers: await headers(),
  });
  redirect("/");
}
