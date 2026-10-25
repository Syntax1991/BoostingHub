"use client";

import { useRef } from "react";
import Link from "next/link";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { CharacterSyncButtons } from "@/components/manage/character-operations/character-sync-buttons";
import { DeleteCharacterButton } from "@/components/characters/delete-character-button";

export type ManageCharacterRowActionInput = {
  id: string;
  name: string;
  realm: string;
  cooldownRemainingMs: number;
  /** Pre-resolved server copy; null when sync is eligible. */
  ineligibleCopy: string | null;
  deleteBlockedReason: string | null;
};

/**
 * Dense admin row actions: Open + Sync now primary; Force refresh / Delete in ⋯.
 * Force/Delete dialogs stay mounted off-screen so overflow unmount cannot kill them.
 * Do not import services here — keeps Prisma out of the client bundle.
 */
export function ManageCharacterRowActions({ row }: { row: ManageCharacterRowActionInput }) {
  const forceRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const label = `${row.name}-${row.realm}`;

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      <Link
        href={`/manage/characters/${row.id}`}
        className="inline-flex h-7 items-center rounded-md border border-border bg-surface-raised px-2 text-xs font-medium text-foreground hover:bg-[#222a3b]"
      >
        Open
      </Link>
      <CharacterSyncButtons
        characterId={row.id}
        characterLabel={label}
        ineligibleCopy={row.ineligibleCopy}
        cooldownRemainingMs={row.cooldownRemainingMs}
        compact
        showForceRefresh={false}
      />
      <div className="pointer-events-none absolute -left-[9999px] top-0 opacity-0" aria-hidden>
        <CharacterSyncButtons
          characterId={row.id}
          characterLabel={label}
          ineligibleCopy={row.ineligibleCopy}
          cooldownRemainingMs={row.cooldownRemainingMs}
          compact
          showSync={false}
          showForceRefresh
          forceButtonRef={forceRef}
        />
        {row.deleteBlockedReason ? null : (
          <DeleteCharacterButton
            characterId={row.id}
            characterLabel={label}
            mode="admin"
            compact
            buttonRef={deleteRef}
          />
        )}
      </div>
      <OverflowMenu
        label={`More actions for ${row.name}`}
        items={[
          {
            id: "force",
            label: "Force refresh",
            disabled: Boolean(row.ineligibleCopy),
            onSelect: () => forceRef.current?.click(),
          },
          ...(row.deleteBlockedReason
            ? []
            : [
                {
                  id: "delete",
                  label: "Delete",
                  danger: true as const,
                  onSelect: () => deleteRef.current?.click(),
                },
              ]),
        ]}
      />
      {row.deleteBlockedReason ? (
        <button
          type="button"
          disabled
          title={row.deleteBlockedReason}
          className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs text-muted opacity-70"
        >
          Delete protected
        </button>
      ) : null}
    </div>
  );
}
