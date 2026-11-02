/**
 * Canonical Manawyrm Hub Booster Guide (Discord v2).
 *
 * Card format: guide-card.ts. Publishing: guide-publisher.ts.
 */
import { APP_URL, createGuideFormat, type GuideCard } from "@/guides/guide-card";
import { createGuidePublisher } from "@/guides/guide-publisher";

export const BOOSTER_GUIDE_FORMAT = createGuideFormat("booster");

/**
 * Five canonical Discord guide cards, written for a new Booster. Each card answers
 * one question in a few steps and names the next step. Button names match the UI.
 */
export const BOOSTER_GUIDE_CARDS: readonly GuideCard[] = [
  {
    key: "getting-started",
    title: "📘 Booster Guide: How do I get started?",
    description: [
      `**1.** Press the button below and sign in with **Discord**.`,
      `**2.** The **Dashboard** shows your next run and all upcoming runs.`,
      `**3.** Open **Characters** and look for the **BOOSTER** tag next to **Boosting roles**.`,
      ``,
      `No tag yet? Press **Apply via Discord** on that page, or ask staff. You can still join runs as a Lootbuddy without it.`,
      ``,
      `**Next:** add your characters.`,
    ].join("\n"),
    imageFile: "live-bo-01-dashboard.png",
    linkButton: { label: "Open Manawyrm Hub", url: APP_URL },
  },
  {
    key: "characters",
    title: "🧙 How do I add my characters?",
    description: [
      `**1.** Open **Characters** and press **Add Character**.`,
      `**2.** Paste the character's Raider.IO link.`,
      `**3.** Choose the specs you play, then press **Add character**.`,
      ``,
      `Your specs decide which roles you can offer.`,
      ``,
      `Busy this week? Press **⋯** on the character and choose **Availability**.`,
      ``,
      `**Next:** sign up for a run.`,
    ].join("\n"),
    imageFile: "live-bo-02-characters.png",
  },
  {
    key: "signing-up",
    title: "📝 How do I sign up for a run?",
    description: [
      `**1.** Open **Runs** and press **Sign up** on the run you want.`,
      `**2.** Tick your characters and the roles you can play.`,
      `**3.** Press **Save Booster Offers**.`,
      ``,
      `Here for loot? Under **Lootbuddies**, choose a class and press **Save Lootbuddies**. You can do both.`,
      ``,
      `Signing up does not put you in the raid yet. The Raid Lead picks the team.`,
      ``,
      `**Next:** see what happens after you sign up. Prefer Discord? Read the next card first.`,
    ].join("\n"),
    imageFile: "live-bo-04-signup.png",
  },
  {
    key: "discord-signups",
    title: "⚡ How do I sign up through Discord?",
    description: [
      `Every open run has its own Discord channel with a signup message. Use its buttons:`,
    ].join("\n"),
    fields: [
      {
        name: "Signup",
        value: "Choose your characters and press **Next**. Choose your roles and press **Confirm Signup**.",
      },
      {
        name: "Quick Sign",
        value: "One click signs up all your available characters with their main role. The Raid Lead still picks the team.",
      },
      {
        name: "LB",
        value: "Sign up as a Lootbuddy and pick one or more classes.",
      },
      {
        name: "Unsign",
        value: "Removes all your signups for this run. If you are on the roster, you must give a reason. Once the run has started, talk to your Raid Lead.",
      },
      {
        name: "Add / Edit Note",
        value: "Leave a short note for the Raid Lead. Sign up first.",
      },
    ],
    imageFile: null,
  },
  {
    key: "after-signing-up",
    title: "✅ What happens after I sign up?",
    description: [
      `Open **My Runs** to see your status:`,
      ``,
      `**Pending:** the Raid Lead has not decided yet.`,
      `**Selected:** you are on the roster.`,
      `**Not Selected:** you were not picked this time.`,
      `**Withdrawn:** you left the run.`,
      ``,
      `You get a notification if you are picked or removed, and a Raid Invite when the run starts.`,
      ``,
      `Can't make it? Press **Withdraw** on **My Runs**. In Discord, \`/mysignups\` shows your signups.`,
      ``,
      `**Next:** be ready when your run starts. Good luck!`,
    ].join("\n"),
    imageFile: "live-bo-05-my-runs.png",
  },
] as const;

/** Discord embed payload (API shape) for one card — no attachments. */

export const boosterGuidePublisher = createGuidePublisher({
  format: BOOSTER_GUIDE_FORMAT,
  cards: BOOSTER_GUIDE_CARDS,
  contentErrors(cards) {
    const errors: string[] = [];
    const discordCard = cards.find((c) => c.key === "discord-signups");
    if (discordCard && !/Quick Sign/.test(JSON.stringify(discordCard))) {
      errors.push("discord-signups card must mention Quick Sign");
    }
    const webCard = cards.find((c) => c.key === "signing-up");
    if (webCard && /Web Quick Signup|website Quick Signup button/i.test(JSON.stringify(webCard))) {
      errors.push("signing-up must not claim a Web Quick Signup button");
    }
    return errors;
  },
});
