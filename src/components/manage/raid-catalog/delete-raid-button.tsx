"use client";

import { useRouter } from "next/navigation";
import { deleteRaidAction } from "@/controllers/raid-catalog.actions";
import { RaidCatalogDialog } from "@/components/manage/raid-catalog/raid-catalog-dialog";

/** Hard delete for an unused, non-core Raid (the server re-checks every reference). */
export function DeleteRaidButton({ raidId, name }: { raidId: string; name: string }) {
  const router = useRouter();
  return (
    <RaidCatalogDialog
      triggerLabel="Delete raid"
      triggerVariant="ghost"
      triggerClassName="h-8 px-2 text-xs text-danger"
      title={`Delete raid ${name}?`}
      description="This raid and its encounters are removed permanently. It is not used by any Run, Run Setup, Product or lockout. This cannot be undone."
      submitLabel="Delete raid"
      pendingLabel="Deleting…"
      danger
      onSubmit={() => deleteRaidAction({ raidId })}
      onSuccess={() => router.push("/manage/raid-catalog")}
    />
  );
}
