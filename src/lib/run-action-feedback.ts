import type { ActionResult } from "@/lib/action-result";

/** Shown when a Server Action could not complete its round trip (network, stale build, runtime). */
export const ACTION_TRANSPORT_ERROR_MESSAGE = "The action could not reach the server. Reload the page and try again.";

export type ActionFeedback = { ok: boolean; text: string };

/**
 * Run one client-invoked Server Action and turn its outcome into feedback.
 * A returned ActionResult is shown as-is (success also calls `onSuccess`, e.g.
 * a reload); a REJECTED call — the request never completed — shows a generic
 * message instead of failing silently. Raw errors are never shown. Only the
 * action call itself is guarded, so a failing `onSuccess` is not mistaken for
 * a transport error.
 */
export async function runActionWithFeedback(
  action: () => Promise<ActionResult>,
  handlers: { onMessage: (feedback: ActionFeedback) => void; onSuccess: () => void },
): Promise<void> {
  let result: ActionResult;
  try {
    result = await action();
  } catch {
    handlers.onMessage({ ok: false, text: ACTION_TRANSPORT_ERROR_MESSAGE });
    return;
  }
  handlers.onMessage({ ok: result.ok, text: result.message });
  if (result.ok) handlers.onSuccess();
}
