/**
 * Canonical Manawyrm Hub Raid Lead Guide (Discord v2).
 *
 * Card format: guide-card.ts. Publishing: guide-publisher.ts.
 */
import { APP_URL, createGuideFormat, type GuideCard } from "@/guides/guide-card";
import { createGuidePublisher } from "@/guides/guide-publisher";

export const RAIDLEAD_GUIDE_FORMAT = createGuideFormat("raidlead");

/**
 * Six canonical Discord guide cards, written for a new Raid Lead. Each card answers
 * one question in a few steps and names the next step. Button names match the UI.
 */
export const RAIDLEAD_GUIDE_CARDS: readonly GuideCard[] = [
  {
    key: "raid-lead-basics",
    title: "📗 Raid Lead Guide: How do I get started?",
    description: [
      `**1.** Press the button below and sign in with **Discord**.`,
      `**2.** Open the **Dashboard**. **Boosting Control Center** shows what each run needs next, like **Build Roster** or **Start Run**.`,
      `**3.** Open **Manage** → **Runs** to see all your runs.`,
      ``,
      `You manage the runs you lead. No **Manage** menu? Ask an Admin for the Raid Lead role.`,
      ``,
      `**Next:** create a run.`,
    ].join("\n"),
    imageFile: "live-rl-01-dashboard.png",
    linkButton: { label: "Open Manawyrm Hub", url: APP_URL },
  },
  {
    key: "create-run",
    title: "🛠️ How do I create a run?",
    description: [
      `**1.** Open **Runs** and press **Create Run**.`,
      `**2.** Choose the **Product**, **Difficulty** and **Run type** (Saved, Unsaved, VIP or Community). Mythic runs can't be Saved.`,
      `**3.** Enter how many **Tanks**, **Healers** and **DPS** you need.`,
      `**4.** Set the start time under **Runs**, then press **Create 1 Draft**.`,
      ``,
      `Need more runs? Press **Add Run** first. Only you and Admins can manage a draft, and boosters can't see it yet.`,
      ``,
      `**Next:** open signups.`,
    ].join("\n"),
    imageFile: "live-rl-04-create-run.png",
  },
  {
    key: "open-manage-signups",
    title: "📣 How do I manage signups?",
    description: [
      `**1.** Open your run and press **Open Run**. You only see this button while the run is a draft, so it is not in the picture.`,
      `**2.** Boosters can now sign up. The Discord channel appears once the run's raid week is the current or next one.`,
      `**3.** Press **Close Signups** when you have enough. **Reopen Signups** opens them again.`,
      ``,
      `Plans changed? Use **Edit Run** or **Cancel Run** before the run starts. **Reactivate Run** brings a cancelled run back.`,
      ``,
      `**Next:** build your roster.`,
    ].join("\n"),
    imageFile: "live-rl-06-run-overview.png",
  },
  {
    key: "build-roster",
    title: "👥 How do I build my roster?",
    description: [
      `Signing up does not put anyone in the raid. You choose the team.`,
      ``,
      `**1.** Open the **Roster** tab of your run.`,
      `**2.** Under **Signups**, click a player to add them. Click again to remove them.`,
      `**3.** Press **Save** (it appears after your first change), then **Publish**. Your roster now shows in Discord.`,
      ``,
      `Short on people? **Auto Build Roster** fills the team for you, **Add Booster** adds someone by hand, and **Ping roles** asks Discord for missing roles.`,
      ``,
      `Changed something after publishing? Press **Update**.`,
      ``,
      `**Next:** start the run.`,
    ].join("\n"),
    imageFile: "live-rl-05-roster.png",
  },
  {
    key: "run-attendance",
    title: "▶️ How do I start and manage a run?",
    description: [
      `**1.** Open the **Operations** tab and fix anything that blocks the start.`,
      `**2.** Go back to **Roster** and press **Start Run**. Signups close and players get their Raid Invite.`,
      `**3.** During the raid, open **Attendance** and mark **Late**, **No show** or **Standby** when it happens.`,
      ``,
      `Someone didn't show up? Press **Replace** on their row.`,
      ``,
      `**Next:** finish the run.`,
    ].join("\n"),
    imageFile: "live-rl-08-start-run.png",
  },
  {
    key: "complete-run",
    title: "✅ How do I finish a run?",
    description: [
      `**1.** On **Attendance**, check that all exceptions are marked.`,
      `**2.** Press **Mark all unmarked as Present**.`,
      `**3.** Press **Complete Run**.`,
      ``,
      `Found a mistake later? Press **Correct Attendance** and give a reason.`,
      ``,
      `**Last step:** press **Archive Run** on the run's Discord signup message. This saves the chat and removes the channel. You can also use **Archive** in the **⋯** menu under **Manage** → **Runs**.`,
    ].join("\n"),
    imageFile: "rl-09-finish-run.png",
  },
] as const;

export const raidleadGuidePublisher = createGuidePublisher({
  format: RAIDLEAD_GUIDE_FORMAT,
  cards: RAIDLEAD_GUIDE_CARDS,
  contentErrors(cards) {
    const errors: string[] = [];
    const createCard = cards.find((c) => c.key === "create-run");
    if (createCard && !/Community/i.test(JSON.stringify(createCard))) {
      errors.push("create-run card must document Community run type");
    }
    const rosterCard = cards.find((c) => c.key === "build-roster");
    if (rosterCard && !/\*\*Publish\*\*/.test(JSON.stringify(rosterCard))) {
      errors.push("build-roster card must mention the Publish button");
    }
    // BoostingHub has no financial workflow: no card may describe payouts or settlements.
    if (cards.some((c) => /payout|settlement|mark paid/i.test(JSON.stringify(c)))) {
      errors.push("guide cards must not describe payouts or settlements");
    }
    return errors;
  },
});
