import { redirect } from "next/navigation";

/** Legacy bookmark: /manage/raid-catalog/raids/[raidId] → Raid Catalog raid detail. */
export default async function ManageContentRaidRedirectPage({
  params,
}: {
  params: Promise<{ raidId: string }>;
}) {
  const { raidId } = await params;
  redirect(`/manage/raid-catalog/raids/${raidId}`);
}
