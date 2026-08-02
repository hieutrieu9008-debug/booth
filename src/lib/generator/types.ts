import type { MenuItem } from "@/lib/booth/programs";

/** Owner's stated comfort giving away items at a price tier. */
export type GiveawayComfort = "readily" | "occasionally" | "rarely";

export type LeadMagnetChoice = "ladder" | "vip" | "custom";

export type LeadMagnetIntake = {
  choice: LeadMagnetChoice;
  headline: string; // used by vip/custom, optional in practice
  customText: string; // required when choice === "custom"
};

export const EMPTY_LEAD_MAGNET: LeadMagnetIntake = { choice: "ladder", headline: "", customText: "" };

/** A menu_items row plus the operator's include/exclude decision for this draft. */
export type MenuItemSelection = MenuItem & { included: boolean };

/** Free-text intake answers captured from the white-glove onboarding call (PRD §4), plus WS5's structured extensions. */
export type IntakeInput = {
  cuisine: string; // restaurant type / cuisine
  menuHighlights: string; // menu highlights + rough prices
  giveawayItems: string; // "easy to give away" items
  marginComfort: string; // margin comfort
  slowNights: string; // slow nights
  avgTicket: string; // avg ticket (free text — owner's own words, e.g. "£18-22")
  ownerGoals: string; // owner goals
  extraNotes: string; // anything else from the call
  // WS5 extensions:
  menuItems: MenuItemSelection[]; // pulled from restaurants.menu_items, per-item include/exclude
  giveawayComfort: { cheap: GiveawayComfort; mid: GiveawayComfort; premium: GiveawayComfort };
  leadMagnet: LeadMagnetIntake;
};

export const EMPTY_INTAKE: IntakeInput = {
  cuisine: "",
  menuHighlights: "",
  giveawayItems: "",
  marginComfort: "",
  slowNights: "",
  avgTicket: "",
  ownerGoals: "",
  extraNotes: "",
  menuItems: [],
  giveawayComfort: { cheap: "readily", mid: "occasionally", premium: "rarely" },
  leadMagnet: EMPTY_LEAD_MAGNET,
};
