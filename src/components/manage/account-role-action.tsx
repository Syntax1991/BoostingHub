import { hasOwnerAccess } from "@/auth/authorization";
import { ChangeAccountRoleDialog } from "@/components/manage/change-account-role-dialog";
import type { AccountRole } from "@/models/enums";

/**
 * Header action of the "Account role" card. The Platform Owner is protected:
 * no role-change control is rendered at all (the server refuses anyway —
 * OWNER_ROLE_PROTECTED); every other account gets the normal dialog.
 */
export function AccountRoleAction({
  userId,
  userName,
  accountRole,
}: {
  userId: string;
  userName: string;
  accountRole: AccountRole;
}) {
  if (hasOwnerAccess(accountRole)) {
    return <span className="text-xs text-muted">Platform Owner · Protected</span>;
  }
  return <ChangeAccountRoleDialog userId={userId} userName={userName} currentRole={accountRole} />;
}
