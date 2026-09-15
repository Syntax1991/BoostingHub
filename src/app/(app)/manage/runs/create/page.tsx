import { redirect } from "next/navigation";
import { runCreatePath } from "@/lib/run-routes";

/**
 * Legacy Create Runs URL. Canonical workflow lives at /runs/create.
 */
export default function LegacyCreateRunsRedirectPage() {
  redirect(runCreatePath());
}
