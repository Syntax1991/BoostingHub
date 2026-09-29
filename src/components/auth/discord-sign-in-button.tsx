"use client";

import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";

export function DiscordSignInButton({ callbackURL = "/dashboard" }: { callbackURL?: string }) {
  return (
    <Button
      className="w-full"
      onClick={() => {
        void authClient.signIn.social({ provider: "discord", callbackURL });
      }}
    >
      Continue with Discord
    </Button>
  );
}
