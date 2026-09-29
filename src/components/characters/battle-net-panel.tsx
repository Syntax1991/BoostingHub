"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { disconnectBattleNetAction, refreshAllBattleNetCharactersAction } from "@/controllers/blizzard.actions";
import { BattleNetImportDialog } from "@/components/characters/battle-net-import-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/primitives";
import { REGION_LABELS } from "@/lib/labels";
import {
  battleNetErrorFlashCleanUrl,
  battleNetFlashMessage,
  type BattleNetFlashMessage,
} from "@/lib/blizzard/battle-net-flash";
import { CharacterFormDialog } from "@/components/characters/character-form-dialog";
import { formatDateTime } from "@/lib/datetime";
import type { WowRegion } from "@/models/enums";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type BattleNetPanelData = Page["battleNet"];
type BattleNetFlash = Page["battleNetFlash"];
type Connection = BattleNetPanelData["connections"][number];
type CandidatesPayload = NonNullable<BattleNetPanelData["candidates"]>;

const REGIONS: WowRegion[] = ["EU", "US"];

function connectionFor(connections: Connection[], region: WowRegion): Connection | undefined {
  return connections.find((row) => row.region === region);
}

function candidatesForRegion(
  battleNet: BattleNetPanelData,
  region: WowRegion,
): CandidatesPayload | null {
  return battleNet.candidatesByRegion?.[region] ?? null;
}

