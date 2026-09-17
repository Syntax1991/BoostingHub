"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAvailabilityBlockAction } from "@/controllers/character-availability.actions";
import { AvailabilityBlockDialog } from "@/components/characters/availability-block-dialog";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/datetime";

type AvailabilityBlock = {
  id: string;
  characterId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  label: string;
};

export function CharacterAvailabilitySection({
  characterId,
  upcoming,
  past,
}: {
  characterId: string;
  upcoming: AvailabilityBlock[];
  past: AvailabilityBlock[];
}) {
  return (
    <Card>
      <CardHeader
        title="External commitments"
        description="Commitments outside BoostingHub. Runs whose start falls inside a commitment cannot use this Character."
        action={
          <AvailabilityBlockDialog
            characterId={characterId}
            mode="create"
            triggerLabel="Add external plan"
          />
        }
      />
      {upcoming.length === 0 ? (
        <EmptyState
          title="No upcoming external commitments"
          description="Manual external plans only. BoostingHub Run reservations for this Character are listed under BoostingHub commitments."
        />
      ) : (
        <ul className="divide-y divide-border">
          {upcoming.map((block) => (
            <AvailabilityRow key={block.id} characterId={characterId} block={block} />
          ))}
        </ul>
      )}
      {past.length > 0 ? (
        <details className="border-t border-border px-4 py-3 text-xs text-muted">
          <summary>
            {past.length} past commitment{past.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-2">
            {past.map((block) => (
              <li key={block.id}>
                {formatDateTime(block.startsAt)} → {formatDateTime(block.endsAt)}
                {block.reason ? ` — ${block.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function AvailabilityRow({
  characterId,
  block,
}: {
  characterId: string;
  block: AvailabilityBlock;
}) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAvailabilityBlockAction({ blockId: block.id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-medium">
          {formatDateTime(block.startsAt)} → {formatDateTime(block.endsAt)}
        </div>
        <p className="mt-1 text-xs text-muted">{block.reason ?? "No community / note"}</p>
        {error ? (
          <p id={errorId} role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <AvailabilityBlockDialog
          characterId={characterId}
          mode="edit"
          triggerLabel="Edit"
          initial={{
            id: block.id,
            startsAt: block.startsAt,
            endsAt: block.endsAt,
            reason: block.reason,
          }}
        />
        <button
          type="button"
          disabled={pending}
          onClick={remove}
          aria-describedby={error ? errorId : undefined}
          className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      </div>
    </li>
  );
}
