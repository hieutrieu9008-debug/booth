import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { IntakeInput } from "./types";

const KB_CHAR_LIMIT = 6000;

function readCopywritingKb(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), "docs", "copywriting-kb.md"), "utf8");
    return raw.length > KB_CHAR_LIMIT ? raw.slice(0, KB_CHAR_LIMIT) : raw;
  } catch {
    return "";
  }
}

/** System prompt — read at request time (never module scope) so a missing KB file doesn't break the build. */
export function buildSystemPrompt(): string {
  const kb = readCopywritingKb();
  return `You are drafting the complete tenant setup for a UK restaurant loyalty programme (Booth Loyalty), from a white-glove onboarding call's intake notes. You produce a welcome perk, a visit ladder, a birthday reward, a come-back (win-back) reward, and four draft marketing campaign texts.

HARD RULES:
- Use ONLY menu items, dishes, or prices the intake notes actually mention. Never invent a menu item, a number, or a price that isn't grounded in the notes. If the notes are thin, reuse the "easy to give away" items given rather than inventing new ones.
- Reward items over discounts: every reward should be a specific free item (e.g. "Free garlic bread"), never a percentage-off or a generic "discount".
- Never discount or promote on the nights the intake describes as busy — target the slow night(s) mentioned instead.
- Visit ladder: endowed_start defaults to 2 unless the intake gives a clear reason to differ. The first rung's visits must land within 2-3 visits of endowed_start (e.g. endowed_start 2 -> first rung 4, 5, or 6). Rungs must be strictly increasing by visits. Use 2-3 rungs.
- Birthday: mode is always "window" (month mode is an owner-only choice made later in the dashboard, never drafted here).
- Come-back: propose exactly one block with id "b1".
- If the intake lists included menu items, use those (with their real prices where given) ahead of the free-text menu/giveaway fields — never invent a dish not in the list.
- Respect the owner's giveaway comfort per price tier: "readily" means default to that tier for rewards; "rarely" means avoid it unless nothing else fits; "occasionally" sits in between. Higher-frequency rewards (welcome perk, first ladder rung) should lean toward tiers the owner is more comfortable giving away.
- UK English spelling and phrasing throughout (e.g. "flavour", "favourite").
- Every message must sound like a real person texting a regular, not ad copy. No emoji. No invented numbers or statistics. No stacked punctuation, no ALL CAPS, no spam-trigger words (FREE!!, WINNER, GUARANTEED, ACT NOW).
- Every campaign body MUST end with the exact phrase "Reply STOP to opt out." and the ENTIRE body including that phrase must be 160 characters or fewer.
- Produce exactly 4 campaign drafts, each with a distinct plausible audience from: all, gone_quiet, redeemed_before, new. Prefer segmented audiences (gone_quiet, redeemed_before) over "all" per the copywriting guide's segmentation principle.

Ground your copy style — tone, structure, message-type templates, UK register, anti-patterns to avoid — in the following knowledge base. Do not quote it verbatim; use it to shape the copy you write.
---
${kb || "(copywriting knowledge base unavailable — fall back to the hard rules above.)"}
---

Return only the structured JSON described by the response schema. No commentary.`;
}

export function buildUserPrompt(intake: IntakeInput): string {
  const includedItems = intake.menuItems.filter((m) => m.included);
  const menuFeed =
    includedItems.length > 0
      ? includedItems.map((m) => `${m.name}${m.price !== undefined ? ` — £${m.price.toFixed(2)}` : ""}${m.category ? ` (${m.category})` : ""}`).join("; ")
      : "(none selected)";

  const lines = [
    `Restaurant type / cuisine: ${intake.cuisine || "(not given)"}`,
    `Menu highlights + rough prices: ${intake.menuHighlights || "(not given)"}`,
    `Included menu items (from the menu import, use these ahead of the above): ${menuFeed}`,
    `Easy-to-give-away items: ${intake.giveawayItems || "(not given)"}`,
    `Margin comfort: ${intake.marginComfort || "(not given)"}`,
    `Giveaway comfort by price tier: cheap=${intake.giveawayComfort.cheap}, mid=${intake.giveawayComfort.mid}, premium=${intake.giveawayComfort.premium}`,
    `Slow nights: ${intake.slowNights || "(not given)"}`,
    `Average ticket: ${intake.avgTicket || "(not given)"}`,
    `Owner goals: ${intake.ownerGoals || "(not given)"}`,
    `Anything else from the call: ${intake.extraNotes || "(none)"}`,
  ];
  return `Call intake notes:\n${lines.join("\n")}\n\nDraft the welcome perk, visit ladder, birthday reward, come-back reward, and 4 campaign drafts.`;
}
