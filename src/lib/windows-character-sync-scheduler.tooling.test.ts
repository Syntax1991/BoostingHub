import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const windowsDir = join(process.cwd(), "scripts", "windows");

const expectedScripts = [
  "character-sync-task.common.ps1",
  "install-character-sync-task.ps1",
  "status-character-sync-task.ps1",
  "remove-character-sync-task.ps1",
  "run-character-sync-task.ps1",
] as const;

function readScript(name: string): string {
  return readFileSync(join(windowsDir, name), "utf8");
}

describe("Windows character sync scheduler tooling", () => {
  it("ships the expected PowerShell scripts", () => {
    const present = new Set(readdirSync(windowsDir));
    for (const name of expectedScripts) {
      expect(present.has(name), `missing ${name}`).toBe(true);
    }
  });

  it("uses one stable task name and a 15-minute interval", () => {
    const common = readScript("character-sync-task.common.ps1");
    expect(common).toMatch(/CharacterSyncTaskName\s*=\s*"BoostingHub Character Sync"/);
    expect(common).toMatch(/CharacterSyncIntervalMinutes\s*=\s*15\b/);
    expect(common).not.toMatch(/CharacterSyncIntervalMinutes\s*=\s*120\b/);
  });

  it("derives the repository root relative to scripts/windows (no hardcoded checkout path)", () => {
    const common = readScript("character-sync-task.common.ps1");
    expect(common).toMatch(/Join-Path \$script:WindowsScriptsDir ["']\.\.\\\.\.["']/);
    const all = expectedScripts.map(readScript).join("\n");
    expect(all).not.toMatch(/D:\\Projects\\BoostingHub/i);
    expect(all).not.toMatch(/D:\/Projects\/BoostingHub/i);
  });

  it("wrapper invokes the existing npm sync command and supports dry-run", () => {
    const run = readScript("run-character-sync-task.ps1");
    expect(run).toMatch(/sync:characters/);
    expect(run).toMatch(/Resolve-NpmCmdPath|Get-Command/);
    expect(run).toMatch(/DryRun/);
    expect(run).toMatch(/--dry-run/);
    expect(run).not.toMatch(/setInterval|while\s*\(\s*true\s*\)/i);
  });

  it("installer is gated on dry-run and registers IgnoreNew overlap defense", () => {
    const install = readScript("install-character-sync-task.ps1");
    expect(install).toMatch(/-DryRun/);
    expect(install).toMatch(/Register-ScheduledTask|Set-ScheduledTask/);
    expect(install).toMatch(/IgnoreNew/);
    expect(install).toMatch(/RepetitionInterval/);
    expect(install).toMatch(/CharacterSyncIntervalMinutes|15/);
  });

  it("remove script targets only the exact BoostingHub Character Sync task", () => {
    const remove = readScript("remove-character-sync-task.ps1");
    expect(remove).toMatch(/Unregister-ScheduledTask/);
    expect(remove).toMatch(/CharacterSyncTaskName/);
    expect(remove).not.toMatch(/Unregister-ScheduledTask\s+-TaskName\s+"BoostingHub"/);
    expect(remove).not.toMatch(/Get-ScheduledTask\s+\|\s*Unregister/);
  });

  it("does not embed credentials or application secrets", () => {
    const all = expectedScripts.map(readScript).join("\n");
    expect(all).not.toMatch(/DATABASE_URL\s*=/);
    expect(all).not.toMatch(/BETTER_AUTH_SECRET/);
    expect(all).not.toMatch(/DISCORD_BOT_TOKEN|DISCORD_TOKEN/);
    expect(all).not.toMatch(/BLIZZARD_CLIENT_SECRET|BATTLENET_CLIENT_SECRET/);
    expect(all).not.toMatch(/-Password\s|Register-ScheduledTask.*Password/i);
    expect(all).not.toMatch(/ConvertTo-SecureString/);
  });

  it("logs under gitignored .local/logs with simple rotation", () => {
    const common = readScript("character-sync-task.common.ps1");
    expect(common).toMatch(/\.local\\logs\\character-sync\.log/);
    expect(common).toMatch(/CharacterSyncLogMaxBytes|Rotate-CharacterSyncLogIfNeeded/);
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.local\/$/m);
  });
});
