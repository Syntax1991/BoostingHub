/**
 * Run-facing display identity of a Raid Lead: their Raid Lead nickname
 * (`User.discordRunChannelNickname`, set in Settings) when present, else the
 * account name. Used for the Run title, the Discord Run channel and Run views;
 * account surfaces (profile, user management, audit) keep `User.name`.
 */
export function getRaidLeadDisplayName(user: {
  name: string;
  discordRunChannelNickname?: string | null;
}): string {
  const nickname = user.discordRunChannelNickname?.trim();
  return nickname && nickname.length > 0 ? nickname : user.name;
}
