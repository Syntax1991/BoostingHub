import { formatDateTime } from "@/lib/datetime";
import { DIFFICULTY_LABELS } from "@/lib/labels";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { ClassBadge, RoleBadge } from "@/components/ui/badges";
import type { characterService } from "@/services/character.service";

type Page = Awaited<ReturnType<typeof characterService.getCharacterPage>>;

export function CharactersView({ data }: { data: Page }) {
  return (
    <div>
      <PageHeader
        title="Characters"
        description="Local character records for this account. Blizzard and Warcraft Logs sync are not implemented yet."
        actions={
          <div className="flex gap-2">
            <DisabledAction label="Add Character" reason="Character management is not implemented yet. Battle.net sync comes later." />
            <DisabledAction label="Refresh" reason="Blizzard sync is not implemented." />
          </div>
        }
      />
      <Card>
        {data.characters.length === 0 ? (
          <EmptyState title="No characters added yet." description="This account has no roster yet. Character management is the next product feature." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Character</th>
                  <th className="px-4 py-2 font-medium">Class / Spec</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">iLvl</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="px-4 py-2 font-medium">Booster access</th>
                  <th className="px-4 py-2 font-medium">Lockouts ({data.currentReset})</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.characters.map((character) => (
                  <tr key={character.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="max-w-[200px] truncate font-medium">{character.name}</div>
                      <div className="max-w-[220px] truncate text-xs text-muted">
                        {character.realm}-{character.region}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ClassBadge wowClass={character.wowClass} />
                      <div className="text-xs text-muted">{character.specialization ?? "No spec"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={character.primaryRole} />
                    </td>
                    <td className="px-4 py-3">{character.itemLevel}</td>
                    <td className="px-4 py-3 text-muted">{character.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-3 text-xs">
                      {character.boosterAccess.approvals.length === 0 ? (
                        <span className="text-muted">None approved</span>
                      ) : (
                        <ul className="space-y-1">
                          {character.boosterAccess.approvals.map((approval) => (
                            <li key={`${approval.role}-${approval.difficulty}`}>
                              {approval.role} · {DIFFICULTY_LABELS[approval.difficulty]}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {character.lockouts.length === 0 ? (
                        <span className="text-muted">Clear</span>
                      ) : (
                        <ul className="space-y-1">
                          {character.lockouts.map((lockout) => (
                            <li key={`${lockout.raidName}-${lockout.difficulty}`}>
                              {DIFFICULTY_LABELS[lockout.difficulty]} ·{" "}
                              {lockout.isComplete ? "complete" : `${lockout.bossesDefeated} bosses`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {character.lastSyncedAt ? formatDateTime(character.lastSyncedAt) : "Never synced"}
                    </td>
                    <td className="px-4 py-3">
                      <DisabledAction label="Details" reason="Character detail pages are not in Phase 1." />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function DisabledAction({ label, reason }: { label: string; reason: string }) {
  return (
    <button
      type="button"
      disabled
      title={reason}
      className="h-8 rounded-md border border-border px-2 text-xs text-muted"
    >
      {label}
    </button>
  );
}
