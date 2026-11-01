/**
 * Server-side feature switches. Off unless the environment explicitly enables
 * them, so an unfinished feature is never live by accident.
 */

/**
 * Boss-specific roster exceptions (another Character / role for some planned
 * bosses): Roster Builder, Discord, DMs, Start checks and consumables audit.
 * The switch gates authoring only: while it is off the roster API rejects
 * any boss exception input and the Roster Builder hides the editor, so no
 * plan can be created or changed. Exceptions already stored keep applying
 * everywhere (validation, unpublished state, reservations, Discord, DMs,
 * Start checks, consumables audit) — what players were told is what is
 * checked — and Runs without exceptions behave exactly as before. A plan
 * leaves only through the roster (its slot or alternate leaves) or, with the
 * switch on again, the editor. Enable with ROSTER_BOSS_EXCEPTIONS_ENABLED=true.
 */
export function isRosterBossExceptionsEnabled(): boolean {
  return process.env.ROSTER_BOSS_EXCEPTIONS_ENABLED === "true";
}
