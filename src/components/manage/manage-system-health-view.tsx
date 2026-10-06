import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import {
  INTEGRATION_EVENT_STATUSES,
  INTEGRATION_PROVIDERS,
  type IntegrationEventStatus,
  type IntegrationProvider,
} from "@/models/enums";
import type { SystemHealthPage } from "@/services/system-health.service";
import type { SystemHealthState } from "@/lib/system-health";
import { SYSTEM_HEALTH_PROVIDER_LABELS } from "@/lib/system-health";
import { SystemHealthAdminActions } from "@/components/manage/system-health-admin-actions";

const STATE_STYLES: Record<SystemHealthState, string> = {
  HEALTHY: "bg-emerald-500/15 text-emerald-700",
  DEGRADED: "bg-amber-500/15 text-amber-800",
  DOWN: "bg-red-500/15 text-red-700",
  NOT_CONFIGURED: "bg-slate-500/15 text-slate-700",
  UNKNOWN: "bg-slate-500/10 text-muted",
};

function buildFilterHref(input: {
  provider: IntegrationProvider | null;
  status: IntegrationEventStatus | null;
  operation: string | null;
  offset?: number;
}): string {
  const params = new URLSearchParams();
  if (input.provider) params.set("provider", input.provider);
  if (input.status) params.set("status", input.status);
  if (input.operation) params.set("operation", input.operation);
  if (input.offset && input.offset > 0) params.set("offset", String(input.offset));
  const query = params.toString();
  return query ? `/manage/system?${query}` : "/manage/system";
}

