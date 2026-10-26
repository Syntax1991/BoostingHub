"use client";

import { useRouter } from "next/navigation";

/** Season filter of the Raids tab: each option carries its own URL, so the choice lives in `?season=`. */
export function SeasonFilterSelect({
  options,
  value,
}: {
  options: ReadonlyArray<{ value: string; label: string; href: string }>;
  value: string;
}) {
  const router = useRouter();
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="shrink-0">Season</span>
      <select
        className="h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
        value={value}
        onChange={(event) => {
          const option = options.find((row) => row.value === event.target.value);
          if (option) router.push(option.href, { scroll: false });
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
