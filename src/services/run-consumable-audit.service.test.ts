import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AuthenticatedUser } from "@/auth/authorization";
import { isDomainError } from "@/lib/errors";
import { orm } from "@/lib/prisma";
import {
  warcraftLogsApiClient,
  type WarcraftLogsConsumableEvents,
  type WarcraftLogsReportFight,
  type WarcraftLogsReportMetadata,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";
import { runConsumableAuditRepository } from "@/repositories/run-consumable-audit.repository";
import { runWarcraftLogsRepository } from "@/repositories/run-warcraft-logs.repository";
import { identityKey, type ConsumableAuditParticipant } from "@/services/consumable-audit-extract";
import { analyzeRun, runConsumableAuditService } from "@/services/run-consumable-audit.service";
import { runDetailService } from "@/services/run-detail.service";
import { runWarcraftLogsService } from "@/services/run-warcraft-logs.service";
import { knownSpecializationIds, specializationById } from "@/lib/wow-specializations";

/**
 * Two seeded COMPLETED Runs with IDENTICAL RunRaidContent (Manaforge Omega,
 * Heroic, both led by Thorne) share ONE Warcraft Logs report:
 *
 *   Run A (Settlement QA, 20 boosters)  active 14:00–15:20
 *   Run B (Completed Heroic, Kael)      active 15:28–16:50
 *   Report ABC: fights 1–8 during A, 9–16 during B, 17 at 15:24 (both windows).
 *
 * Kael boosts BOTH Runs with the same character, so any fact leaking across
 * the Run boundary would show up on Kael. Only audit/association rows, two
 * start snapshots, completedAt and one temporary user are written, and all
 * are restored afterwards.
 */
const RUN_A = "r9999996-9996-4996-8996-999999999996";
const RUN_B = "r9999992-9992-4992-8992-999999999992";
const LEGACY_RUN = "r9999993-9993-4993-8993-999999999993";
const IN_PROGRESS_RUN = "r9999991-9991-4991-8991-999999999991";
const SETTLEMENT_ROSTER_ID = "o9999996-9996-4996-8996-999999999996";
const OTHER_LEAD_ID = "ca000001-0000-4000-8000-00000000c0a1";
const EXTERNAL_ID = "ca000002-0000-4000-8000-00000000c0a2";
const REPORT = "AbCdEfGhIjKlMnOp";
/** A second logger of the same raid: same pulls, its clock 10.9 s ahead (production shape). */
const SECOND = "ZyXwVuTsRqPoNmLk";
const SECOND_SKEW_MS = 10_903;

const DAY = "2026-09-20";
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00.000Z`);
const MIN = 60_000;
const REPORT_START = at("14:05");
const PLEXUS = 3129;
const LOOMITHAR = 3131;

function asUser(id: string, name: string, accountRole: AuthenticatedUser["accountRole"]): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@dev.boostting.local`,
    image: null,
    discordUserId: null,
    discordUsername: null,
    accountRole,
    accountStatus: "ACTIVE",
  };
}

const kael = asUser("11111111-1111-4111-8111-111111111111", "Kael Stormhowl", "USER");
const thorne = asUser("33333333-3333-4333-8333-333333333333", "Thorne Ironvein", "RAID_LEAD");
const aelira = asUser("44444444-4444-4444-8444-444444444444", "Aelira Nightwatch", "ADMIN");
const otherLead = asUser(OTHER_LEAD_ID, "Other Lead", "RAID_LEAD");

