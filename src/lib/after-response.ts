import { after } from "next/server";

/**
 * Run `task` after the current response has been sent (Next.js `after()`), so
 * it never delays a page render. Outside a request scope (tests, scripts, the
 * bot) `after()` is unavailable: the task is skipped and `onSkipped` runs —
 * background refreshes are a page-view side effect only.
 */
export function runAfterResponse(task: () => Promise<void>, onSkipped?: () => void): void {
  try {
    after(async () => {
      try {
        await task();
      } catch (error) {
        console.error("[after-response] background task failed", error);
      }
    });
  } catch {
    onSkipped?.();
  }
}
