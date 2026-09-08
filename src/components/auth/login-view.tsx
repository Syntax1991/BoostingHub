import { ROLE_LABELS } from "@/lib/labels";
import { signInWithDevIdentity } from "@/controllers/auth.actions";
import { DiscordSignInButton } from "@/components/auth/discord-sign-in-button";
import { Card, PageHeader } from "@/components/ui/primitives";
import type { AccountRole } from "@/models/enums";

type Identity = {
  id: string;
  name: string;
  email: string | null;
  accountRole: string;
  image: string | null;
};

export function LoginView({
  discordEnabled,
  devAuthEnabled,
  identities,
}: {
  discordEnabled: boolean;
  devAuthEnabled: boolean;
  identities: Identity[];
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 font-mono font-bold text-accent">
          BB
        </div>
        <div>
          <p className="text-lg font-semibold">Boostting Bot</p>
          <p className="text-sm text-muted">Internal boosting operations</p>
        </div>
      </div>
      <PageHeader
        title="Sign in"
        description="Discord is the production identity. Development login exists only when DEV_AUTH_ENABLED=true and NODE_ENV is not production."
      />
      <div className="grid gap-4">
        <Card>
          <div className="space-y-3 px-4 py-4">
            <h2 className="text-sm font-semibold">Discord</h2>
            {discordEnabled ? (
              <DiscordSignInButton />
            ) : (
              <p className="text-sm text-muted">
                Discord OAuth is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to enable it.
              </p>
            )}
          </div>
        </Card>
        {devAuthEnabled ? (
          <Card>
            <div className="px-4 py-4">
              <h2 className="text-sm font-semibold text-warning">Development identities</h2>
              <p className="mt-1 text-xs text-muted">
                This panel is intentionally obvious and is compiled out of production by a runtime guard.
              </p>
              <div className="mt-4 grid gap-2">
                {identities.map((identity) => (
                  <form key={identity.id} action={signInWithDevIdentity}>
                    <input type="hidden" name="userId" value={identity.id} />
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm hover:bg-warning/15"
                    >
                      <span>
                        <span className="font-medium">{identity.name}</span>
                        <span className="ml-2 text-xs text-muted">{identity.email}</span>
                      </span>
                      <span className="text-xs uppercase tracking-wide text-warning">
                        {ROLE_LABELS[identity.accountRole as AccountRole]}
                      </span>
                    </button>
                  </form>
                ))}
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
