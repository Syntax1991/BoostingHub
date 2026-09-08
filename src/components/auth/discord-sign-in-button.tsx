"use client";

import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";

export function DiscordSignInButton() {
  return (
    <Button
      className="w-full"
      onClick={() => {
        void authClient.signIn.social({ provider: "discord", callbackURL: "/dashboard" });
      }}
    >
      Continue with Discord
    </Button>
  );
}
