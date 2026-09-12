import { redirect } from "next/navigation";

/**
 * Legacy URL. Run creation is one canonical workflow (1-25 drafts) at
 * /manage/runs/create — this route only preserves old links/bookmarks.
 */
export default function CreateManyRunsRedirectPage() {
  redirect("/manage/runs/create");
}
