"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createEncounterAction,
  deleteEncounterAction,
  moveEncounterAction,
  updateEncounterAction,
} from "@/controllers/content-catalog.actions";
import { ContentDialog, Field, fieldInputClass } from "@/components/manage/content/content-dialog";
import { idListInputValue } from "@/components/manage/content/content-format";

type EncounterValues = {
  bossId?: string;
  name: string;
  blizzardEncounterIds: readonly number[];
  wclEncounterIds: readonly number[];
};

/** Add an encounter (unlocked raids only) or edit one's name and Blizzard ids. WCL ids are auto-discovered. */
export function EncounterFormDialog({ raidId, encounter }: { raidId: string; encounter?: EncounterValues }) {
  const editing = Boolean(encounter?.bossId);
  const [name, setName] = useState(encounter?.name ?? "");
  const [blizzard, setBlizzard] = useState(idListInputValue(encounter?.blizzardEncounterIds ?? []));
  const [showAdvanced, setShowAdvanced] = useState((encounter?.blizzardEncounterIds.length ?? 0) > 0);

  function reset() {
    setName(encounter?.name ?? "");
    setBlizzard(idListInputValue(encounter?.blizzardEncounterIds ?? []));
    setShowAdvanced((encounter?.blizzardEncounterIds.length ?? 0) > 0);
  }

  const fields = { name, blizzardEncounterIds: blizzard };

  return (
    <ContentDialog
      triggerLabel={editing ? "Edit" : "Add encounter"}
      triggerVariant={editing ? "ghost" : "secondary"}
      title={editing ? `Edit encounter · ${encounter?.name}` : "Add encounter"}
      description={
        editing
          ? "The encounter keeps its id and position, so stored lockouts (killed bosses) stay valid. Warcraft Logs ids are detected automatically from the encounter name."
          : "Appended as the last encounter of this raid. Warcraft Logs ids are detected automatically when the name matches."
      }
      submitLabel={editing ? "Save encounter" : "Add encounter"}
      onOpen={reset}
      onSubmit={() =>
        editing ? updateEncounterAction({ ...fields, bossId: encounter!.bossId }) : createEncounterAction({ ...fields, raidId })
      }
    >
      <Field label="Name">
        <input className={fieldInputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </Field>
      {editing && (encounter?.wclEncounterIds.length ?? 0) > 0 ? (
        <p className="text-xs text-muted">
          Warcraft Logs: <span className="font-mono">{encounter!.wclEncounterIds.join(", ")}</span> (read-only)
        </p>
      ) : null}
      <div>
        <button
          type="button"
          className="text-xs text-muted hover:text-foreground"
          onClick={() => setShowAdvanced((open) => !open)}
        >
          {showAdvanced ? "Hide advanced" : "Advanced · Blizzard ids"}
        </button>
        {showAdvanced ? (
          <div className="mt-2">
            <Field label="Blizzard encounter ids" hint="Journal encounter ids, separated by commas. Leave empty if unknown.">
              <input
                className={fieldInputClass}
                inputMode="numeric"
                placeholder="e.g. 2849"
                value={blizzard}
                onChange={(e) => setBlizzard(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </ContentDialog>
  );
}

export function EncounterMoveButtons({ bossId, first, last }: { bossId: string; first: boolean; last: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(direction: "UP" | "DOWN") {
    setError(null);
    startTransition(async () => {
      const result = await moveEncounterAction({ bossId, direction });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Move up"
        disabled={pending || first}
        onClick={() => move("UP")}
        className="h-8 w-8 rounded-md text-muted hover:bg-surface-raised disabled:opacity-40"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={pending || last}
        onClick={() => move("DOWN")}
        className="h-8 w-8 rounded-md text-muted hover:bg-surface-raised disabled:opacity-40"
      >
        ↓
      </button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function DeleteEncounterButton({ bossId, name }: { bossId: string; name: string }) {
  return (
    <ContentDialog
      triggerLabel="Delete"
      triggerVariant="ghost"
      triggerClassName="h-8 px-2 text-xs text-danger"
      title={`Delete encounter ${name}?`}
      description="This raid is not used by any Run, Run Setup, Product or lockout, so the encounter can be removed. Remaining encounters are renumbered. This cannot be undone."
      submitLabel="Delete encounter"
      pendingLabel="Deleting…"
      danger
      onSubmit={() => deleteEncounterAction({ bossId })}
    />
  );
}
