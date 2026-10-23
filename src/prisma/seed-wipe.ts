import { orm } from "@/lib/prisma";

/**
 * Empties every table the seed fills, child rows before the rows they
 * reference (order follows the FK delete rules — RESTRICT parents only after
 * their children; CASCADE children go with their parent). Safe on an empty
 * database and repeatable. Only reached through `npm run db:seed` (dev seed,
 * and `npm run test:db:reset` against TEST_DATABASE_URL) — never from the app.
 */
export async function wipeSeedDatabase(): Promise<void> {
  // Strike.userId/createdById are Restrict against User; must go before Users.
  for (const row of await orm.Strike.select("id").all()) {
    await orm.Strike.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunAttendance.select("id").all()) {
    await orm.RunAttendance.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunRosterEntry.select("id").all()) {
    await orm.RunRosterEntry.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunRoster.select("id").all()) {
    await orm.RunRoster.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunSignupRole.select("id").all()) {
    await orm.RunSignupRole.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunSignup.select("id").all()) {
    await orm.RunSignup.where({ id: row.id }).delete();
  }
  for (const row of await orm.RunRaidContent.select("id").all()) {
    await orm.RunRaidContent.where({ id: row.id }).delete();
  }
  for (const row of await orm.CharacterRaidLockout.select("id").all()) {
    await orm.CharacterRaidLockout.where({ id: row.id }).delete();
  }
  for (const row of await orm.BoosterAccess.select("id").all()) {
    await orm.BoosterAccess.where({ id: row.id }).delete();
  }
  for (const row of await orm.ActivityEvent.select("id").all()) {
    await orm.ActivityEvent.where({ id: row.id }).delete();
  }
  // Shared Warcraft Logs report cache is not owned by any Run; its Run
  // associations/fight rows cascade from it (and from the Runs below).
  for (const row of await orm.WarcraftLogsReport.select("id").all()) {
    await orm.WarcraftLogsReport.where({ id: row.id }).delete();
  }
  // Community Schedule rows reference Runs, Run Setups and Users with RESTRICT
  // (community_schedule_run.runId → run, community_schedule_slot.runTemplateId →
  // run_template, community_schedule_slot.raidLeadId / createdById / updatedById
  // → user), so they go first: occurrence links (ATTACHED and MATERIALIZED
  // alike — this is fixture cleanup, not the product's Draft retirement), then
  // the slots, active or not.
  for (const row of await orm.CommunityScheduleRun.select("id").all()) {
    await orm.CommunityScheduleRun.where({ id: row.id }).delete();
  }
  for (const row of await orm.CommunityScheduleSlot.select("id").all()) {
    await orm.CommunityScheduleSlot.where({ id: row.id }).delete();
  }
  for (const row of await orm.Run.select("id").all()) {
    await orm.Run.where({ id: row.id }).delete();
  }
  // Templates reference Raid + User (Restrict); clear before both.
  for (const row of await orm.RunTemplate.select("id").all()) {
    await orm.RunTemplate.where({ id: row.id }).delete();
  }
  // Product contents reference Raid (Restrict); clear products before raids.
  for (const row of await orm.ProductRaidContent.select("id").all()) {
    await orm.ProductRaidContent.where({ id: row.id }).delete();
  }
  for (const row of await orm.Product.select("id").all()) {
    await orm.Product.where({ id: row.id }).delete();
  }
  for (const row of await orm.RaidBoss.select("id").all()) {
    await orm.RaidBoss.where({ id: row.id }).delete();
  }
  for (const row of await orm.Character.select("id").all()) {
    await orm.Character.where({ id: row.id }).delete();
  }
  for (const row of await orm.Session.select("id").all()) {
    await orm.Session.where({ id: row.id }).delete();
  }
  for (const row of await orm.Account.select("id").all()) {
    await orm.Account.where({ id: row.id }).delete();
  }
  for (const row of await orm.Verification.select("id").all()) {
    await orm.Verification.where({ id: row.id }).delete();
  }
  for (const row of await orm.Raid.select("id").all()) {
    await orm.Raid.where({ id: row.id }).delete();
  }
  for (const row of await orm.User.select("id").all()) {
    await orm.User.where({ id: row.id }).delete();
  }
}
