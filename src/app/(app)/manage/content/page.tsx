import { redirect } from "next/navigation";

/** Legacy bookmark: /manage/content → /manage/raid-catalog. */
export default function ManageContentRedirectPage() {
  redirect("/manage/raid-catalog");
}
