import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth/auth";
import {
  assertActive,
  canAccessManagement,
  hasAdminAccess,
  hasRaidLeadAccess,
  type AuthenticatedUser,
} from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { userRepository } from "@/repositories/user.repository";

async function loadUserFromSession(): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    return null;
  }

  return userRepository.findAuthenticatedById(session.user.id);
}

/**
 * Server-side session enforcement. Hidden navigation is not an authorization boundary.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await loadUserFromSession();
  if (!user) {
    throw new DomainError("NOT_AUTHENTICATED", "Sign in is required.", 401);
  }
  assertActive(user);
  return user;
}

export async function requireRaidLead(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!hasRaidLeadAccess(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Raid lead or admin permission is required.", 403);
  }
  return user;
}

export async function requireAdmin(): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!hasAdminAccess(user.accountRole)) {
    throw new DomainError("NOT_AUTHORIZED", "Admin permission is required.", 403);
  }
  return user;
}

export async function getOptionalUser(): Promise<AuthenticatedUser | null> {
  const user = await loadUserFromSession();
  if (!user || user.accountStatus !== "ACTIVE") {
    return null;
  }
  return user;
}

export async function requireUserOrRedirect(callbackPath = "/dashboard"): Promise<AuthenticatedUser> {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof DomainError && error.code === "NOT_AUTHENTICATED") {
      redirect(`/?next=${encodeURIComponent(callbackPath)}`);
    }
    throw error;
  }
}

export async function requireManagerOrRedirect(): Promise<AuthenticatedUser> {
  const user = await requireUserOrRedirect("/manage");
  if (!canAccessManagement(user.accountRole)) {
    redirect("/dashboard");
  }
  return user;
}

/** ADMIN-only destination. RAID_LEAD keeps /manage for runs but not this queue. */
export async function requireAdminOrRedirect(callbackPath = "/manage/booster-access"): Promise<AuthenticatedUser> {
  const user = await requireUserOrRedirect(callbackPath);
  if (!hasAdminAccess(user.accountRole)) {
    redirect("/dashboard");
  }
  return user;
}
