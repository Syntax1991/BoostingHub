import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { orm } from "@/lib/prisma";
import { POST as reservePost } from "@/app/api/bot/tickets/route";
import { GET as ticketGet } from "@/app/api/bot/tickets/[ticketId]/route";
import { POST as activatePost } from "@/app/api/bot/tickets/[ticketId]/activate/route";
import { POST as beginClosePost } from "@/app/api/bot/tickets/[ticketId]/begin-close/route";
import { GET as pendingDeletesGet } from "@/app/api/bot/tickets/pending-deletes/route";
import { GET as panelGet, PUT as panelPut } from "@/app/api/bot/ticket-panel/route";

const TOKEN = "bot-api-ticket-test-token-0123456789";
const CREATOR = "620000000000000001";

function req(url: string, init?: { method?: string; token?: string | null; body?: unknown }): NextRequest {
  const headers: Record<string, string> = {};
  if (init?.token !== null) headers.authorization = `Bearer ${init?.token ?? TOKEN}`;
  return new NextRequest(new URL(url, "http://bot-api.test"), {
    method: init?.method ?? "GET",
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function params(ticketId: string) {
  return { params: Promise.resolve({ ticketId }) };
}

const RESERVE_BODY = {
  type: "GENERAL_SUPPORT",
  creatorDiscordUserId: CREATOR,
  creatorDisplayName: "Syntax",
  subject: "Question",
  description: "How does the weekly schedule work?",
};

let previousToken: string | undefined;
beforeAll(() => {
  previousToken = process.env.BOOSTINGHUB_BOT_API_TOKEN;
  process.env.BOOSTINGHUB_BOT_API_TOKEN = TOKEN;
});
async function cleanup() {
  await orm.SupportTicket.where({ creatorDiscordUserId: CREATOR }).deleteAll();
  await orm.DiscordTicketPanel.where({ id: "support" }).deleteAll();
}
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  process.env.BOOSTINGHUB_BOT_API_TOKEN = previousToken;
});

describe("ticket Bot API — service authorization", () => {
  it("rejects requests without or with a wrong bot token", async () => {
    for (const token of [null, "wrong-token"]) {
      const reserve = await reservePost(req("/api/bot/tickets", { method: "POST", token, body: RESERVE_BODY }));
      expect(reserve.status).toBe(401);
      const get = await ticketGet(req("/api/bot/tickets/aaaaaaaa-0000", { token }), params("aaaaaaaa-0000"));
      expect(get.status).toBe(401);
      expect((await pendingDeletesGet(req("/api/bot/tickets/pending-deletes", { token }))).status).toBe(401);
      expect((await panelGet(req("/api/bot/ticket-panel", { token }))).status).toBe(401);
    }
    expect(await orm.SupportTicket.where({ creatorDiscordUserId: CREATOR }).all()).toHaveLength(0);
  });

  it("rejects a malformed ticket id before touching the database", async () => {
    const response = await ticketGet(req("/api/bot/tickets/x"), params("../../x"));
    expect(response.status).toBe(400);
  });
});

describe("ticket Bot API — lifecycle over HTTP", () => {
  it("reserve → get → activate → begin-close", async () => {
    const reserved = await (await reservePost(req("/api/bot/tickets", { method: "POST", body: RESERVE_BODY }))).json();
    expect(reserved.ok).toBe(true);
    expect(reserved.data.outcome).toBe("RESERVED");
    const id = reserved.data.ticket.id as string;

    const fetched = await (await ticketGet(req(`/api/bot/tickets/${id}`), params(id))).json();
    expect(fetched.data.status).toBe("OPENING");
    expect(fetched.data).not.toHaveProperty("transcriptHtml");

    const activated = await activatePost(
      req(`/api/bot/tickets/${id}/activate`, { method: "POST", body: { channelId: "720000000000000001", channelName: "ticket-0001-syntax" } }),
      params(id),
    );
    expect((await activated.json()).data.status).toBe("OPEN");

    const begun = await (
      await beginClosePost(
        req(`/api/bot/tickets/${id}/begin-close`, { method: "POST", body: { closedByDiscordUserId: CREATOR } }),
        params(id),
      )
    ).json();
    expect(begun.data.acquired).toBe(true);
  });

  it("validation failures are 400, unknown tickets are 404", async () => {
    const bad = await reservePost(req("/api/bot/tickets", { method: "POST", body: { ...RESERVE_BODY, subject: "" } }));
    expect(bad.status).toBe(400);
    const missingId = "aaaaaaaa-aaaa-4aaa-8aaa-000000000404";
    const missing = await ticketGet(req(`/api/bot/tickets/${missingId}`), params(missingId));
    expect(missing.status).toBe(404);
  });

  it("panel identity round-trips", async () => {
    expect((await (await panelGet(req("/api/bot/ticket-panel"))).json()).data).toBeNull();
    const body = { channelId: "720000000000000002", messageId: "720000000000000003", lastSignature: "sig" };
    await panelPut(req("/api/bot/ticket-panel", { method: "PUT", body }));
    expect((await (await panelGet(req("/api/bot/ticket-panel"))).json()).data).toEqual(body);
  });
});
