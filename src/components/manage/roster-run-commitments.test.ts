import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RosterRunCommitmentsBlock,
  RosterScheduleConflictAlert,
} from "@/components/manage/roster-run-commitments";
import {
  getRunCommitmentPresentation,
  SCHEDULE_CONFLICT_ALERT_CLASSNAME,
} from "@/lib/run-commitment-presentation";
import type { CharacterRunCommitment } from "@/services/character-run-commitment-state";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const reserved: CharacterRunCommitment = {
  runId: "run-draft-other",
  runTitle: "Fri draft run",
  productLabel: "Season 2 Bundle",
  difficulty: "HEROIC",
  scheduledStartAt: "2026-10-02T21:00:00.000Z",
  runStatus: "ROSTERING",
  state: "RESERVED",
};

const committed: CharacterRunCommitment = {
  runId: "run-pub-other",
  runTitle: "Thu published run",
  productLabel: "The Venomous Abyss",
  difficulty: "HEROIC",
  scheduledStartAt: "2026-10-01T21:30:00.000Z",
  runStatus: "PUBLISHED",
  state: "COMMITTED",
};

describe("getRunCommitmentPresentation", () => {
  it("maps RESERVED to Draft roster with danger tone", () => {
    const presentation = getRunCommitmentPresentation("RESERVED");
    expect(presentation.label).toBe("Draft roster");
    expect(presentation.tone).toBe("danger");
    expect(presentation.chipClassName).toContain("text-danger");
    expect(presentation.chipClassName).toContain("border-danger");
  });

  it("maps COMMITTED to Published roster with warning tone", () => {
    const presentation = getRunCommitmentPresentation("COMMITTED");
    expect(presentation.label).toBe("Published roster");
    expect(presentation.tone).toBe("warning");
    expect(presentation.chipClassName).toContain("text-warning");
    expect(presentation.chipClassName).toContain("border-warning");
  });

  it("keeps schedule conflict alert classes stronger than draft chips", () => {
    expect(SCHEDULE_CONFLICT_ALERT_CLASSNAME).toContain("border-danger");
    expect(SCHEDULE_CONFLICT_ALERT_CLASSNAME).toContain("bg-danger");
    expect(SCHEDULE_CONFLICT_ALERT_CLASSNAME).toContain("text-danger");
    expect(getRunCommitmentPresentation("RESERVED").chipClassName).not.toContain("bg-danger/15");
  });
});

describe("RosterRunCommitmentsBlock", () => {
  it("A–C: RESERVED renders Other run · Draft roster with danger styling and no Reserved elsewhere", () => {
    const html = renderToStaticMarkup(createElement(RosterRunCommitmentsBlock, { commitments: [reserved] }));
    expect(html).toContain("Other run");
    expect(html).toContain("Draft roster");
    expect(html).toContain("text-danger");
    expect(html).not.toContain("Reserved elsewhere");
    expect(html).toContain("Season 2 Bundle");
    expect(html).toContain("/runs/run-draft-other");
    expect(html).toContain("Heroic");
  });

  it("D–I: COMMITTED renders Other run · Published roster with warning styling and run details", () => {
    const html = renderToStaticMarkup(createElement(RosterRunCommitmentsBlock, { commitments: [committed] }));
    expect(html).toContain("Other run");
    expect(html).toContain("Published roster");
    expect(html).toContain("text-warning");
    expect(html).not.toContain("Committed elsewhere");
    expect(html).toContain("The Venomous Abyss");
    expect(html).toContain("/runs/run-pub-other");
    expect(html).toContain("Heroic");
  });

  it("O/Q: multiple commitments keep Draft and Published independently identifiable with visible text", () => {
    const html = renderToStaticMarkup(
      createElement(RosterRunCommitmentsBlock, { commitments: [reserved, committed] }),
    );
    expect(html).toContain("Other run selections");
    expect(html).toContain("Draft roster");
    expect(html).toContain("Published roster");
    expect(html).toContain("text-danger");
    expect(html).toContain("text-warning");
    expect(html).not.toContain("Reserved elsewhere");
    expect(html).not.toContain("Committed elsewhere");
  });
});

describe("RosterScheduleConflictAlert", () => {
  it("L/M: renders Schedule conflict with strong danger alert treatment", () => {
    const html = renderToStaticMarkup(
      createElement(RosterScheduleConflictAlert, {
        conflicts: [
          {
            source: "RUN_RESERVATION",
            conflictingRunId: "run-pub-other",
            conflictingRunTitle: "The Venomous Abyss",
            conflictingScheduledStartAt: "2026-10-01T21:30:00.000Z",
            message: "Another Manawyrm Hub Run: The Venomous Abyss at Thu 01/10/2026 23:30",
          },
        ],
      }),
    );
    expect(html).toContain("Schedule conflict");
    expect(html).toContain("Another Manawyrm Hub Run: The Venomous Abyss");
    expect(html).toContain("border-danger");
    expect(html).toContain("bg-danger");
    expect(html).toContain("text-danger");
    expect(html).toContain('role="alert"');
  });

  it("J/K: commitments without conflicts do not invent Schedule conflict copy", () => {
    const reservedHtml = renderToStaticMarkup(
      createElement(RosterRunCommitmentsBlock, { commitments: [reserved] }),
    );
    const committedHtml = renderToStaticMarkup(
      createElement(RosterRunCommitmentsBlock, { commitments: [committed] }),
    );
    expect(reservedHtml).not.toContain("Schedule conflict");
    expect(committedHtml).not.toContain("Schedule conflict");
  });

  it("N: commitment + conflict both render when composed", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(RosterRunCommitmentsBlock, { commitments: [committed] }),
        createElement(RosterScheduleConflictAlert, {
          conflicts: [
            {
              source: "RUN_RESERVATION",
              conflictingRunId: committed.runId,
              conflictingRunTitle: committed.runTitle,
              conflictingScheduledStartAt: committed.scheduledStartAt,
              message: "Another Manawyrm Hub Run: The Venomous Abyss at Thu 01/10/2026 23:30",
            },
          ],
        }),
      ),
    );
    expect(html).toContain("Published roster");
    expect(html).toContain("Schedule conflict");
    expect(html).toContain("The Venomous Abyss");
  });
});
