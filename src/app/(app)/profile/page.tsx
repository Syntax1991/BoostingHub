import { profileController } from "@/controllers/app.controller";
import { ProfileView } from "@/components/profile/profile-view";

export default async function ProfilePage() {
  const data = await profileController.getProfilePage();
  return <ProfileView data={data} />;
}
