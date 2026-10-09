import { redirect } from "next/navigation";

/** Legacy bookmark: /manage/content/raids/[raidId] → /manage/raid-catalog/raids/[raidId]. */
export default async function ManageContentRaidRedirectPage({
  params,
}: {
  params: Promise<{ raidId: string }>;
}) {
  const { raidId } = await params;
  redirect(`/manage/raid-catalog/raids/${raidId}`);
}
