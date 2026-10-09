"use client";

import { useMemo, useState } from "react";
import { Field, fieldInputClass } from "@/components/manage/content/content-dialog";

const ADD_NEW = "__add_new_season__";

/**
 * Season picker for Content Catalog raids.
 * Options come from distinct persisted `Raid.season` values (no hardcoded list).
 * "+ Add new season" reveals a text input; the resulting trimmed string is what saves.
 */
export function SeasonSelector({
  seasons,
  value,
  onChange,
}: {
  seasons: readonly string[];
  value: string;
  onChange: (season: string) => void;
}) {
  const options = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const season of seasons) {
      const trimmed = season.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      ordered.push(trimmed);
    }
    return ordered;
  }, [seasons]);

  const valueInOptions = options.includes(value);
  const [addingNew, setAddingNew] = useState(() => Boolean(value) && !valueInOptions);
  const [draftNew, setDraftNew] = useState(() => (valueInOptions ? "" : value));

  const selectValue = addingNew ? ADD_NEW : valueInOptions ? value : "";

  return (
    <div className="space-y-2">
      <Field label="Season">
        <select
          className={fieldInputClass}
          value={selectValue}
          onChange={(e) => {
            const next = e.target.value;
            if (next === ADD_NEW) {
              setAddingNew(true);
              onChange(draftNew.trim());
              return;
            }
            setAddingNew(false);
            onChange(next);
          }}
        >
          <option value="" disabled>
            Choose a season…
          </option>
          {options.map((season) => (
            <option key={season} value={season}>
              {season}
            </option>
          ))}
          <option disabled value="__divider__">
            ────────────
          </option>
          <option value={ADD_NEW}>+ Add new season</option>
        </select>
      </Field>
      {addingNew ? (
        <Field label="New season name" hint="Saved exactly as typed (trimmed).">
          <input
            className={fieldInputClass}
            value={draftNew}
            maxLength={100}
            placeholder="e.g. Midnight Season 3"
            onChange={(e) => {
              setDraftNew(e.target.value);
              onChange(e.target.value);
            }}
          />
        </Field>
      ) : null}
    </div>
  );
}
