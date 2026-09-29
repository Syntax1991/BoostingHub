import { describe, expect, it, vi } from "vitest";
import { ACTION_TRANSPORT_ERROR_MESSAGE, runActionWithFeedback } from "@/lib/run-action-feedback";

function handlers() {
  return { onMessage: vi.fn(), onSuccess: vi.fn() };
}

describe("runActionWithFeedback", () => {
  it("1. success: shows the returned message and runs the success path (reload)", async () => {
    const h = handlers();
    await runActionWithFeedback(async () => ({ ok: true, message: "Analyzed 9 fights." }), h);
    expect(h.onMessage).toHaveBeenCalledWith({ ok: true, text: "Analyzed 9 fights." });
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("2. returned failure: shows the server's message, no reload", async () => {
    const h = handlers();
    await runActionWithFeedback(async () => ({ ok: false, code: "CONSUMABLE_AUDIT_REFRESH_COOLDOWN", message: "Try again in 30s." }), h);
    expect(h.onMessage).toHaveBeenCalledWith({ ok: false, text: "Try again in 30s." });
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it("3. the call itself rejects (network, stale build): generic message, no raw error, no reload", async () => {
    const h = handlers();
    await runActionWithFeedback(async () => {
      throw new Error("Failed to fetch: internal detail sess=abc");
    }, h);
    expect(h.onMessage).toHaveBeenCalledTimes(1);
    expect(h.onMessage).toHaveBeenCalledWith({ ok: false, text: ACTION_TRANSPORT_ERROR_MESSAGE });
    expect(JSON.stringify(h.onMessage.mock.calls)).not.toContain("internal detail");
    expect(h.onSuccess).not.toHaveBeenCalled();
  });

  it("a failing success path is not reported as a transport error", async () => {
    const h = handlers();
    h.onSuccess.mockImplementation(() => {
      throw new Error("reload blocked");
    });
    await expect(runActionWithFeedback(async () => ({ ok: true, message: "Done." }), h)).rejects.toThrow("reload blocked");
    expect(h.onMessage).toHaveBeenCalledWith({ ok: true, text: "Done." });
    expect(h.onMessage).toHaveBeenCalledTimes(1);
  });
});
