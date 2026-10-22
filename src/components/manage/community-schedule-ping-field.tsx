"use client";

/**
 * "Ping roles" for the Runs a Schedule time creates — the same setting as a
 * Run's own "Ping Discord roles" (Run.discordRolePing). Off by default.
 */
export function PingRolesField({
  checked,
  onChange,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Extra line, e.g. where the current value came from. */
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
        aria-label="Ping Tank, Healer, and DPS Discord roles"
      />
      <span>
        <span className="block">Ping Discord roles (@Tank @Healer @DPS)</span>
        <span className="mt-0.5 block text-xs text-muted">
          For the Runs this Schedule creates: notify those roles when the Run channel is created. Off by default.
          {hint ? ` ${hint}` : ""}
        </span>
      </span>
    </label>
  );
}
