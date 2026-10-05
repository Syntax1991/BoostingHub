/**
 * Best-effort System Health telemetry for host backups.
 * Invoked by deploy/production/backup-db.sh (root) as the boostinghub user.
 *
 * Args (env or argv):
 *   BACKUP_TELEMETRY_STATUS=SUCCESS|ERROR
 *   BACKUP_TELEMETRY_SIZE_BYTES=<number> (optional)
 *   BACKUP_TELEMETRY_RETENTION_DAYS=<number> (optional)
 *   BACKUP_TELEMETRY_REASON=<short code> (optional)
 *
 * Never accepts backup file paths or database URLs as telemetry payload.
 */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { integrationEventService } from "@/services/integration-event.service";

function arg(name: string): string | undefined {
  const envKey = `BACKUP_TELEMETRY_${name}`;
  if (process.env[envKey]?.trim()) return process.env[envKey]!.trim();
  const flag = `--${name.toLowerCase().replaceAll("_", "-")}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

const statusRaw = (arg("STATUS") ?? "ERROR").toUpperCase();
const status = statusRaw === "SUCCESS" ? "SUCCESS" : "ERROR";
const sizeBytes = Number(arg("SIZE_BYTES") ?? "");
const retentionDays = Number(arg("RETENTION_DAYS") ?? "");
const reason = arg("REASON") ?? null;

await integrationEventService.record({
  provider: "BACKUP",
  operation: "DATABASE_BACKUP",
  status,
  errorCode: status === "ERROR" ? reason ?? "BACKUP_FAILED" : null,
  metadata: {
    backupSizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
    backupAgeHours: 0,
    retentionDays: Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : null,
    configured: true,
    reason: status === "ERROR" ? reason : null,
  },
});

const statusDir = path.join(process.cwd(), "var");
await mkdir(statusDir, { recursive: true });
const statusPath = path.join(statusDir, "backup-status.json");
const now = new Date().toISOString();
const payload = {
  configured: true,
  retentionDays: Number.isFinite(retentionDays) && retentionDays >= 0 ? retentionDays : null,
  lastSuccessAt: status === "SUCCESS" ? now : null,
  lastFailureAt: status === "ERROR" ? now : null,
  lastSuccessSizeBytes: status === "SUCCESS" && Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
  lastResult: status,
  listValidated: status === "SUCCESS",
  updatedAt: now,
};

// Merge with prior file so a failure does not wipe lastSuccessAt.
try {
  const { readFile } = await import("node:fs/promises");
  const prior = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
  if (status === "ERROR") {
    payload.lastSuccessAt =
      typeof prior.lastSuccessAt === "string" ? prior.lastSuccessAt : null;
    payload.lastSuccessSizeBytes =
      typeof prior.lastSuccessSizeBytes === "number" ? prior.lastSuccessSizeBytes : null;
  }
  if (status === "SUCCESS") {
    payload.lastFailureAt =
      typeof prior.lastFailureAt === "string" ? prior.lastFailureAt : null;
  }
} catch {
  // First write or unreadable prior — use fresh payload.
}

await writeFile(statusPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o640 });
console.log(`[backup-telemetry] recorded ${status}`);
process.exit(0);
