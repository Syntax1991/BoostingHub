import type { AuthenticatedUser } from "@/auth/authorization";
import { DomainError } from "@/lib/errors";
import { isBlizzardConfigured } from "@/lib/blizzard/config";
import {
  BATTLENET_OAUTH_STATE_COOKIE,
  battleNetOAuthCookieOptions,
  createBattleNetOAuthState,
} from "@/lib/blizzard/oauth-state";
import type { BattleNetConnectionSummary, OwnedBlizzardCharacter } from "@/lib/blizzard/types";
import { blizzardApiClient } from "@/integrations/blizzard/blizzard-api-client";
import type { WowRegion } from "@/models/enums";
import { WOW_REGIONS } from "@/models/enums";
import { activityRepository } from "@/repositories/activity.repository";
import { battleNetConnectionRepository } from "@/repositories/battle-net-connection.repository";
import { battleNetImportSessionRepository } from "@/repositories/battle-net-import-session.repository";

const IMPORT_SESSION_TTL_MS = 15 * 60 * 1000;

function assertRegion(region: string): WowRegion {
  if (!(WOW_REGIONS as readonly string[]).includes(region)) {
    throw new DomainError("VALIDATION_FAILED", "Region must be EU or US.");
  }
  return region as WowRegion;
}

function assertConfigured() {
  if (!isBlizzardConfigured()) {
    throw new DomainError(
      "BATTLENET_NOT_CONFIGURED",
      "Battle.net integration is not configured.",
      503,
    );
  }
}

export const battleNetService = {
  /**
   * Starts regional Battle.net OAuth. Tokens are never persisted — only the
   * redirect URL and HttpOnly state cookie values are returned to the route.
   */
  beginConnect(user: AuthenticatedUser, regionInput: string) {
    assertConfigured();
    const region = assertRegion(regionInput);
    const state = createBattleNetOAuthState({ userId: user.id, region });
    const authorizationUrl = blizzardApiClient.buildAuthorizationUrl(region, state.stateParam);

    return {
      authorizationUrl,
      region,
      cookie: {
        name: BATTLENET_OAUTH_STATE_COOKIE,
        value: state.cookieValue,
        options: battleNetOAuthCookieOptions(state.maxAgeSeconds),
      },
    };
  },

  async handleCallback(input: {
    user: AuthenticatedUser;
    code: string;
    region: WowRegion;
  }) {
    assertConfigured();

    // Access token stays ephemeral in this stack frame only.
    const token = await blizzardApiClient.exchangeAuthorizationCode(input.code);
    try {
      const userInfo = await blizzardApiClient.getUserInfo(token.accessToken);
      const owned = await blizzardApiClient.getAccountProfile(token.accessToken, input.region);

      await battleNetConnectionRepository.upsert({
        userId: input.user.id,
        region: input.region,
        battleNetAccountId: userInfo.sub,
        battleTag: userInfo.battletag,
        scope: token.scope,
      });

      const expiresAt = new Date(Date.now() + IMPORT_SESSION_TTL_MS).toISOString();
      const session = await battleNetImportSessionRepository.create({
        userId: input.user.id,
        region: input.region,
        characters: owned,
        expiresAt,
      });

      await activityRepository.create({
        userId: input.user.id,
        type: "BATTLENET_CONNECTED",
        message: `Connected Battle.net (${input.region})${userInfo.battletag ? `: ${userInfo.battletag}` : ""}.`,
      });

      return {
        region: input.region,
        importSessionId: session.id,
        characterCount: owned.length,
      };
    } finally {
      // Drop references; do not persist user OAuth tokens anywhere.
      void token;
    }
  },

  async listConnections(user: AuthenticatedUser): Promise<BattleNetConnectionSummary[]> {
    const rows = await battleNetConnectionRepository.listByUserId(user.id);
    return rows.map((row) => ({
      id: row.id,
      region: row.region,
      battleTag: row.battleTag,
      connectedAt: row.connectedAt,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    }));
  },

  async getImportSession(user: AuthenticatedUser, sessionId: string) {
    const session = await battleNetImportSessionRepository.findOwnedById(user.id, sessionId);
    if (!session) {
      throw new DomainError(
        "BATTLENET_IMPORT_SESSION_NOT_FOUND",
        "Battle.net import session was not found.",
        404,
      );
    }
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw new DomainError(
        "BATTLENET_IMPORT_SESSION_EXPIRED",
        "Battle.net import session has expired. Reconnect to refresh the list.",
        400,
      );
    }

    return {
      id: session.id,
      region: session.region,
      expiresAt: session.expiresAt,
      characters: session.characters as OwnedBlizzardCharacter[],
    };
  },

  async disconnect(user: AuthenticatedUser, regionInput: string) {
    const region = assertRegion(regionInput);
    const existing = await battleNetConnectionRepository.findByUserAndRegion(user.id, region);
    if (!existing) {
      throw new DomainError("BATTLENET_NOT_CONNECTED", `No Battle.net connection for ${region}.`, 404);
    }

    await battleNetImportSessionRepository.deleteByUserAndRegion(user.id, region);
    await battleNetConnectionRepository.deleteByUserAndRegion(user.id, region);

    await activityRepository.create({
      userId: user.id,
      type: "BATTLENET_DISCONNECTED",
      message: `Disconnected Battle.net (${region}). Characters were kept.`,
    });
  },

  async getCharacterPagePanel(user: AuthenticatedUser, importSessionId?: string | null) {
    const connections = await this.listConnections(user);
    let importSession: Awaited<ReturnType<typeof this.getImportSession>> | null = null;
    if (importSessionId) {
      try {
        importSession = await this.getImportSession(user, importSessionId);
      } catch (error) {
        if (
          error instanceof DomainError &&
          (error.code === "BATTLENET_IMPORT_SESSION_NOT_FOUND" ||
            error.code === "BATTLENET_IMPORT_SESSION_EXPIRED")
        ) {
          importSession = null;
        } else {
          throw error;
        }
      }
    }

    return {
      configured: isBlizzardConfigured(),
      connections,
      importSession,
    };
  },
};
