import { redirect } from "next/navigation";

/** Legacy bookmark: /manage/raid-catalog → Raid Catalog. */
export default function ManageContentRedirectPage() {
  redirect("/manage/raid-catalog");
}
