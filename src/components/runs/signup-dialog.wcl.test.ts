import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BoosterCharacterChecklist } from "@/components/runs/signup-dialog";

const noop = () => {};

const emptySelected = new Set<string>();

describe("BoosterCharacterChecklist Warcraft Logs links", () => {
  it("shows WCL for an eligible Booster Character with an id", () => {
    const html = renderToStaticMarkup(
      createElement(BoosterCharacterChecklist, {
        groups: [
          {
            characterId: "char-1",
            characterName: "Stormhowl",
            realm: "Twisting Nether",
            wowClass: "SHAMAN",
            specialization: "Restoration",
            warcraftLogsId: "12345678",
            roles: ["HEALER", "DPS"],
            defaultRole: "HEALER",
            contentSaves: [],
          },
        ],
        ineligible: [],
        selected: emptySelected,
        rolesByCharacterId: {},
        onToggle: noop,
        onRoleToggle: noop,
        onSelectAll: noop,
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/12345678");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("hides WCL for an eligible Booster Character without an id", () => {
    const html = renderToStaticMarkup(
      createElement(BoosterCharacterChecklist, {
        groups: [
          {
            characterId: "char-1",
            characterName: "Stormhowl",
            realm: "Twisting Nether",
            wowClass: "SHAMAN",
            specialization: "Restoration",
            warcraftLogsId: null,
            roles: ["HEALER", "DPS"],
            defaultRole: "HEALER",
            contentSaves: [],
          },
        ],
        ineligible: [],
        selected: emptySelected,
        rolesByCharacterId: {},
        onToggle: noop,
        onRoleToggle: noop,
        onSelectAll: noop,
      }),
    );
    expect(html).not.toContain("warcraftlogs.com");
  });

  it("still shows WCL for a reservation-blocked Booster Character with an id", () => {
    const html = renderToStaticMarkup(
      createElement(BoosterCharacterChecklist, {
        groups: [],
        ineligible: [
          {
            characterId: "char-2",
            characterName: "Booked",
            realm: "Draenor",
            warcraftLogsId: "87654321",
            reason: "ALREADY_SELECTED_OTHER_RUN",
            message: "Already selected for Other Run.",
            conflictingRunTitle: "Other Run",
          },
        ],
        selected: emptySelected,
        rolesByCharacterId: {},
        onToggle: noop,
        onRoleToggle: noop,
        onSelectAll: noop,
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/87654321");
    expect(html).toContain("Unavailable — already selected for another run");
  });

  it("still shows WCL for other rendered ineligible Booster Characters with an id", () => {
    const html = renderToStaticMarkup(
      createElement(BoosterCharacterChecklist, {
        groups: [],
        ineligible: [
          {
            characterId: "char-3",
            characterName: "LockedOut",
            realm: "Kazzak",
            warcraftLogsId: "11223344",
            reason: "NO_BOOSTER_ACCESS",
            message: "No approved booster access.",
          },
        ],
        selected: emptySelected,
        rolesByCharacterId: {},
        onToggle: noop,
        onRoleToggle: noop,
        onSelectAll: noop,
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/11223344");
    expect(html).toContain("No approved booster access.");
  });

  it("still shows WCL for a manually unavailable Booster Character with an id", () => {
    const html = renderToStaticMarkup(
      createElement(BoosterCharacterChecklist, {
        groups: [],
        ineligible: [
          {
            characterId: "char-4",
            characterName: "Busy",
            realm: "Silvermoon",
            warcraftLogsId: "99887766",
            reason: "MANUALLY_UNAVAILABLE",
            message: "Unavailable Fri 18/09/2026 19:00–22:00 — External boost",
          },
        ],
        selected: emptySelected,
        rolesByCharacterId: {},
        onToggle: noop,
        onRoleToggle: noop,
        onSelectAll: noop,
      }),
    );
    expect(html).toContain("https://www.warcraftlogs.com/character/id/99887766");
    expect(html).toContain("External boost");
  });
});
