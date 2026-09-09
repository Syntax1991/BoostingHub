import { redirect } from "next/navigation";
import { runDetailPath } from "@/lib/run-routes";

/**
 * Compatibility only. Canonical Run detail is /runs/[runId].
 * Anyone authenticated under the app layout is sent there; viewer permissions
 * are shaped on the destination, not here.
 */
export default async function ManageRunCompatibilityPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  redirect(runDetailPath(runId));
}
