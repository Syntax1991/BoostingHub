import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import type { OperationalAnalyticsReport } from "@/services/operational-analytics";
import { formatDateTime } from "@/lib/datetime";

function pct(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-medium text-foreground">{value}</dd>
    </div>
  );
}

function CountList({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (
    <Card>
      <CardHeader title={title} />
      {entries.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">No data in range.</p>
      ) : (
        <ul className="divide-y divide-border px-4 py-2 text-sm">
          {entries.map(([key, value]) => (
            <li key={key} className="flex justify-between py-2">
              <span>{key}</span>
              <span className="font-medium">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ManageAnalyticsView({ report }: { report: OperationalAnalyticsReport }) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Operational Analytics"
        description={`High-confidence operational metrics · ${formatDateTime(report.range.from)} → ${formatDateTime(report.range.to)} (${report.range.days}d). No financial data.`}
      />
      <Card>
        <CardHeader title="Volume" description="Runs scheduled in the selected window." />
        <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4">
          <Metric label="Runs" value={report.totalRuns} />
          <Metric label="Cancellations" value={report.cancellations} />
          <Metric label="Rescheduled (≥1)" value={report.reschedules} />
          <Metric label="With External Boosters" value={report.runsWithExternalBoosters} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Staffing" description="Signup and selection counts across Runs in range." />
        <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4">
          <Metric label="Active signups" value={report.activeSignups} />
          <Metric label="Selected signups" value={report.selectedSignups} />
          <Metric label="Signup → selected" value={pct(report.signupToSelectedRate)} />
          <Metric label="External share of staffing" value={pct(report.externalShareOfStaffing)} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="Attendance" description="Among marked attendance rows only." />
        <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-3">
          <Metric label="Marked attendance" value={report.markedAttendance} />
          <Metric label="No-shows" value={report.noShows} />
          <Metric label="No-show rate" value={pct(report.noShowRate)} />
        </dl>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <CountList title="By status" counts={report.byStatus} />
        <CountList title="By difficulty" counts={report.byDifficulty} />
        <CountList title="By loot type" counts={report.byLootType} />
      </div>
    </div>
  );
}
