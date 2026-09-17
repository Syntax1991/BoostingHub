import { redirect } from "next/navigation";
import { authPageController } from "@/controllers/auth.controller";
import { LoginView } from "@/components/auth/login-view";
import { resolveSafeCallbackPath } from "@/auth/safe-callback-path";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const callbackURL = resolveSafeCallbackPath(rawNext);

  const data = await authPageController.getLoginPage();
  if (data.user) {
    redirect(callbackURL === "/" ? "/dashboard" : callbackURL);
  }

  return (
    <LoginView
      discordEnabled={data.discordEnabled}
      devAuthEnabled={data.devAuthEnabled}
      identities={data.identities}
      callbackURL={callbackURL}
    />
  );
}
