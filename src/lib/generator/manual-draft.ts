import { joinPageFromLeadMagnet, type GeneratedSetup } from "./schema";
import type { IntakeInput } from "./types";

/** First non-empty comma/line-separated item from a free-text field, or a fallback. */
function firstItem(text: string, fallback: string): string {
  const item = text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return item || fallback;
}

/**
 * Sensible defaults (shaped like supabase/seed.sql's demo tenant) for when
 * OPENAI_API_KEY is unset. An operator edits these on the review screen — this is
 * a starting point, not a real draft.
 */
export function manualDraft(intake: IntakeInput): GeneratedSetup {
  // Menu import feed: prefer an included, structured menu item over the
  // free-text fields when the operator has selected one during intake.
  const includedItems = intake.menuItems.filter((m) => m.included).sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const giveaway = includedItems[0]?.name ?? firstItem(intake.giveawayItems, firstItem(intake.menuHighlights, "starter"));
  const secondReward = includedItems[1] ? `Free ${includedItems[1].name}` : "Free main course";

  const campaignBody = (text: string) => {
    const suffix = " Reply STOP to opt out.";
    const max = 160 - suffix.length;
    return (text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text) + suffix;
  };

  return {
    welcome: {
      name: "Welcome perk",
      config: {
        reward: `Free ${giveaway} with your next order`,
        ring_up_note: `1x ${giveaway}, no charge`,
        valid_days: 14,
      },
    },
    ladder: {
      name: "Visit rewards",
      config: {
        endowed_start: 2,
        loop: true,
        rungs: [
          { visits: 6, options: [{ reward: `Free ${giveaway}`, ring_up_note: `1x ${giveaway}, no charge` }] },
          { visits: 10, options: [{ reward: secondReward, ring_up_note: "1x main, no charge" }] },
        ],
      },
    },
    birthday: {
      name: "Birthday treat",
      config: { reward: `Free ${giveaway}`, mode: "window", window_days: 14 },
    },
    come_back: {
      name: "We miss you",
      config: { blocks: [{ id: "b1", reward: `Free ${giveaway} when you come back`, valid_days: 14 }] },
    },
    campaigns: [
      {
        body: campaignBody(`[Name], you've got a reward waiting — come use it this week.`),
        audience: "redeemed_before",
        suggested_send_note: "MANUAL DRAFT — edit before scheduling. Send early week, 10:30-11am.",
      },
      {
        body: campaignBody(
          intake.slowNights ? `Fancy popping in ${firstItem(intake.slowNights, "this week")}? Your usual's on us.` : `Fancy popping in this week? Your usual's on us.`
        ),
        audience: "gone_quiet",
        suggested_send_note: "MANUAL DRAFT — edit before scheduling. Target the slow night from the intake.",
      },
      {
        body: campaignBody(`Thanks for joining! We'll text with the odd deal, never spam.`),
        audience: "new",
        suggested_send_note: "MANUAL DRAFT — edit before scheduling.",
      },
      {
        body: campaignBody(`It's quiet in tonight — pop in for something on us.`),
        audience: "all",
        suggested_send_note: "MANUAL DRAFT — edit before scheduling. Segment before sending; avoid full-list messages.",
      },
    ],
    join_page: joinPageFromLeadMagnet(intake.leadMagnet),
  };
}
