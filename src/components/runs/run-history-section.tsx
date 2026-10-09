import { formatDateTime } from "@/lib/datetime";
import { Card, CardHeader } from "@/components/ui/primitives";
import type { RunDomainEventView } from "@/services/run-domain-event.service";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/labels";
import type { AttendanceStatus } from "@/models/enums";

function eventLabel(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Internal identifiers stay out of the History UI (kept in the stored payload for audit). */
function payloadLines(payload: RunDomainEventView["payload"]): Array<[string, string]> {
  if (!payload) return [];
  return Object.entries(payload)
    .filter(([key]) => !/Id$/.test(key) && key !== "correctionPhase")
    .map(([key, value]) => [key, value === null ? "—" : String(value)]);
}

function statusLabel(value: unknown): string {
  return typeof value === "string" && value in ATTENDANCE_STATUS_LABELS
    ? ATTENDANCE_STATUS_LABELS[value as AttendanceStatus]
    : String(value ?? "—");
}

/** Post-completion attendance correction: participant, status change and reason, always visible. */
function attendanceCorrection(event: RunDomainEventView) {
  const payload = event.payload;
  if (event.type !== "ATTENDANCE_CORRECTED" || payload?.correctionPhase !== "AFTER_COMPLETION") return null;
  return {
    participant: String(payload.participantName ?? "Participant"),
    change: `${statusLabel(payload.fromStatus)} → ${statusLabel(payload.toStatus)}`,
    reason: typeof payload.reason === "string" ? payload.reason : null,
  };
}

/**
 * Manager-facing Run History chronology. Does not dump raw JSON.
 */
export function RunHistorySection({ events }: { events: RunDomainEventView[] }) {
  return (
    <Card>
      <CardHeader
        title="History"
        description="Meaningful Run lifecycle events. Not a full persistence log."
      />
      {events.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">No history recorded for this run yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {events.map((event) => {
            const correction = attendanceCorrection(event);
            if (correction) {
              return (
                <li key={event.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">Attendance corrected after completion</span>
                    <time className="text-xs text-muted" dateTime={event.occurredAt}>
                      {formatDateTime(event.occurredAt)}
                    </time>
                  </div>
                  <p className="mt-0.5">
                    <span className="font-medium">{correction.participant}</span>
                    <span className="text-muted"> · {correction.change}</span>
                  </p>
                  {correction.reason ? <p className="mt-0.5 text-muted">Reason: {correction.reason}</p> : null}
                  <p className="mt-0.5 text-xs text-muted">
                    Corrected by <span className="text-foreground">{event.actorName ?? "Unknown"}</span>
                  </p>
                </li>
              );
            }
            const details = payloadLines(event.payload);
            return (
              <li key={event.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{eventLabel(event.type)}</span>
                  <time className="text-xs text-muted" dateTime={event.occurredAt}>
                    {formatDateTime(event.occurredAt)}
                  </time>
                </div>
                <p className="mt-0.5 text-muted">
                  <span className="text-foreground">{event.actorName ?? "Unknown"}</span>
                  {" · "}
                  {event.summary}
                </p>
                {details.length > 0 ? (
                  <details className="mt-1 text-xs text-muted">
                    <summary className="cursor-pointer hover:text-foreground">Details</summary>
                    <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                      {details.map(([key, value]) => (
                        <div key={key}>
                          <dt className="inline text-muted">{key}: </dt>
                          <dd className="inline text-foreground">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
