/**
 * Server-side feature switches. Off unless the environment explicitly enables
 * them, so an unfinished feature is never live by accident.
 */

/**
 * Boss-specific roster exceptions (another Character / role for some planned
 * bosses). Persistence and validation ship ahead of the UI; while this is off
 * the roster API rejects any boss exception input, so Runs behave exactly as
 * before. Enable with ROSTER_BOSS_EXCEPTIONS_ENABLED=true once the UI and the
 * Discord / audit integration are complete.
 */
export function isRosterBossExceptionsEnabled(): boolean {
  return process.env.ROSTER_BOSS_EXCEPTIONS_ENABLED === "true";
}
