import { describe, expect, it } from "vitest";
import {
  shouldRetireDiscordChannel,
  shouldUseClosedDiscordRunChannelName,
} from "@/services/discord-sync.service";

describe("shouldRetireDiscordChannel (destructive TEXT-channel authority)", () => {
  it("A: COMPLETED + archivedAt=null → false", () => {
    expect(shouldRetireDiscordChannel({ status: "COMPLETED", archivedAt: null })).toBe(false);
  });

  it("B: CANCELLED + archivedAt=null → false", () => {
    expect(shouldRetireDiscordChannel({ status: "CANCELLED", archivedAt: null })).toBe(false);
  });

  it("C: PUBLISHED + archivedAt set → true", () => {
    expect(shouldRetireDiscordChannel({ status: "PUBLISHED", archivedAt: "2026-10-01T12:00:00.000Z" })).toBe(true);
  });

  it("D: COMPLETED + archivedAt set → true", () => {
    expect(shouldRetireDiscordChannel({ status: "COMPLETED", archivedAt: "2026-10-01T12:00:00.000Z" })).toBe(true);
  });

  it("E: CANCELLED + archivedAt set → true", () => {
    expect(shouldRetireDiscordChannel({ status: "CANCELLED", archivedAt: "2026-10-01T12:00:00.000Z" })).toBe(true);
  });

  it("status alone never authorizes deletion", () => {
    for (const status of ["DRAFT", "OPEN", "ROSTERING", "PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
      expect(shouldRetireDiscordChannel({ status, archivedAt: null })).toBe(false);
    }
  });
});

describe("shouldUseClosedDiscordRunChannelName (presentation only)", () => {
  it("COMPLETED + unarchived uses closed naming without retirement authority", () => {
    const run = { status: "COMPLETED", archivedAt: null };
    expect(shouldUseClosedDiscordRunChannelName(run)).toBe(true);
    expect(shouldRetireDiscordChannel(run)).toBe(false);
  });

  it("CANCELLED + unarchived uses closed naming without retirement authority", () => {
    const run = { status: "CANCELLED", archivedAt: null };
    expect(shouldUseClosedDiscordRunChannelName(run)).toBe(true);
    expect(shouldRetireDiscordChannel(run)).toBe(false);
  });

  it("PUBLISHED + unarchived stays open naming", () => {
    const run = { status: "PUBLISHED", archivedAt: null };
    expect(shouldUseClosedDiscordRunChannelName(run)).toBe(false);
    expect(shouldRetireDiscordChannel(run)).toBe(false);
  });

  it("app-archived uses closed naming and retirement authority", () => {
    const run = { status: "PUBLISHED", archivedAt: "2026-10-01T12:00:00.000Z" };
    expect(shouldUseClosedDiscordRunChannelName(run)).toBe(true);
    expect(shouldRetireDiscordChannel(run)).toBe(true);
  });
});
