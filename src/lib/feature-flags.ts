/**
 * Server-side feature switches. Off unless the environment explicitly enables
 * them, so an unfinished feature is never live by accident.
 */

/**
 * Boss-specific roster exceptions (another Character / role for some planned
 * bosses): Roster Builder, Discord, DMs, Start checks and consumables audit.
 * While this is off the roster API rejects any boss exception input and
 * stored exceptions are inert everywhere (lib/roster-boss-plan
 * activeBossExceptions), so Runs behave exactly as their default roster.
 * Enable with ROSTER_BOSS_EXCEPTIONS_ENABLED=true; switching it off again is safe.
 */
export function isRosterBossExceptionsEnabled(): boolean {
  return process.env.ROSTER_BOSS_EXCEPTIONS_ENABLED === "true";
}
