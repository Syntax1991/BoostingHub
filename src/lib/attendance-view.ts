import {
  ATTENDANCE_STATUSES,
  CHARACTER_ROLES,
  PARTICIPATION_TYPES,
  type AttendanceStatus,
  type CharacterRole,
  type ParticipationType,
} from "@/models/enums";

/**
 * Run Detail → Attendance: local sorting and filtering of the already-loaded
 * rows (pure, client-safe; never mutates its input, no domain writes).
 */

export type AttendanceViewRow = {
  id: string;
  characterName: string | null;
  characterRealm: string | null;
  userName: string;
  selectedRole: CharacterRole | null;
  participationType: ParticipationType;
  isBackup: boolean;
  status: AttendanceStatus;
};

/* ------------------------------------------------------------------ sort */

export const ATTENDANCE_SORTS = ["attendance", "role", "character", "type"] as const;
export type AttendanceSort = (typeof ATTENDANCE_SORTS)[number];
export const DEFAULT_ATTENDANCE_SORT: AttendanceSort = "attendance";

export const ATTENDANCE_SORT_LABELS: Record<AttendanceSort, string> = {
  attendance: "Attendance",
  role: "Role",
  character: "Character",
  type: "Type",
};

/** UNMARKED first (the open work), then the domain enum order: PRESENT, LATE, LEFT_EARLY, NO_SHOW, EXCUSED, STANDBY. */
export const ATTENDANCE_STATUS_SORT_ORDER: readonly AttendanceStatus[] = ATTENDANCE_STATUSES;

/** Concrete roster roles in roster order; legacy generic DPS after them; no role (Lootbuddy) last. */
export const ATTENDANCE_ROLE_SORT_ORDER: readonly CharacterRole[] = ["TANK", "HEALER", "MELEE_DPS", "RANGED_DPS", "DPS"];

function indexIn<T>(order: readonly T[], value: T | null): number {
  const index = value == null ? -1 : order.indexOf(value);
  return index < 0 ? order.length : index;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function byRole(a: AttendanceViewRow, b: AttendanceViewRow): number {
  return indexIn(ATTENDANCE_ROLE_SORT_ORDER, a.selectedRole) - indexIn(ATTENDANCE_ROLE_SORT_ORDER, b.selectedRole);
}

/** Character name A–Z (case-insensitive), realm as tiebreaker, then player name and id for a total order. */
function byCharacter(a: AttendanceViewRow, b: AttendanceViewRow): number {
  return (
    collator.compare(a.characterName ?? a.userName, b.characterName ?? b.userName) ||
    collator.compare(a.characterRealm ?? "", b.characterRealm ?? "") ||
    collator.compare(a.userName, b.userName) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const COMPARATORS: Record<AttendanceSort, (a: AttendanceViewRow, b: AttendanceViewRow) => number> = {
  attendance: (a, b) =>
    indexIn(ATTENDANCE_STATUS_SORT_ORDER, a.status) - indexIn(ATTENDANCE_STATUS_SORT_ORDER, b.status) ||
    byRole(a, b) ||
    byCharacter(a, b),
  role: (a, b) => byRole(a, b) || byCharacter(a, b),
  character: byCharacter,
  type: (a, b) =>
    indexIn(PARTICIPATION_TYPES, a.participationType) - indexIn(PARTICIPATION_TYPES, b.participationType) ||
    byRole(a, b) ||
    byCharacter(a, b),
};

/** A sorted copy; total order (id as last tiebreaker), so rows never jump around between renders. */
export function sortAttendanceRows<T extends AttendanceViewRow>(rows: readonly T[], sort: AttendanceSort): T[] {
  return [...rows].sort(COMPARATORS[sort]);
}

/* ---------------------------------------------------------------- filter */

export type AttendanceFilters = {
  search: string;
  status: AttendanceStatus | "ALL";
  role: CharacterRole | "ALL";
  type: ParticipationType | "ALL";
  backup: "ALL" | "MAIN" | "BACKUP";
};

export const DEFAULT_ATTENDANCE_FILTERS: AttendanceFilters = {
  search: "",
  status: "ALL",
  role: "ALL",
  type: "ALL",
  backup: "ALL",
};

/** Concrete roles offered in the Role filter (Melee / Ranged stay distinct on this operational screen). */
export const ATTENDANCE_ROLE_FILTER_OPTIONS: readonly CharacterRole[] = CHARACTER_ROLES.filter(
  (role): role is CharacterRole => role !== "DPS",
);

export function isDefaultAttendanceFilters(filters: AttendanceFilters): boolean {
  return (
    filters.search.trim() === "" &&
    filters.status === "ALL" &&
    filters.role === "ALL" &&
    filters.type === "ALL" &&
    filters.backup === "ALL"
  );
}

/** All filters combine with AND; search matches Character, realm and player name, case-insensitively. */
export function filterAttendanceRows<T extends AttendanceViewRow>(rows: readonly T[], filters: AttendanceFilters): T[] {
  const needle = filters.search.trim().toLocaleLowerCase("en");
  return rows.filter((row) => {
    if (filters.status !== "ALL" && row.status !== filters.status) return false;
    if (filters.role !== "ALL" && row.selectedRole !== filters.role) return false;
    if (filters.type !== "ALL" && row.participationType !== filters.type) return false;
    if (filters.backup === "BACKUP" && !row.isBackup) return false;
    if (filters.backup === "MAIN" && row.isBackup) return false;
    if (needle) {
      const haystack = [row.characterName, row.characterRealm, row.userName]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("en");
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Filter first, then sort the filtered result. */
export function viewAttendanceRows<T extends AttendanceViewRow>(
  rows: readonly T[],
  filters: AttendanceFilters,
  sort: AttendanceSort,
): T[] {
  return sortAttendanceRows(filterAttendanceRows(rows, filters), sort);
}

/** Filter options that can actually occur in these rows (Type, Backup); statuses / roles come from the domain. */
export function attendanceFilterAvailability(rows: readonly AttendanceViewRow[]): {
  types: ParticipationType[];
  hasBackups: boolean;
} {
  return {
    types: PARTICIPATION_TYPES.filter((type) => rows.some((row) => row.participationType === type)),
    hasBackups: rows.some((row) => row.isBackup),
  };
}
