import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { PageWorkspace } from "@/components/ui/layout";
import { KpiItem, KpiStrip } from "@/components/ui/data-table";
import type { OperationalAnalyticsReport } from "@/services/operational-analytics";
import { formatDateTime } from "@/lib/datetime";

function pct(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

function CountList({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (
    <Card flush>
      <CardHeader title={title} />
      {entries.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted">No data in range.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {entries.map(([key, value]) => (
            <li key={key} className="flex justify-between px-3 py-1.5">
              <span>{key}</span>
              <span className="font-medium tabular-nums">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ManageAnalyticsView({ report }: { report: OperationalAnalyticsReport }) {
  return (
    <PageWorkspace>
      <PageHeader
        title="Operational Analytics"
        description={`${formatDateTime(report.range.from)} → ${formatDateTime(report.range.to)} (${report.range.days}d). No financial data.`}
      />

      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Volume</p>
      <KpiStrip>
        <KpiItem label="Runs" value={report.totalRuns} />
        <KpiItem label="Cancellations" value={report.cancellations} tone="warning" />
        <KpiItem label="Rescheduled" value={report.reschedules} />
        <KpiItem label="External boosters" value={report.runsWithExternalBoosters} />
      </KpiStrip>

      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Staffing</p>
      <KpiStrip>
        <KpiItem label="Active signups" value={report.activeSignups} />
        <KpiItem label="Selected" value={report.selectedSignups} />
        <KpiItem label="Signup → selected" value={pct(report.signupToSelectedRate)} />
        <KpiItem label="External share" value={pct(report.externalShareOfStaffing)} />
      </KpiStrip>

      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Attendance</p>
      <KpiStrip className="sm:grid-cols-3">
        <KpiItem label="Marked" value={report.markedAttendance} />
        <KpiItem label="No-shows" value={report.noShows} tone={report.noShows > 0 ? "danger" : "default"} />
        <KpiItem label="No-show rate" value={pct(report.noShowRate)} />
      </KpiStrip>

      <div className="grid gap-2 lg:grid-cols-3">
        <CountList title="By status" counts={report.byStatus} />
        <CountList title="By difficulty" counts={report.byDifficulty} />
        <CountList title="By loot type" counts={report.byLootType} />
      </div>
    </PageWorkspace>
  );
}