export function BattleNetPanel({
  battleNet,
  battleNetFlash,
}: {
  battleNet: BattleNetPanelData;
  battleNetFlash: BattleNetFlash;
}) {
  const router = useRouter();
  const flash = battleNetFlashMessage(battleNetFlash);
  const [openRegion, setOpenRegion] = useState<WowRegion | null>(() => {
    if (battleNetFlash.status !== "connected") return null;
    const region = battleNetFlash.region;
    if (region !== "EU" && region !== "US") return null;
    if (!candidatesForRegion(battleNet, region)) return null;
    return region;
  });
  const lastImportButtonRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (battleNetFlash.status !== "connected") return;
    const region = battleNetFlash.region;
    if (region !== "EU" && region !== "US") return;
    router.replace("/characters", { scroll: false });
  }, [battleNetFlash.status, battleNetFlash.region, router]);

  // Error flashes: drop only the Battle.net flash parameters from the address bar. The
  // native History API syncs with the router without a server round-trip, so the error
  // stays visible now but a later refresh does not show it again.
  useEffect(() => {
    if (battleNetFlash.status !== "error") return;
    const clean = battleNetErrorFlashCleanUrl(window.location.href);
    if (clean) window.history.replaceState(null, "", clean);
  }, [battleNetFlash.status]);

  const activeCandidates = openRegion ? candidatesForRegion(battleNet, openRegion) : null;
  const activeConnection = openRegion
    ? connectionFor(battleNet.connections, openRegion)
    : undefined;

  return (
    <Card className="mb-4">
      <CardHeader
        title="Battle.net Accounts"
        description="Optional. Connect a region to import or link owned characters from Blizzard."
      />
      <div className="space-y-3 px-4 py-4">
        {!battleNet.configured ? (
          <p className="text-sm text-muted">
            Battle.net is not configured on this server. You can still manage characters manually.
          </p>
        ) : null}
        {flash?.callout ? (
          <AccountProfileForbiddenCallout callout={flash.callout} />
        ) : flash ? (
          <p
            role={flash.tone === "danger" ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-sm ${
              flash.tone === "success"
                ? "border-success/40 bg-success/10"
                : "border-danger/40 bg-danger/10"
            }`}
          >
            {flash.text}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {REGIONS.map((region) => (
            <RegionRow
              key={region}
              region={region}
              configured={battleNet.configured}
              connection={connectionFor(battleNet.connections, region)}
              candidates={candidatesForRegion(battleNet, region)}
              importButtonRef={(node) => {
                if (openRegion === region || (!openRegion && node)) {
                  lastImportButtonRef.current = node;
                }
              }}
              onOpenImport={(button) => {
                lastImportButtonRef.current = button;
                setOpenRegion(region);
              }}
            />
          ))}
        </div>
      </div>
      <BattleNetImportDialog
        open={Boolean(openRegion && activeCandidates)}
        onOpenChange={(next) => {
          if (!next) setOpenRegion(null);
        }}
        candidates={activeCandidates}
        battleTag={activeConnection?.battleTag}
        returnFocusRef={lastImportButtonRef}
      />
    </Card>
  );
}

function RegionRow({
  region,
  configured,
  connection,
  candidates,
  importButtonRef,
  onOpenImport,
}: {
  region: WowRegion;
  configured: boolean;
  connection: Connection | undefined;
  candidates: CandidatesPayload | null;
  importButtonRef: (node: HTMLButtonElement | null) => void;
  onOpenImport: (button: HTMLButtonElement | null) => void;
}) {
  const router = useRouter();
  const errorId = useId();
  const [, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"refresh" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const connected = Boolean(connection);
  const connectHref = `/api/integrations/battlenet/connect?region=${region}`;
  const hasLiveSession = Boolean(candidates?.sessionId);
  const pending = pendingAction !== null;

  function disconnect() {
    setError(null);
    setSuccess(null);
    setPendingAction("disconnect");
    startTransition(async () => {
      const result = await disconnectBattleNetAction({ region });
      setPendingAction(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function refreshAll() {
    setError(null);
    setSuccess(null);
    setPendingAction("refresh");
    startTransition(async () => {
      const result = await refreshAllBattleNetCharactersAction({ region });
      setPendingAction(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(result.message);
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{REGION_LABELS[region]}</p>
          <p className="mt-0.5 text-xs text-muted">
            {connected ? "Connected" : "Not connected"}
            {connection?.battleTag ? ` · ${connection.battleTag}` : null}
          </p>
          {connection?.lastSuccessfulSyncAt ? (
            <p className="mt-0.5 text-xs text-muted">
              Last sync {formatDateTime(connection.lastSuccessfulSyncAt)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {configured ? (
            <>
              {/* Every active Character syncs; without a connection it syncs from the public API. */}
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={refreshAll}
                className="h-8 px-2 text-xs"
              >
                {pendingAction === "refresh" ? "Refreshing…" : "Refresh all"}
              </Button>
              <a
                href={connectHref}
                className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
              >
                {connected ? "Reconnect" : "Connect"}
              </a>
              {connected ? (
                <>
                  {hasLiveSession ? (
                    <button
                      ref={importButtonRef}
                      type="button"
                      onClick={(event) => onOpenImport(event.currentTarget)}
                      className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
                    >
                      Import
                    </button>
                  ) : (
                    <a
                      href={connectHref}
                      className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
                      title="Reconnect to refresh owned characters"
                    >
                      Import
                    </a>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={disconnect}
                    className="h-8 px-2 text-xs"
                    aria-describedby={error ? errorId : undefined}
                  >
                    {pendingAction === "disconnect" ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted">Unavailable</span>
          )}
        </div>
      </div>
      {success ? (
        <p role="status" className="mt-2 text-xs text-success">
          {success}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AccountProfileForbiddenCallout({
  callout,
}: {
  callout: NonNullable<BattleNetFlashMessage["callout"]>;
}) {
  const titleId = useId();
  return (
    <div
      role="alert"
      aria-labelledby={titleId}
      className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      <div className="min-w-0 space-y-2">
        <p id={titleId} className="font-semibold">
          {callout.title}
        </p>
        {callout.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          {/* The same Add Character flow as the page header; the Region rows below keep Connect. */}
          <CharacterFormDialog mode="create" triggerLabel="Add character manually" />
        </div>
      </div>
    </div>
  );
}
