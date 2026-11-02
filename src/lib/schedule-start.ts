export type ScheduleStartMode = "KEEP" | "IMMEDIATE" | "NEXT_RAID_ID" | "SKIP_FIRST" | "FROM_DATE";
export type ScheduleStartState = { mode: ScheduleStartMode; date: string };

export const DEFAULT_SCHEDULE_START: ScheduleStartState = { mode: "IMMEDIATE", date: "" };

/** Request payload for a start choice; KEEP → omitted (the server keeps the boundary). */
export function scheduleStartPayload(state: ScheduleStartState):
  | { mode: "IMMEDIATE" | "NEXT_RAID_ID" | "SKIP_FIRST" }
  | { mode: "FROM_DATE"; date: string }
  | undefined {
  if (state.mode === "KEEP") return undefined;
  if (state.mode === "FROM_DATE") return { mode: "FROM_DATE", date: state.date };
  return { mode: state.mode };
}
