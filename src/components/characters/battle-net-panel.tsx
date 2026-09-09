"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectBattleNetAction } from "@/controllers/blizzard.actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/primitives";
import { REGION_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/datetime";
import type { WowRegion } from "@/models/enums";
import type { characterController } from "@/controllers/app.controller";

type Page = Awaited<ReturnType<typeof characterController.getCharactersPage>>;
type BattleNetPanelData = Page["battleNet"];
type BattleNetFlash = Page["battleNetFlash"];
type Connection = BattleNetPanelData["connections"][number];

const REGIONS: WowRegion[] = ["EU", "US"];

function flashMessage(flash: BattleNetFlash): { tone: "success" | "danger"; text: string } | null {
  if (flash.status === "connected") {
    const region = flash.region && flash.region in REGION_LABELS
      ? REGION_LABELS[flash.region as WowRegion]
      : flash.region;
    return {
      tone: "success",
      text: region
        ? `Battle.net connected (${region}). Select characters to import or link below.`
        : "Battle.net connected. Select characters to import or link below.",
    };
  }
  if (flash.status === "error") {
    return {
      tone: "danger",
      text: flash.code
        ? `Battle.net connection failed (${flash.code}).`
        : "Battle.net connection failed.",
    };
  }
  return null;
}

function connectionFor(connections: Connection[], region: WowRegion): Connection | undefined {
  return connections.find((row) => row.region === region);
}

export function BattleNetPanel({
  battleNet,
  battleNetFlash,
}: {
  battleNet: BattleNetPanelData;
  battleNetFlash: BattleNetFlash;
}) {
  const flash = flashMessage(battleNetFlash);

  return (
    <Card className="mb-4">
      <CardHeader
        title="Battle.net"
        description="Optional. Connect a region to import or link owned characters from Blizzard."
      />
      <div className="space-y-3 px-4 py-4">
        {!battleNet.configured ? (
          <p className="text-sm text-muted">
            Battle.net is not configured on this server. You can still manage characters manually.
          </p>
        ) : null}
        {flash ? (
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
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function RegionRow({
  region,
  configured,
  connection,
}: {
  region: WowRegion;
  configured: boolean;
  connection: Connection | undefined;
}) {
  const router = useRouter();
  const errorId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connected = Boolean(connection);
  const connectHref = `/api/integrations/battlenet/connect?region=${region}`;

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const result = await disconnectBattleNetAction({ region });
      if (!result.ok) {
        setError(result.message);
        return;
      }
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
              <a
                href={connectHref}
                className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
              >
                {connected ? "Reconnect" : "Connect"}
              </a>
              {connected ? (
                <>
                  <a
                    href={connectHref}
                    className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs hover:bg-surface-raised"
                    title="Start a fresh import session"
                  >
                    Import
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={disconnect}
                    className="h-8 px-2 text-xs"
                    aria-describedby={error ? errorId : undefined}
                  >
                    {pending ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted">Unavailable</span>
          )}
        </div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
