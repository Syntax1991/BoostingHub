/**
 * Create Run form opt-in defaults.
 *
 * Recurring Schedule and Discord role ping are independent, explicit opt-ins.
 * Neither is remembered across submissions unless a persisted product preference
 * exists (none today).
 */

export const CREATE_RUN_OPT_IN_DEFAULTS = {
  /** One-time draft Run(s) unless the user checks "Create as recurring schedule". */
  asRecurring: false,
  /** Quiet by default — user must check "Ping Discord roles". */
  discordRolePing: false,
} as const;

export type CreateRunOptInState = {
  asRecurring: boolean;
  discordRolePing: boolean;
};

/** Fresh form / post-create clean slate. */
export function createRunOptInInitialState(
  formDiscordDefault: boolean = CREATE_RUN_OPT_IN_DEFAULTS.discordRolePing,
): CreateRunOptInState {
  return {
    asRecurring: CREATE_RUN_OPT_IN_DEFAULTS.asRecurring,
    discordRolePing: formDiscordDefault,
  };
}

/** Toggle recurring without changing Discord ping. */
export function withRecurringOptIn(
  state: CreateRunOptInState,
  asRecurring: boolean,
): CreateRunOptInState {
  return { ...state, asRecurring };
}

/** Toggle Discord role ping without changing recurring. */
export function withDiscordRolePingOptIn(
  state: CreateRunOptInState,
  discordRolePing: boolean,
): CreateRunOptInState {
  return { ...state, discordRolePing };
}
