import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWarcraftLogsClientTokenCacheForTests,
  warcraftLogsApiClient,
} from "@/integrations/warcraft-logs/warcraft-logs-api-client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  resetWarcraftLogsClientTokenCacheForTests();
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "wcl-client");
  vi.stubEnv("WARCRAFT_LOGS_CLIENT_SECRET", "wcl-secret");
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetWarcraftLogsClientTokenCacheForTests();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const tokenResponse = () => jsonResponse({ access_token: "token", expires_in: 3600 });

function graphqlBodies(): Array<{ query: string; variables: Record<string, unknown> }> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/api/v2/client"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("warcraftLogsApiClient.fetchReportMetadata", () => {
  it("loads fights, actors and ranked characters in one request", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        data: {
          reportData: {
            report: {
              code: "zrQydCT4vaDFk1fw",
              title: "VA",
              startTime: 1000,
              endTime: 5000,
              region: { slug: "eu" },
              fights: [
                { id: 1, encounterID: 3492, name: "Ula'tek", startTime: 10, endTime: 20, kill: true, difficulty: 4, friendlyPlayers: [1] },
                { id: 2, encounterID: 0, name: "Trash", startTime: 30, endTime: 40, kill: null, difficulty: null, friendlyPlayers: [1] },
              ],
              masterData: { actors: [{ id: 1, name: "Synlight", server: "Blackhand", subType: "Priest" }] },
              rankedCharacters: [{ id: 5, canonicalID: 6, name: "Synlight", server: { slug: "blackhand" } }],
            },
          },
        },
      }),
    );
    const result = await warcraftLogsApiClient.fetchReportMetadata("zrQydCT4vaDFk1fw");
    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") return;
    expect(result.report.regionSlug).toBe("EU");
    expect(result.report.fights.map((fight) => fight.id)).toEqual([1]);
    expect(result.report.actors).toEqual([{ id: 1, name: "Synlight", server: "Blackhand", subType: "Priest" }]);
    expect(result.report.rankedCharacters[0]).toMatchObject({ id: "5", canonicalId: "6", serverSlug: "blackhand" });
    expect(graphqlBodies()).toHaveLength(1);
  });

  it("maps a private or unknown report to NOT_FOUND", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({ data: { reportData: { report: null } }, errors: [{ message: "This report does not exist or is private." }] }),
    );
    await expect(warcraftLogsApiClient.fetchReportMetadata("zrQydCT4vaDFk1fw")).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it("maps HTTP failures to TEMPORARY_FAILURE without throwing", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(jsonResponse({}, 429));
    await expect(warcraftLogsApiClient.fetchReportMetadata("zrQydCT4vaDFk1fw")).resolves.toMatchObject({
      status: "TEMPORARY_FAILURE",
    });
  });

  it("never calls the network without credentials", async () => {
    vi.stubEnv("WARCRAFT_LOGS_CLIENT_ID", "");
    await expect(warcraftLogsApiClient.fetchReportMetadata("zrQydCT4vaDFk1fw")).resolves.toEqual({
      status: "NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("warcraftLogsApiClient.fetchReportConsumableEvents", () => {
  const input = {
    code: "zrQydCT4vaDFk1fw",
    fightIds: [1, 4],
    startTime: 10_000,
    endTime: 900_000,
    castSpellIds: [1236994, 6262],
    castLeadMs: 5_000,
  };

  it("fetches casts, deaths and combatant snapshots in a single batched request", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      jsonResponse({
        data: {
          reportData: {
            report: {
              casts: {
                data: [
                  { timestamp: 9_000, type: "cast", sourceID: 1, abilityGameID: 1236994 },
                  { timestamp: 11_000, type: "begincast", sourceID: 1, abilityGameID: 6262, fight: 1 },
                ],
                nextPageTimestamp: null,
              },
              deaths: { data: [{ timestamp: 50_000, type: "death", targetID: 1, fight: 1 }], nextPageTimestamp: null },
              combatants: {
                data: [
                  {
                    timestamp: 10_000,
                    type: "combatantinfo",
                    sourceID: 1,
                    fight: 1,
                    auras: [{ ability: 1235108, name: "Flask of the Magisters" }],
                    // Position = equipment slot; id 0 = empty slot.
                    gear: [
                      { id: 0 },
                      { id: 268265, permanentEnchant: 0, gems: [{ id: 240900, itemLevel: 1 }], bonusIDs: [13987] },
                      { id: 271490, permanentEnchant: 8001, temporaryEnchant: 8052, bonusIDs: [] },
                    ],
                  },
                ],
                nextPageTimestamp: null,
              },
            },
          },
        },
      }),
    );
    const result = await warcraftLogsApiClient.fetchReportConsumableEvents(input);
    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") return;
    expect(result.events.casts).toEqual([{ fight: null, timestamp: 9_000, sourceId: 1, abilityId: 1236994 }]);
    expect(result.events.deaths).toEqual([{ fight: 1, timestamp: 50_000, targetId: 1 }]);
    expect(result.events.combatants).toEqual([
      {
        fight: 1,
        timestamp: 10_000,
        sourceId: 1,
        auraIds: [1235108],
        auraNames: { 1235108: "Flask of the Magisters" },
        gear: [
          { slot: 1, itemId: 268265, permanentEnchantId: null, temporaryEnchantId: null, gemIds: [240900], bonusIds: [13987] },
          { slot: 2, itemId: 271490, permanentEnchantId: 8001, temporaryEnchantId: 8052, gemIds: [], bonusIds: [] },
        ],
      },
    ]);

    const bodies = graphqlBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.query).toContain("dataType: Casts");
    expect(bodies[0]!.query).toContain("dataType: Deaths");
    expect(bodies[0]!.query).toContain("dataType: CombatantInfo");
    expect(bodies[0]!.query).toContain("ability.id in (1236994, 6262)");
    expect(bodies[0]!.variables).toMatchObject({ fightIds: [1, 4], castsStart: 5_000, deathsStart: 10_000 });
  });

  it("pages only the stream that has more data, without unused variables", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            reportData: {
              report: {
                casts: { data: [{ timestamp: 20_000, type: "cast", sourceID: 1, abilityGameID: 6262 }], nextPageTimestamp: 400_000 },
                deaths: { data: [], nextPageTimestamp: null },
                combatants: { data: [], nextPageTimestamp: null },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            reportData: {
              report: {
                casts: { data: [{ timestamp: 450_000, type: "cast", sourceID: 1, abilityGameID: 6262 }], nextPageTimestamp: null },
              },
            },
          },
        }),
      );
    const result = await warcraftLogsApiClient.fetchReportConsumableEvents(input);
    expect(result.status === "SUCCESS" && result.events.casts.map((cast) => cast.timestamp)).toEqual([20_000, 450_000]);
    const bodies = graphqlBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.query).not.toContain("dataType: Deaths");
    expect(bodies[1]!.query).not.toContain("$fightIds");
    expect(bodies[1]!.variables).not.toHaveProperty("fightIds");
    expect(bodies[1]!.variables).toMatchObject({ castsStart: 400_000 });
  });

  it("maps GraphQL errors to TEMPORARY_FAILURE", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { reportData: { report: {} } }, errors: [{ message: "Rate limited" }] }));
    await expect(warcraftLogsApiClient.fetchReportConsumableEvents(input)).resolves.toMatchObject({
      status: "TEMPORARY_FAILURE",
    });
  });
});
