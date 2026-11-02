import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orm } from "@/lib/prisma";
import { pgPool } from "@/lib/pg-pool";

/**
 * Runs the exact backfill SQL shipped in the add_notification_visible_in_app
 * migration (ops.json) against representative rows: only the silent removal
 * half of a booster character swap may be hidden.
 */
const MIGRATION_DIR = path.resolve(
  process.cwd(),
  "migrations/app/20260925T0925_add_notification_visible_in_app",
);

type RawOp = { id: string; execute?: Array<{ sql: string }> };

function backfillSql(): string[] {
  const ops = JSON.parse(readFileSync(path.join(MIGRATION_DIR, "ops.json"), "utf-8")) as RawOp[];
  const op = ops.find((candidate) => candidate.id === "data_migration.hide-roster-swap-bookkeeping-removals");
  if (!op?.execute?.length) throw new Error("backfill op missing from ops.json");
  return op.execute.map((step) => step.sql);
}

const userId = "nv000000-0000-4000-8000-000000000001";
const otherUserId = "nv000000-0000-4000-8000-000000000002";
const runId = "nv-backfill-run";
const created = "2026-09-20T10:00:00.000Z";
const later = "2026-09-20T12:00:00.000Z";

async function createUser(id: string) {
  await orm.User.create({
    id,
    name: id,
    email: `${id}@nvbackfill.boostting.local`,
    emailVerified: true,
    discordUserId: null,
    discordUsername: null,
    accountRole: "USER",
    accountStatus: "ACTIVE",
    discordDmEnabled: true,
    dmRosterSelectedEnabled: true,
    dmRaidInviteEnabled: true,
    dmRunCancelledEnabled: true,
    dmRunRescheduledEnabled: true,
    dmRosterRemovedEnabled: true,
    timeZone: "Europe/Berlin",
    createdAt: created,
    updatedAt: created,
  });
}

async function note(input: {
  owner?: string;
  type: "ROSTER_SELECTED" | "ROSTER_REMOVED";
  sourceKey: string;
  readAt: string | null;
  status: "PENDING" | "SKIPPED" | "SENT";
  discordUserId?: string | null;
}) {
  await orm.UserNotification.create({
    id: crypto.randomUUID(),
    userId: input.owner ?? userId,
    type: input.type,
    // The run may be gone (runId SetNull); the backfill only relies on sourceKey.
    runId: null,
    signupId: null,
    sourceKey: input.sourceKey,
    title: input.type === "ROSTER_REMOVED" ? "Removed from roster" : "Roster updated",
    message: "backfill fixture",
    href: "/notifications",
    readAt: input.readAt,
    discordDeliveryStatus: input.status,
    discordUserId: input.discordUserId ?? null,
    discordDeliverAfter: null,
    createdAt: created,
    updatedAt: created,
  });
  return input.sourceKey;
}

async function visibleInApp(sourceKey: string): Promise<boolean> {
  const row = (await orm.UserNotification.where({ sourceKey }).first()) as Record<string, unknown> | null;
  if (!row) throw new Error(`missing ${sourceKey}`);
  return row.visibleInApp as boolean;
}

async function cleanup() {
  for (const id of [userId, otherUserId]) {
    const rows = await orm.UserNotification.where({ userId: id }).select("id").all();
    for (const row of rows) {
      await orm.UserNotification.where({ id: (row as { id: string }).id }).delete();
    }
    await orm.User.where({ id }).delete().catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  await createUser(userId);
  await createUser(otherUserId);
});

afterAll(cleanup);

describe("migration backfill: hide roster swap bookkeeping removals", () => {
  it("hides only the silent removal paired with a same-user/run/version roster-swapped event", async () => {
    const removed = (version: number, signup: string) => `roster-removed:${runId}:${version}:${signup}`;
    const swapped = (version: number, signup: string) => `roster-swapped:${runId}:${version}:${signup}`;
    const silent = { type: "ROSTER_REMOVED" as const, readAt: created, status: "SKIPPED" as const };

    // A. normal removal (DM pending, unread)
    const a = await note({ type: "ROSTER_REMOVED", sourceKey: removed(1, "a"), readAt: null, status: "PENDING", discordUserId: "1" });
    // B. normal removal the player read later — even at the version of a swap
    await note({ type: "ROSTER_SELECTED", sourceKey: swapped(2, "b-new"), readAt: null, status: "PENDING" });
    const b = await note({ type: "ROSTER_REMOVED", sourceKey: removed(2, "b-other"), readAt: later, status: "SKIPPED" });
    // C. DM disabled: SKIPPED, no Discord id, unread
    const c = await note({ type: "ROSTER_REMOVED", sourceKey: removed(3, "c"), readAt: null, status: "SKIPPED" });
    // D. the silent swap half: same user, run and version as a roster-swapped event
    await note({ type: "ROSTER_SELECTED", sourceKey: swapped(4, "d-new"), readAt: null, status: "PENDING" });
    const d = await note({ ...silent, sourceKey: removed(4, "d-old") });
    // Silent-looking removals that cannot be proven to be a swap stay visible:
    // no swap event at all
    const noPair = await note({ ...silent, sourceKey: removed(5, "e") });
    // the swap event belongs to another user
    await note({ owner: otherUserId, type: "ROSTER_SELECTED", sourceKey: swapped(6, "f-new"), readAt: null, status: "PENDING" });
    const otherUser = await note({ ...silent, sourceKey: removed(6, "f-old") });
    // the swap event is at another roster version
    await note({ type: "ROSTER_SELECTED", sourceKey: swapped(8, "g-new"), readAt: null, status: "PENDING" });
    const otherVersion = await note({ ...silent, sourceKey: removed(7, "g-old") });
    // the swap event is for another run
    await note({ type: "ROSTER_SELECTED", sourceKey: `roster-swapped:other-run:9:h-new`, readAt: null, status: "PENDING" });
    const otherRun = await note({ ...silent, sourceKey: removed(9, "h-old") });

    for (const sql of backfillSql()) await pgPool.query(sql);
    // Idempotent: a second pass changes nothing.
    for (const sql of backfillSql()) await pgPool.query(sql);

    expect(await visibleInApp(a)).toBe(true);
    expect(await visibleInApp(b)).toBe(true);
    expect(await visibleInApp(c)).toBe(true);
    expect(await visibleInApp(d)).toBe(false);
    expect(await visibleInApp(noPair)).toBe(true);
    expect(await visibleInApp(otherUser)).toBe(true);
    expect(await visibleInApp(otherVersion)).toBe(true);
    expect(await visibleInApp(otherRun)).toBe(true);
    // The roster-swapped events themselves stay visible.
    expect(await visibleInApp(swapped(4, "d-new"))).toBe(true);
    expect(await visibleInApp(swapped(2, "b-new"))).toBe(true);
  });
});
