import { redirect } from "next/navigation";
import { authPageController } from "@/controllers/auth.controller";
import { LoginView } from "@/components/auth/login-view";

export default async function HomePage() {
  const data = await authPageController.getLoginPage();
  if (data.user) {
    redirect("/dashboard");
  }

  return (
    <LoginView
      discordEnabled={data.discordEnabled}
      devAuthEnabled={data.devAuthEnabled}
      identities={data.identities}
    />
  );
}
