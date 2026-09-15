import { redirect } from "next/navigation";
import { runCreatePath } from "@/lib/run-routes";

/**
 * Legacy mass-create URL (initial development route). Canonical workflow:
 * /runs/create — this route only preserves old links/bookmarks.
 */
export default function CreateManyRunsRedirectPage() {
  redirect(runCreatePath());
}