function formatWhen(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ManageSystemHealthView({ page }: { page: SystemHealthPage }) {
  const { filters } = page;
  const prevOffset = Math.max(0, filters.offset - filters.limit);
  const nextOffset = filters.offset + filters.limit;
  const hasPrev = filters.offset > 0;
  const hasNext = page.events.length >= filters.limit;

  return (
    <div>
      <PageHeader
        title="System Health"
        description="Aggregate integration health and recent structured telemetry. Character-level Blizzard troubleshooting stays on Character Operations."
      />

      <SystemHealthAdminActions />

      <section aria-labelledby="provider-health-heading" className="mb-8">
        <h2 id="provider-health-heading" className="mb-3 text-sm font-semibold">
          Providers
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {page.providers.map((card) => (
            <Card key={card.provider} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{card.label}</h3>
                  <p className="mt-1 text-xs text-muted">
                    {card.configured ? "Configured" : "Not configured"} · {card.recentEventCount} recent
                    event{card.recentEventCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={`rounded-md px-2 py-1 text-xs font-medium ${STATE_STYLES[card.state]}`}
                >
                  {card.state.replaceAll("_", " ")}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                <Link
                  href={buildFilterHref({
                    provider: card.provider,
                    status: filters.status,
                    operation: filters.operation,
                  })}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  View events
                </Link>
              </div>
              {card.blizzard ? (
                <div className="mt-3 space-y-2 border-t border-border/70 pt-3 text-xs">
                  {card.blizzard.lastScheduledPass ? (
                    <p className="text-muted">
                      Last scheduled sync: {card.blizzard.lastScheduledPass.status}
                      {card.blizzard.lastScheduledPass.succeeded != null
                        ? ` · ${card.blizzard.lastScheduledPass.succeeded} ok`
                        : ""}
                      {card.blizzard.lastScheduledPass.failed != null
                        ? ` · ${card.blizzard.lastScheduledPass.failed} failed`
                        : ""}
                      {card.blizzard.lastScheduledPass.rateLimited != null &&
                      card.blizzard.lastScheduledPass.rateLimited > 0
                        ? ` · ${card.blizzard.lastScheduledPass.rateLimited} rate-limited`
                        : ""}
                      {card.blizzard.lastScheduledPass.durationMs != null
                        ? ` · ${card.blizzard.lastScheduledPass.durationMs}ms`
                        : ""}
                      {` · ${formatWhen(card.blizzard.lastScheduledPass.createdAt)}`}
                    </p>
                  ) : (
                    <p className="text-muted">No scheduled sync pass recorded in the recent window.</p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {card.blizzard.characterOpsLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="font-medium text-accent hover:underline"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              {card.backup ? (
                <div className="mt-3 space-y-1 border-t border-border/70 pt-3 text-xs text-muted">
                  <p>
                    Retention:{" "}
                    {card.backup.retentionDays != null ? `${card.backup.retentionDays} days` : "unknown"}
                  </p>
                  <p>
                    Last success:{" "}
                    {card.backup.lastSuccessAt
                      ? `${formatWhen(card.backup.lastSuccessAt)}${
                          card.backup.lastSuccessfulAgeHours != null
                            ? ` (${card.backup.lastSuccessfulAgeHours}h ago)`
                            : ""
                        }`
                      : "none recorded"}
                  </p>
                  <p>
                    Last failure:{" "}
                    {card.backup.lastFailureAt ? formatWhen(card.backup.lastFailureAt) : "none recorded"}
                  </p>
                  <p>
                    Size:{" "}
                    {card.backup.lastSuccessSizeBytes != null
                      ? `${Math.round(card.backup.lastSuccessSizeBytes / 1024)} KiB`
                      : "unknown"}
                  </p>
                  <p>
                    Dump list validation:{" "}
                    {card.backup.listValidated == null
                      ? "unknown"
                      : card.backup.listValidated
                        ? "passed at backup time"
                        : "not recorded"}
                  </p>
                  <p>
                    Restore verification:{" "}
                    {card.backup.lastRestoreVerificationAt
                      ? formatWhen(card.backup.lastRestoreVerificationAt)
                      : "not recorded (dump existence ≠ recoverable)"}
                  </p>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-events-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="recent-events-heading" className="text-sm font-semibold">
              Recent events
            </h2>
            <p className="mt-1 text-xs text-muted">Newest first · bounded / paginated</p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
            <label className="grid gap-1">
              <span className="text-xs text-muted">Provider</span>
              <select
                name="provider"
                defaultValue={filters.provider ?? ""}
                className="h-9 rounded-md border border-border bg-transparent px-2"
              >
                <option value="">All</option>
                {INTEGRATION_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {SYSTEM_HEALTH_PROVIDER_LABELS[provider]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Status</span>
              <select
                name="status"
                defaultValue={filters.status ?? ""}
                className="h-9 rounded-md border border-border bg-transparent px-2"
              >
                <option value="">All</option>
                {INTEGRATION_EVENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted">Operation</span>
              <input
                name="operation"
                defaultValue={filters.operation ?? ""}
                placeholder="e.g. SYNC_ONCE"
                className="h-9 w-44 rounded-md border border-border bg-transparent px-2"
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-accent px-3 text-sm font-medium text-black hover:bg-[#d8b436]"
            >
              Filter
            </button>
            <Link
              href="/manage/system"
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
            >
              Reset
            </Link>
          </form>
        </div>

        <Card className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Operation</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">HTTP</th>
                <th className="px-3 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {page.events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-muted">
                    No telemetry events match these filters yet. Provider instrumentation will fill this
                    table over time.
                  </td>
                </tr>
              ) : (
                page.events.map((event) => (
                  <tr key={event.id} className="border-b border-border/70">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatWhen(event.createdAt)}</td>
                    <td className="px-3 py-2">{SYSTEM_HEALTH_PROVIDER_LABELS[event.provider]}</td>
                    <td className="px-3 py-2 font-mono text-xs">{event.operation}</td>
                    <td className="px-3 py-2">{event.status}</td>
                    <td className="px-3 py-2 font-mono text-xs">{event.errorCode ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{event.httpStatus ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {event.durationMs == null ? "—" : `${event.durationMs}ms`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            Offset {filters.offset} · showing up to {filters.limit}
          </span>
          <div className="flex gap-2">
            {hasPrev ? (
              <Link
                href={buildFilterHref({
                  provider: filters.provider,
                  status: filters.status,
                  operation: filters.operation,
                  offset: prevOffset,
                })}
                className="rounded-md border border-border px-3 py-1.5"
              >
                Previous
              </Link>
            ) : null}
            {hasNext ? (
              <Link
                href={buildFilterHref({
                  provider: filters.provider,
                  status: filters.status,
                  operation: filters.operation,
                  offset: nextOffset,
                })}
                className="rounded-md border border-border px-3 py-1.5"
              >
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