async function expectDomainCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected domain error ${code}`);
  } catch (error) {
    expect(isDomainError(error) ? error.code : error).toBe(code);
  }
}

type Attended = Extract<ConsumableAuditParticipant, { source: "ATTENDANCE" }>;
let rosterA: Attended[] = [];
let rosterB: Attended[] = [];
let actorIdByKey = new Map<string, number>();
let kaelActor = 0;
/** Everybody in run A except its last booster is in the log. */
let inLogA: Attended[] = [];

const ids = (list: Attended[]) => list.map((p) => actorIdByKey.get(identityKey(p.characterName, p.characterRealm))!);

function fight(id: number, clock: string, overrides: Partial<WarcraftLogsReportFight> = {}): WarcraftLogsReportFight {
  const startTime = at(clock) - REPORT_START;
  return {
    id,
    encounterId: id % 2 === 0 ? LOOMITHAR : PLEXUS,
    name: id % 2 === 0 ? "Loom'ithar" : "Plexus Sentinel",
    startTime,
    endTime: startTime + 5 * MIN,
    kill: true,
    difficulty: 4,
    friendlyPlayers: [],
    ...overrides,
  };
}

function metadata(overrides: Partial<WarcraftLogsReportMetadata> = {}): WarcraftLogsReportMetadata {
  const clocksA = ["14:08", "14:16", "14:24", "14:33", "14:42", "14:51", "15:01", "15:11"];
  const clocksB = ["15:42", "15:51", "15:59", "16:08", "16:17", "16:27", "16:38", "16:44"];
  const aPlayers = ids(inLogA);
  const bPlayers = ids(rosterB);
  return {
    code: REPORT,
    title: "Two back-to-back MFO runs",
    startTime: REPORT_START,
    endTime: at("16:55"),
    regionSlug: "EU",
    fights: [
      // Fight 7 is a wipe inside Run A.
      ...clocksA.map((clock, i) => fight(i + 1, clock, { friendlyPlayers: aPlayers, kill: i !== 6 })),
      ...clocksB.map((clock, i) => fight(i + 9, clock, { friendlyPlayers: bPlayers })),
      // Between the Runs, inside both padded windows, everyone present: ambiguous.
      fight(17, "15:24", { friendlyPlayers: [...new Set([...aPlayers, ...bPlayers])] }),
    ],
    actors: [...actorIdByKey.entries()].map(([key, id]) => {
      const p = [...rosterA, ...rosterB].find((row) => identityKey(row.characterName, row.characterRealm) === key)!;
      return { id, name: p.characterName, server: p.characterRealm, subType: id === 1 ? "Warlock" : "Mage" };
    }),
    rankedCharacters: [],
    ...overrides,
  };
}

/** The whole report's events; the fake endpoint filters like WCL does. */
function reportEvents(): WarcraftLogsConsumableEvents {
  const meta = metadata();
  const combatants = meta.fights.flatMap((f) =>
    (f.friendlyPlayers ?? []).map((sourceId) => ({
      fight: f.id,
      timestamp: f.startTime,
      sourceId,
      auraIds: sourceId === ids(inLogA)[1] && f.id === 2 ? [] : [1235108],
    })),
  );
  const casts = meta.fights.flatMap((f) =>
    (f.friendlyPlayers ?? []).map((sourceId) => ({
      fight: f.id,
      timestamp: f.startTime + 2_000,
      sourceId,
      abilityId: 1236994,
    })),
  );
  const f = (id: number) => meta.fights.find((row) => row.id === id)!;
  casts.push(
    // Kael: Healthstone in A's fight 3; Healing Potion right before his death in B's fight 12.
    { fight: 3, timestamp: f(3).startTime + 60_000, sourceId: kaelActor, abilityId: 6262 },
    { fight: 12, timestamp: f(12).startTime + 118_000, sourceId: kaelActor, abilityId: 1234768 },
  );
  // The dying booster in fight 2 casts Divine Shield 10 s before; Kael's wipe death in 7 has none.
  casts.push({ fight: 2, timestamp: f(2).startTime + 80_000, sourceId: ids(inLogA)[1]!, abilityId: 642 });
  const deaths = [
    { fight: 7, timestamp: f(7).startTime + 200_000, targetId: kaelActor }, // wipe death in A
    { fight: 12, timestamp: f(12).startTime + 120_000, targetId: kaelActor }, // death in B
    { fight: 2, timestamp: f(2).startTime + 90_000, targetId: ids(inLogA)[1]! },
  ];
  return { casts, deaths, combatants };
}

let metadataSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportMetadata>;
let eventsSpy: MockInstance<typeof warcraftLogsApiClient.fetchReportConsumableEvents>;
let events: WarcraftLogsConsumableEvents;

/** Fake WCL: deaths/snapshots are fight-scoped; casts are time-window scoped (like the real query). */
function fakeEvents(input: Parameters<typeof warcraftLogsApiClient.fetchReportConsumableEvents>[0]) {
  const fights = new Set(input.fightIds);
  const from = input.startTime - (input.castLeadMs ?? 0);
  return {
    status: "SUCCESS" as const,
    events: {
      casts: events.casts.filter((row) => row.timestamp >= from && row.timestamp <= input.endTime),
      deaths: events.deaths.filter((row) => fights.has(row.fight)),
      combatants: events.combatants.filter((row) => fights.has(row.fight)),
    },
  };
}

let clock = Date.parse("2030-01-01T00:00:00.000Z");
/** A fresh "now" well past every cooldown and metadata reuse window. */
const later = () => {
  clock += 30 * MIN;
  return new Date(clock);
};

async function clearAssociations() {
  await orm.RunConsumableAudit.where((row) => row.runId.in([RUN_A, RUN_B, LEGACY_RUN])).deleteAndCount();
  await orm.RunWarcraftLogsReport.where((row) => row.runId.in([RUN_A, RUN_B, LEGACY_RUN])).deleteAndCount();
  await orm.WarcraftLogsReport.where((row) => row.code.in([REPORT, SECOND])).deleteAndCount();
}

async function attachAndAnalyze(user: AuthenticatedUser, runId: string, now = later()) {
  const attached = await runWarcraftLogsService.attachReport(user, { runId, reportCode: REPORT }, now);
  const analyzed = await runConsumableAuditService.analyze(user, { runId }, () => now, { skipCooldown: true });
  return { attached, analyzed };
}

async function fightStatuses(runId: string) {
  const rows = await runWarcraftLogsRepository.listRunFights(runId);
  return Object.fromEntries(rows.map((row) => [row.wclFightId, row.status]));
}

const createdSnapshots: string[] = [];

beforeAll(async () => {
  const pick = (rows: ConsumableAuditParticipant[]) =>
    rows.filter((row): row is Attended => row.source === "ATTENDANCE");
  rosterA = pick(await runConsumableAuditRepository.listParticipants(RUN_A));
  rosterB = pick(await runConsumableAuditRepository.listParticipants(RUN_B));
  expect(rosterA.length).toBeGreaterThan(3);
  expect(rosterB.length).toBeGreaterThan(0);
  inLogA = rosterA.slice(0, -1);
  actorIdByKey = new Map();
  // Only players actually in the log become report actors (A's last booster is absent).
  for (const p of [...inLogA, ...rosterB]) {
    const key = identityKey(p.characterName, p.characterRealm);
    if (!actorIdByKey.has(key)) actorIdByKey.set(key, actorIdByKey.size + 1);
  }
  const kaelInB = rosterB.find((p) => p.displayName === "Kael Stormhowl")!;
  kaelActor = actorIdByKey.get(identityKey(kaelInB.characterName, kaelInB.characterRealm))!;
  // Same character boosts both Runs.
  expect(rosterA.some((p) => identityKey(p.characterName, p.characterRealm) === identityKey(kaelInB.characterName, kaelInB.characterRealm))).toBe(true);

  const now = new Date().toISOString();
  for (const [runId, started, completed] of [
    [RUN_A, "14:00", "15:20"],
    [RUN_B, "15:28", "16:50"],
  ] as const) {
    if (!(await orm.RunStartSnapshot.where({ runId }).first())) {
      const id = crypto.randomUUID();
      createdSnapshots.push(id);
      await orm.RunStartSnapshot.create({
        id,
        runId,
        startedAt: new Date(at(started)).toISOString(),
        startedById: thorne.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await orm.Run.where({ id: runId }).update({ completedAt: new Date(at(completed)).toISOString() });
  }
  await orm.User.create({
    id: OTHER_LEAD_ID,
    name: "Other Lead",
    email: `${OTHER_LEAD_ID}@dev.boostting.local`,
    emailVerified: true,
    accountRole: "RAID_LEAD",
    accountStatus: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  await clearAssociations();
  await orm.RunExternalBooster.where({ id: EXTERNAL_ID }).deleteAndCount();
  for (const id of createdSnapshots) await orm.RunStartSnapshot.where({ id }).deleteAndCount();
  await orm.Run.where((row) => row.id.in([RUN_A, RUN_B])).updateAll({ completedAt: null });
  await orm.Run.where({ id: RUN_B }).update({ raidLeadId: thorne.id });
  await orm.User.where({ id: OTHER_LEAD_ID }).deleteAndCount();
});

beforeEach(async () => {
  await clearAssociations();
  events = reportEvents();
  vi.spyOn(warcraftLogsApiClient, "isConfigured").mockReturnValue(true);
  metadataSpy = vi
    .spyOn(warcraftLogsApiClient, "fetchReportMetadata")
    .mockImplementation(async (code) => ({
      status: "SUCCESS",
      report: code === SECOND ? metadata({ code: SECOND, startTime: REPORT_START + SECOND_SKEW_MS }) : metadata(),
    }));
  eventsSpy = vi.spyOn(warcraftLogsApiClient, "fetchReportConsumableEvents").mockImplementation(async (input) => fakeEvents(input));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("same WCL report, two consecutive Runs with identical content", () => {
  it("assigns fights 1–8 to Run A and 9–16 to Run B; the in-between fight needs review", async () => {
    const a = await attachAndAnalyze(aelira, RUN_A);
    const b = await attachAndAnalyze(aelira, RUN_B);
    expect(a.attached).toEqual({ status: "ATTACHED", summary: { assigned: 8, needsReview: 1, ignored: 0 } });
    expect(b.attached).toEqual({ status: "ATTACHED", summary: { assigned: 8, needsReview: 1, ignored: 0 } });

    const statusA = await fightStatuses(RUN_A);
    const statusB = await fightStatuses(RUN_B);
    expect(Object.keys(statusA).map(Number).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 17]);
    expect(Object.keys(statusB).map(Number).sort((x, y) => x - y)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(statusA[17]).toBe("NEEDS_REVIEW");
    expect(statusB[17]).toBe("NEEDS_REVIEW");
    expect(statusA[7]).toBe("ASSIGNED"); // the wipe belongs to Run A
  });

  it("each Run's audit contains only its own fights — no potions, flasks, deaths or Healthstones cross over", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    await attachAndAnalyze(aelira, RUN_B);

    // WCL was asked for the Run's own fights only.
    expect(eventsSpy.mock.calls[0]![0].fightIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(eventsSpy.mock.calls[1]![0].fightIds).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);

    const viewA = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    const viewB = await runConsumableAuditService.getAuditView(aelira, RUN_B);
    expect(viewA.snapshot!.fights.map((row) => row.wclFightId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(viewB.snapshot!.fights.map((row) => row.wclFightId)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);

    const kaelA = viewA.snapshot!.players.find((p) => p.displayName === "Kael Stormhowl")!;
    const kaelB = viewB.snapshot!.players.find((p) => p.displayName === "Kael Stormhowl")!;
    // Run A: 8 fights, one pot each, Healthstone in fight 3, the wipe death in fight 7.
    expect(kaelA.fightsParticipated).toBe(8);
    expect(kaelA.flask).toMatchObject({ fightsChecked: 8, fightsWithFlask: 8 });
    expect(kaelA.combatPotion.uses).toHaveLength(8);
    expect(kaelA.healthstone.uses.map((use) => use.fight.wclFightId)).toEqual([3]);
    expect(kaelA.healingPotion.uses).toEqual([]); // B's Healing Potion never leaks in
    expect(kaelA.deaths.map((death) => [death.fight.wclFightId, death.fight.kill])).toEqual([[7, false]]);
    // Run B: its own death, with the Healing Potion 2s before it; no Healthstone from A.
    expect(kaelB.fightsParticipated).toBe(8);
    expect(kaelB.combatPotion.uses).toHaveLength(8);
    expect(kaelB.healthstone.uses).toEqual([]);
    expect(kaelB.deaths).toHaveLength(1);
    expect(kaelB.deaths[0]!.fight.wclFightId).toBe(12);
    expect(kaelB.deaths[0]!.healingPotion).toMatchObject({ status: "USED", atFightMs: 118_000 });

    // Persisted observations of A reference only A's snapshot fights.
    const auditA = (await runConsumableAuditRepository.findByRunId(RUN_A))!;
    const snapshotA = await runConsumableAuditRepository.findSnapshot(auditA.id);
    const fightIdsA = new Set(snapshotA.fights.map((row) => row.id));
    expect(snapshotA.players.flatMap((p) => p.observations).every((row) => fightIdsA.has(row.fightId))).toBe(true);
  });

  it("reuses the shared report metadata instead of re-fetching it for the second Run", async () => {
    const now = later();
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, now);
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_B, reportCode: REPORT }, new Date(now.getTime() + MIN));
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(await orm.WarcraftLogsReport.where({ code: REPORT }).all()).toHaveLength(1);
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(view.logs.reports[0]).toMatchObject({ code: REPORT, assigned: 8, needsReview: 1, sharedWithRuns: 1 });
  });
});

describe("fight uniqueness and manual reassignment", () => {
  it("a report fight is ASSIGNED to at most one Run; assigning elsewhere moves it", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    await attachAndAnalyze(aelira, RUN_B);
    const rowA = (await runWarcraftLogsRepository.listRunFights(RUN_A)).find((row) => row.wclFightId === 17)!;
    const rowB = (await runWarcraftLogsRepository.listRunFights(RUN_B)).find((row) => row.wclFightId === 17)!;

    await runWarcraftLogsService.decideFight(thorne, { runId: RUN_A, fightId: rowA.id, assign: true }, later());
    expect((await fightStatuses(RUN_A))[17]).toBe("ASSIGNED");
    expect((await fightStatuses(RUN_B))[17]).toBe("NEEDS_REVIEW");

    await runWarcraftLogsService.decideFight(aelira, { runId: RUN_B, fightId: rowB.id, assign: true }, later());
    expect((await fightStatuses(RUN_A))[17]).toBe("IGNORED");
    expect((await fightStatuses(RUN_B))[17]).toBe("ASSIGNED");
    const assigned = await orm.RunWarcraftLogsFight.where({ reportId: rowA.reportId, wclFightId: 17, status: "ASSIGNED" }).all();
    expect(assigned).toHaveLength(1);

    // The database itself refuses a second ASSIGNED row for the same report fight.
    await expect(
      orm.RunWarcraftLogsFight.where({ id: rowA.id }).update({ status: "ASSIGNED" }),
    ).rejects.toThrow();

    // Audit B is now stale until re-analyzed; re-analysis includes fight 17.
    expect((await runConsumableAuditService.getAuditView(aelira, RUN_B)).stale).toBe(true);
    await runConsumableAuditService.analyze(aelira, { runId: RUN_B }, later);
    const viewB = await runConsumableAuditService.getAuditView(aelira, RUN_B);
    expect(viewB.stale).toBe(false);
    expect(viewB.snapshot!.fights.map((row) => row.wclFightId)).toContain(17);
  });

  it("manual decisions survive re-scans and re-attaching", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    const row = (await runWarcraftLogsRepository.listRunFights(RUN_A)).find((r) => r.wclFightId === 3)!;
    await runWarcraftLogsService.decideFight(aelira, { runId: RUN_A, fightId: row.id, assign: false }, later());
    await runWarcraftLogsService.rescan(aelira, { runId: RUN_A }, later());
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, later());
    const after = (await runWarcraftLogsRepository.listRunFights(RUN_A)).find((r) => r.wclFightId === 3)!;
    expect(after).toMatchObject({ status: "IGNORED", decision: "MANUAL" });
  });
});

describe("authorization", () => {
  it("ADMIN and the Run's RAID_LEAD can attach and reassign", async () => {
    await expect(runWarcraftLogsService.attachReport(thorne, { runId: RUN_A, reportCode: REPORT }, later())).resolves.toMatchObject({
      status: "ATTACHED",
    });
    await expect(runWarcraftLogsService.attachReport(aelira, { runId: RUN_B, reportCode: REPORT }, later())).resolves.toMatchObject({
      status: "ATTACHED",
    });
    const row = (await runWarcraftLogsRepository.listRunFights(RUN_A)).find((r) => r.wclFightId === 17)!;
    await runWarcraftLogsService.decideFight(thorne, { runId: RUN_A, fightId: row.id, assign: true }, later());
    expect((await fightStatuses(RUN_A))[17]).toBe("ASSIGNED");
  });

  it("a RAID_LEAD cannot touch another lead's Run, nor pull a fight away from it", async () => {
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, later());
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_B, reportCode: REPORT }, later());
    const rowA = (await runWarcraftLogsRepository.listRunFights(RUN_A)).find((r) => r.wclFightId === 17)!;
    const rowB = (await runWarcraftLogsRepository.listRunFights(RUN_B)).find((r) => r.wclFightId === 17)!;
    metadataSpy.mockClear();

    for (const call of [
      () => runWarcraftLogsService.attachReport(otherLead, { runId: RUN_A, reportCode: REPORT }, later()),
      () => runWarcraftLogsService.rescan(otherLead, { runId: RUN_A }, later()),
      () => runWarcraftLogsService.detachReport(otherLead, { runId: RUN_A, reportCode: REPORT }),
      () => runWarcraftLogsService.decideFight(otherLead, { runId: RUN_A, fightId: rowA.id, assign: true }, later()),
      () => runConsumableAuditService.analyze(otherLead, { runId: RUN_A }, later),
      () => runConsumableAuditService.getAuditView(otherLead, RUN_A),
    ]) {
      await expectDomainCode(call(), "NOT_AUTHORIZED");
    }

    // Run B handed to another lead: Thorne may not move B's fight into A.
    await runWarcraftLogsService.decideFight(aelira, { runId: RUN_B, fightId: rowB.id, assign: true }, later());
    await orm.Run.where({ id: RUN_B }).update({ raidLeadId: OTHER_LEAD_ID });
    try {
      await expectDomainCode(
        runWarcraftLogsService.decideFight(thorne, { runId: RUN_A, fightId: rowA.id, assign: true }, later()),
        "NOT_AUTHORIZED",
      );
      expect((await fightStatuses(RUN_B))[17]).toBe("ASSIGNED");
    } finally {
      await orm.Run.where({ id: RUN_B }).update({ raidLeadId: thorne.id });
    }
    expect(metadataSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
  });

  it("a USER can neither read nor mutate associations or the audit, and causes zero WCL traffic", async () => {
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, later());
    const row = (await runWarcraftLogsRepository.listRunFights(RUN_A))[0]!;
    metadataSpy.mockClear();
    const before = await orm.RunWarcraftLogsFight.where({ runId: RUN_A }).all();

    for (const call of [
      () => runWarcraftLogsService.attachReport(kael, { runId: RUN_B, reportCode: REPORT }, later()),
      () => runWarcraftLogsService.rescan(kael, { runId: RUN_A }, later()),
      () => runWarcraftLogsService.detachReport(kael, { runId: RUN_A, reportCode: REPORT }),
      () => runWarcraftLogsService.decideFight(kael, { runId: RUN_A, fightId: row.id, assign: false }, later()),
      () => runConsumableAuditService.analyze(kael, { runId: RUN_A }, later),
      () => runConsumableAuditService.getAuditView(kael, RUN_A),
    ]) {
      await expectDomainCode(call(), "NOT_AUTHORIZED");
    }
    expect(metadataSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
    expect(await orm.RunWarcraftLogsReport.where({ runId: RUN_B }).all()).toHaveLength(0);
    expect(await orm.RunWarcraftLogsFight.where({ runId: RUN_A }).all()).toEqual(before);

    const detail = await runDetailService.getRunDetail(kael, RUN_A);
    expect(detail.consumables).toBeNull();
    const serialized = JSON.stringify(detail);
    for (const leak of [REPORT, "combatPotion", "healthstone", "NEEDS_REVIEW", "rosterMatched", "Two back-to-back"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("run detail for managers is database-only (no WCL calls)", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    metadataSpy.mockClear();
    eventsSpy.mockClear();
    const detail = await runDetailService.getRunDetail(thorne, RUN_A);
    expect(detail.consumables?.logs.reports[0]?.code).toBe(REPORT);
    expect(detail.consumables?.snapshot?.fights).toHaveLength(8);
    expect(metadataSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
  });

  it("linking and analysis are only for COMPLETED runs", async () => {
    await expectDomainCode(
      runWarcraftLogsService.attachReport(aelira, { runId: IN_PROGRESS_RUN, reportCode: REPORT }, later()),
      "CONSUMABLE_AUDIT_RUN_NOT_COMPLETED",
    );
    expect((await runDetailService.getRunDetail(aelira, IN_PROGRESS_RUN)).consumables).toBeNull();
    expect(metadataSpy).not.toHaveBeenCalled();
  });
});

describe("idempotency and failure safety", () => {
  it("re-attaching, re-scanning and re-analyzing never duplicate rows", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    const counts = async () => {
      const audit = (await runConsumableAuditRepository.findByRunId(RUN_A))!;
      const snapshot = await runConsumableAuditRepository.findSnapshot(audit.id);
      return {
        associations: (await orm.RunWarcraftLogsReport.where({ runId: RUN_A }).all()).length,
        fights: (await orm.RunWarcraftLogsFight.where({ runId: RUN_A }).all()).length,
        auditFights: snapshot.fights.length,
        observations: snapshot.players.reduce((sum, p) => sum + p.observations.length, 0),
      };
    };
    const first = await counts();
    await attachAndAnalyze(aelira, RUN_A);
    expect(await counts()).toEqual(first);
    await runWarcraftLogsService.rescan(aelira, { runId: RUN_A }, later());
    await runConsumableAuditService.analyze(aelira, { runId: RUN_A }, later);
    expect(await counts()).toEqual(first);
    expect(first).toMatchObject({ associations: 1, fights: 9, auditFights: 8 });
  });

  it("a failed re-scan or re-analysis keeps associations and the last snapshot", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    const fightsBefore = await runWarcraftLogsRepository.listRunFights(RUN_A);
    const auditBefore = await runConsumableAuditService.getAuditView(aelira, RUN_A);

    metadataSpy.mockImplementation(async () => ({ status: "TEMPORARY_FAILURE", message: "timeout" }));
    await expect(runWarcraftLogsService.rescan(aelira, { runId: RUN_A }, later())).resolves.toEqual({
      status: "FAILED",
      failure: "WCL_UNAVAILABLE",
    });
    expect(await runWarcraftLogsRepository.listRunFights(RUN_A)).toEqual(fightsBefore);

    eventsSpy.mockImplementation(async () => ({ status: "TEMPORARY_FAILURE", message: "timeout" }));
    await expect(runConsumableAuditService.analyze(aelira, { runId: RUN_A }, later)).resolves.toEqual({
      status: "FAILED",
      failure: "WCL_UNAVAILABLE",
    });
    const after = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(after.lastFailure).toBe("WCL_UNAVAILABLE");
    expect(after.snapshot).toEqual(auditBefore.snapshot);
  });

  it("an unknown/private report attaches nothing", async () => {
    metadataSpy.mockImplementation(async () => ({ status: "NOT_FOUND" }));
    await expect(runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, later())).resolves.toEqual({
      status: "FAILED",
      failure: "REPORT_NOT_FOUND",
    });
    expect(await orm.RunWarcraftLogsReport.where({ runId: RUN_A }).all()).toHaveLength(0);
  });

  it("rate-limits WCL-triggering actions per run", async () => {
    const now = later();
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, now);
    await expectDomainCode(
      runWarcraftLogsService.rescan(aelira, { runId: RUN_A }, new Date(now.getTime() + 5_000)),
      "CONSUMABLE_AUDIT_REFRESH_COOLDOWN",
    );
  });
});

describe("detach and shared report lifetime", () => {
  it("detaching removes only that Run's association, fights and audit facts; the report lives while shared", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    await attachAndAnalyze(aelira, RUN_B);

    await runWarcraftLogsService.detachReport(thorne, { runId: RUN_A, reportCode: REPORT });
    expect(await orm.RunWarcraftLogsFight.where({ runId: RUN_A }).all()).toHaveLength(0);
    expect((await runConsumableAuditService.getAuditView(aelira, RUN_A)).snapshot?.fights ?? []).toHaveLength(0);
    expect(await orm.WarcraftLogsReport.where({ code: REPORT }).all()).toHaveLength(1);
    expect(Object.values(await fightStatuses(RUN_B)).filter((s) => s === "ASSIGNED")).toHaveLength(8);

    await runWarcraftLogsService.detachReport(aelira, { runId: RUN_B, reportCode: REPORT });
    expect(await orm.WarcraftLogsReport.where({ code: REPORT }).all()).toHaveLength(0);
  });
});

describe("runs without a recorded lifecycle window", () => {
  it("puts every matching fight into review instead of guessing, and analyzes nothing until decided", async () => {
    const attached = await runWarcraftLogsService.attachReport(aelira, { runId: LEGACY_RUN, reportCode: REPORT }, later());
    expect(attached).toMatchObject({ status: "ATTACHED", summary: { assigned: 0, needsReview: 17 } });
    const rows = await runWarcraftLogsRepository.listRunFights(LEGACY_RUN);
    expect(rows.every((row) => row.status === "NEEDS_REVIEW" && row.reasons.includes("RUN_WINDOW_UNKNOWN"))).toBe(true);
    await expect(runConsumableAuditService.analyze(aelira, { runId: LEGACY_RUN }, later)).resolves.toEqual({
      status: "FAILED",
      failure: "NO_RELEVANT_FIGHTS",
    });
  });
});

describe("consumable facts per assigned fight", () => {
  it("evaluates flask, potions and death context from the Run's own fights", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    const second = view.snapshot!.players.find(
      (p) => identityKey(p.characterName!, p.characterRealm!) === identityKey(inLogA[1]!.characterName, inLogA[1]!.characterRealm),
    )!;
    expect(second.flask).toMatchObject({ status: "WARNING", fightsWithFlask: 7, fightsChecked: 8 });
    expect(second.deaths.map((death) => death.fight.wclFightId)).toEqual([2]);
    expect(second.deaths[0]!.healingPotion).toEqual({ status: "NOT_USED" });
    expect(second.deaths[0]!.healthstone).toEqual({ status: "NOT_USED" }); // a Warlock is in the fight
    const missing = view.snapshot!.players.find(
      (p) => p.characterName === rosterA.at(-1)!.characterName && p.displayName === rosterA.at(-1)!.displayName,
    )!;
    expect(missing).toMatchObject({ matchStatus: "NOT_IN_LOG", hasLogData: false, warningCount: 0 });
  });

  it("lists an external booster as log data unavailable, never a failure", async () => {
    const now = new Date().toISOString();
    await orm.RunExternalBooster.create({
      id: EXTERNAL_ID,
      rosterId: SETTLEMENT_ROSTER_ID,
      name: rosterA[0]!.characterName, // same text as a real actor — still never matched
      wowClass: "MAGE",
      participationType: "BOOSTER",
      role: "DPS",
      createdAt: now,
      updatedAt: now,
    });
    try {
      await attachAndAnalyze(aelira, RUN_A);
      const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
      expect(view.snapshot!.players.find((p) => p.isExternal)).toMatchObject({
        matchStatus: "NO_CHARACTER_IDENTITY",
        hasLogData: false,
        warningCount: 0,
      });
    } finally {
      await orm.RunExternalBooster.where({ id: EXTERNAL_ID }).deleteAndCount();
    }
  });

  it("shows and judges the role PLAYED in the log, not the roster role; an older snapshot asks for re-analysis", async () => {
    // A booster whose class has a spec of a different role than their roster role
    // (e.g. roster Healer, played Shadow) — found from the seeded data, not assumed.
    const pick = inLogA
      .map((p) => {
        const spec = knownSpecializationIds()
          .map((id) => ({ id, spec: specializationById(id)! }))
          .find(({ spec }) => spec.wowClass === p.wowClass && spec.role !== p.role);
        return spec && p.role ? { p, spec } : null;
      })
      .find(Boolean);
    expect(pick).toBeTruthy();
    const { p, spec } = pick!;
    const actor = actorIdByKey.get(identityKey(p.characterName, p.characterRealm))!;
    events = { ...events, combatants: events.combatants.map((row) => (row.sourceId === actor ? { ...row, specId: spec.id } : row)) };

    await attachAndAnalyze(aelira, RUN_A);
    const find = (view: Awaited<ReturnType<typeof runConsumableAuditService.getAuditView>>) =>
      view.snapshot!.players.find((row) => identityKey(row.characterName!, row.characterRealm!) === identityKey(p.characterName, p.characterRealm))!;
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(view.factsOutdated).toBe(false);
    const played = find(view);
    expect(played).toMatchObject({ rosterRole: p.role, playedRole: spec.spec.role });
    expect(played.combatPotion.killFightsChecked).toBeGreaterThan(0); // judged with the played role
    // Everyone else had no spec in the fake log → UNKNOWN, never a potion warning.
    const other = view.snapshot!.players.find((row) => row.hasLogData && row !== played)!;
    expect(other.playedRole).toBe("UNKNOWN");
    expect(other.combatPotion.status).toBe("UNKNOWN");

    const audit = (await orm.RunConsumableAudit.where({ runId: RUN_A }).first()) as { id: string; factsVersion: number };
    expect(audit.factsVersion).toBe(3);
    // The roster role is untouched: attendance / roster rows are never rewritten from the log.
    expect((await runConsumableAuditRepository.listParticipants(RUN_A)).find((row) => row.source === "ATTENDANCE" && row.characterName === p.characterName)?.role).toBe(p.role);

    // A snapshot from before played roles: never reinterpreted — flagged for re-analysis.
    await orm.RunConsumableAudit.where({ id: audit.id }).update({ factsVersion: 1 });
    const playerIds = ((await orm.RunConsumableAuditPlayer.where({ auditId: audit.id }).all()) as Array<{ id: string }>).map((row) => row.id);
    await orm.RunConsumableAuditObservation.where((row) => row.playerId.in(playerIds)).updateAll({ specId: null });
    const outdated = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(outdated.factsOutdated).toBe(true);
    expect(find(outdated)).toMatchObject({ playedRole: "UNKNOWN", rosterRole: p.role });
    expect(find(outdated).combatPotion.status).toBe("UNKNOWN");
  });

  it("survival: deaths know kill/wipe and the player's own defensive — same single events request", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    expect(eventsSpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy.mock.calls[0]![0].castSpellIds).toEqual(expect.arrayContaining([1236616, 642, 403876]));
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(view).toMatchObject({ factsOutdated: false, factsVersion: 3 });
    const dying = view.snapshot!.players.find(
      (p) => identityKey(p.characterName!, p.characterRealm!) === identityKey(inLogA[1]!.characterName, inLogA[1]!.characterRealm),
    )!;
    expect(dying.deaths[0]).toMatchObject({
      fightResult: "KILL",
      defensiveStatus: "USED",
      personalDefensives: [{ spellName: "Divine Shield", msBeforeDeath: 10_000 }],
    });
    const kael = view.snapshot!.players.find((p) => p.displayName === "Kael Stormhowl")!;
    expect(kael.deaths.map((d) => [d.fight.wclFightId, d.fightResult, d.defensiveStatus])).toEqual([[7, "WIPE", "NOT_DETECTED"]]);
    expect(kael).toMatchObject({ deathsInWipes: 1, deathsInKills: 0 });

    // A snapshot from before defensive tracking: shown as unknown and flagged for re-analysis, never "not detected".
    await orm.RunConsumableAudit.where({ runId: RUN_A }).update({ factsVersion: 2 });
    const old = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(old).toMatchObject({ factsOutdated: true, factsVersion: 2 });
    const oldKael = old.snapshot!.players.find((p) => p.displayName === "Kael Stormhowl")!;
    expect(oldKael.deaths[0]).toMatchObject({ defensiveStatus: "UNKNOWN", personalDefensives: [] });
    expect(oldKael.warningCount).toBe(kael.warningCount);
  });

  it("uses one metadata request per attach and one batched events request per report", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("two reports of the same raid (two loggers) linked to one Run", () => {
  async function attachBoth() {
    const now = later();
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: REPORT }, now);
    await runWarcraftLogsService.attachReport(aelira, { runId: RUN_A, reportCode: SECOND }, new Date(now.getTime() + 5 * MIN));
  }
  const analyze = () => runConsumableAuditService.analyze(aelira, { runId: RUN_A }, () => later(), { skipCooldown: true });
  const summaryOf = (view: Awaited<ReturnType<typeof runConsumableAuditService.getAuditView>>) => ({
    summary: view.snapshot!.summary,
    players: view.snapshot!.players.map((p) => [p.displayName, p.warningCount, p.deaths.length, p.combatPotion.uses.length, p.flask.fightsChecked]),
  });

  it("the audit holds every real pull once — identical to one report — and is fresh right away", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    const single = summaryOf(await runConsumableAuditService.getAuditView(aelira, RUN_A));
    await clearAssociations();

    await attachBoth();
    expect((await fightStatuses(RUN_A))).toBeTruthy();
    eventsSpy.mockClear();
    expect(await analyze()).toMatchObject({ status: "ANALYZED" });
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(summaryOf(view)).toEqual(single); // no doubled fights, deaths, uses, warnings
    expect(new Set(view.snapshot!.fights.map((fight) => fight.reportCode))).toEqual(new Set([REPORT])); // linked first
    expect(eventsSpy).toHaveBeenCalledTimes(1); // the second logger's copy is not fetched
    expect(view.stale).toBe(false);
    // Both reports stay visible; the overlap is explained, not hidden.
    expect(view.logs.reports.map((row) => [row.code, row.assigned, row.overlappingFights])).toEqual([
      [REPORT, 8, 8],
      [SECOND, 8, 8],
    ]);

    // Deaths: Kael's wipe death in fight 7 is listed once, not twice.
    const kael = view.snapshot!.players.find((p) => p.displayName === "Kael Stormhowl")!;
    expect(kael.deaths.map((death) => death.fight.wclFightId)).toEqual([7]);
    // 16. The defensive before a death is counted once with two loggers.
    const dying = view.snapshot!.players.find(
      (p) => identityKey(p.characterName!, p.characterRealm!) === identityKey(inLogA[1]!.characterName, inLogA[1]!.characterRealm),
    )!;
    expect(dying.deaths).toHaveLength(1);
    expect(dying.deaths[0]!.personalDefensives).toHaveLength(1);
  });

  it("12. a copy without CombatantInfo is replaced by the other logger's copy of the same pulls", async () => {
    await attachBoth();
    const full = fakeEvents;
    eventsSpy.mockImplementation(async (input) => {
      const result = full(input);
      return input.code === REPORT ? { ...result, events: { ...result.events, combatants: [] } } : result;
    });
    expect(await analyze()).toMatchObject({ status: "ANALYZED", fights: 8 });
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(new Set(view.snapshot!.fights.map((fight) => fight.reportCode))).toEqual(new Set([SECOND]));
    expect(eventsSpy).toHaveBeenCalledTimes(2); // canonical report, then the duplicates of the weak pulls
    expect(eventsSpy.mock.calls.map(([input]) => [input.code, input.fightIds])).toEqual([
      [REPORT, [1, 2, 3, 4, 5, 6, 7, 8]],
      [SECOND, [1, 2, 3, 4, 5, 6, 7, 8]],
    ]);
    const second = view.snapshot!.players.find((p) => p.hasLogData)!;
    expect(second.flask.fightsChecked).toBeGreaterThan(0); // snapshots available again
    expect(view.stale).toBe(false);
  });

  it("partial CombatantInfo: the kept copy misses one booster in ONE pull → only that pull is read from the other logger", async () => {
    await attachBoth();
    const p = inLogA.find((row) => row.wowClass && row.role && row !== inLogA[1])!;
    const spec = knownSpecializationIds().map((id) => ({ id, spec: specializationById(id)! })).find(({ spec }) => spec.wowClass === p.wowClass)!;
    const actor = actorIdByKey.get(identityKey(p.characterName, p.characterRealm))!;
    events = { ...events, combatants: events.combatants.map((row) => (row.sourceId === actor ? { ...row, specId: spec.id } : row)) };
    const full = fakeEvents;
    eventsSpy.mockImplementation(async (input) => {
      const result = full(input);
      if (input.code !== REPORT) return result;
      // The first logger lost this booster's pull snapshot in fight 2 only (13 of 14 kind of gap).
      const combatants = result.events.combatants.filter((row) => !(row.sourceId === actor && row.fight === 2));
      return { ...result, events: { ...result.events, combatants } };
    });

    expect(await analyze()).toMatchObject({ status: "ANALYZED", fights: 8 });
    // Pulls 1 and 3–8 were complete: only pull 2 is requested from the second logger.
    expect(eventsSpy.mock.calls.map(([input]) => [input.code, input.fightIds])).toEqual([
      [REPORT, [1, 2, 3, 4, 5, 6, 7, 8]],
      [SECOND, [2]],
    ]);
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(view.snapshot!.fights.map((fight) => [fight.wclFightId, fight.reportCode])).toEqual([
      [1, REPORT],
      [2, SECOND],
      [3, REPORT],
      [4, REPORT],
      [5, REPORT],
      [6, REPORT],
      [7, REPORT],
      [8, REPORT],
    ]);
    const row = view.snapshot!.players.find((x) => identityKey(x.characterName!, x.characterRealm!) === identityKey(p.characterName, p.characterRealm))!;
    expect(row.flask).toMatchObject({ fightsChecked: 8, unknown: [] }); // fight 2 no longer unknown
    expect(row.playedRoleByFight.map((entry) => entry.role)).toEqual(Array(8).fill(spec.spec.role));
    // Gear rides on the same CombatantInfo row as spec and auras, so it follows the kept copy (this fixture logs no gear).
    expect(view.stale).toBe(false);
  });

  it("complete copies are never re-read from the other logger", async () => {
    await attachBoth();
    await analyze();
    expect(eventsSpy.mock.calls.map(([input]) => input.code)).toEqual([REPORT]);
  });

  it("11. played roles come from the kept copy (specialization per fight)", async () => {
    await attachBoth();
    const p = inLogA.find((row) => row.wowClass && row.role)!;
    const spec = knownSpecializationIds().map((id) => ({ id, spec: specializationById(id)! })).find(({ spec }) => spec.wowClass === p.wowClass)!;
    const actor = actorIdByKey.get(identityKey(p.characterName, p.characterRealm))!;
    events = { ...events, combatants: events.combatants.map((row) => (row.sourceId === actor ? { ...row, specId: spec.id } : row)) };
    await analyze();
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    const row = view.snapshot!.players.find((x) => identityKey(x.characterName!, x.characterRealm!) === identityKey(p.characterName, p.characterRealm))!;
    expect(row.playedRole).toBe(spec.spec.role);
    expect(row.playedRoleByFight).toHaveLength(8); // each pull once
  });

  it("14. the automatic audit produces the same unique snapshot as a manual analysis", async () => {
    await attachBoth();
    await analyze();
    const manual = summaryOf(await runConsumableAuditService.getAuditView(aelira, RUN_A));
    const run = (await runConsumableAuditRepository.findRunContext(RUN_A))!;
    expect(await analyzeRun(run, null, () => later(), { skipCooldown: true, auto: true })).toMatchObject({ status: "ANALYZED", fights: 8 });
    const auto = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(summaryOf(auto)).toEqual(manual);
    expect(auto.stale).toBe(false);
  });

  it("a report covering other pulls still adds them (partial overlap is a union, not one report)", async () => {
    await attachBoth();
    // The second logger only has fights 5–8 of Run A.
    const partial = metadata({ code: SECOND, startTime: REPORT_START + SECOND_SKEW_MS });
    await orm.RunWarcraftLogsFight.where({ runId: RUN_A })
      .include("report")
      .all()
      .then(async (rows) => {
        for (const row of rows as unknown as Array<{ id: string; wclFightId: number; report: { code: string } }>) {
          if (row.report.code === SECOND && row.wclFightId < 5) {
            await orm.RunWarcraftLogsFight.where({ id: row.id }).update({ status: "IGNORED" });
          }
        }
      });
    expect(partial.fights.length).toBeGreaterThan(0);
    await analyze();
    const view = await runConsumableAuditService.getAuditView(aelira, RUN_A);
    expect(view.snapshot!.fights).toHaveLength(8);
    expect(view.logs.reports.map((row) => [row.code, row.assigned, row.overlappingFights])).toEqual([
      [REPORT, 8, 4],
      [SECOND, 4, 4],
    ]);
    expect(view.stale).toBe(false);
  });
});

describe("run deletion cascades", () => {
  it("deleting a Run removes its associations, fight rows and audit, but not another Run's use of the report", async () => {
    await attachAndAnalyze(aelira, RUN_A);
    await attachAndAnalyze(aelira, RUN_B);
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      // Attendance first (payout entries restrict it elsewhere); then the Run itself.
      await client.query('DELETE FROM run_attendance WHERE "runId" = $1', [RUN_A]);
      await client.query("DELETE FROM run WHERE id = $1", [RUN_A]);
      const count = async (sql: string, params: unknown[]) => Number((await client.query(sql, params)).rows[0].n);
      expect(await count('SELECT count(*) n FROM run_warcraft_logs_report WHERE "runId" = $1', [RUN_A])).toBe(0);
      expect(await count('SELECT count(*) n FROM run_warcraft_logs_fight WHERE "runId" = $1', [RUN_A])).toBe(0);
      expect(await count('SELECT count(*) n FROM run_consumable_audit WHERE "runId" = $1', [RUN_A])).toBe(0);
      expect(await count('SELECT count(*) n FROM run_warcraft_logs_fight WHERE "runId" = $1 AND status = $2', [RUN_B, "ASSIGNED"])).toBe(8);
      expect(await count("SELECT count(*) n FROM warcraft_logs_report WHERE code = $1", [REPORT])).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
