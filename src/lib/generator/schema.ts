import { z } from "zod";
import type { CampaignAudience } from "@/lib/booth/types";
import { joinPageSchema, type JoinPage } from "@/lib/booth/programs";
import type { LeadMagnetIntake } from "./types";

/**
 * Shapes for the AI-drafted (or manual-draft) tenant setup. These are
 * intentionally LOOSER than src/lib/booth/programs.ts's real config schemas
 * (no cross-field refinements — OpenAI structured outputs can't express
 * those, and an operator is expected to edit the draft before it's real). The real
 * schemas are the ones that gate the APPLY action (src/lib/generator/apply.ts).
 */

// Plan V2: rungs carry an `options` array in the real schema (choice-aware
// grants — see src/lib/booth/programs.ts). The AI/manual draft only ever
// proposes a single option per rung (min:1 max:1) — owners add choices
// later in the dashboard; apply.ts passes this straight through unwrapped.
const draftLadderOptionSchema = z.object({
  reward: z.string().min(1),
  ring_up_note: z.string().nullable(),
});

const draftLadderRungSchema = z.object({
  visits: z.number().int().positive(),
  options: z.array(draftLadderOptionSchema).min(1).max(1),
});

const draftWelcomeConfigSchema = z.object({
  reward: z.string().min(1),
  ring_up_note: z.string().nullable(),
  valid_days: z.number().int().positive(),
});

const draftLadderConfigSchema = z.object({
  endowed_start: z.number().int().min(0),
  loop: z.boolean(),
  rungs: z.array(draftLadderRungSchema).min(1).max(4),
});

// Canonical shape needs mode ('window'|'month'), but the draft only ever
// proposes window mode — month mode is a prospective, dashboard-only owner
// choice (WS1 spec: "mode changes are prospective-only"), never AI-drafted.
const draftBirthdayConfigSchema = z.object({
  reward: z.string().min(1),
  mode: z.literal("window"),
  window_days: z.number().int().positive(),
});

// Canonical shape needs blocks-with-ids; the draft only ever proposes one
// block (id "b1") — its days_quiet is filled by apply.ts from the
// restaurant's current gone_quiet_weeks (the draft has no reliable source
// for that number), same as before Plan V2's blocks shape existed.
const draftComeBackBlockSchema = z.object({
  id: z.string().min(1),
  reward: z.string().min(1),
  valid_days: z.number().int().positive(),
});

const draftComeBackConfigSchema = z.object({
  blocks: z.array(draftComeBackBlockSchema).length(1),
});

const CAMPAIGN_AUDIENCES = ["all", "gone_quiet", "redeemed_before", "new"] as const satisfies readonly CampaignAudience[];

const draftCampaignSchema = z.object({
  body: z.string().min(1),
  audience: z.enum(CAMPAIGN_AUDIENCES),
  suggested_send_note: z.string().min(1),
});

function namedDraft<T extends z.ZodTypeAny>(config: T) {
  return z.object({ name: z.string().min(1), config });
}

export const generatedSetupSchema = z.object({
  welcome: namedDraft(draftWelcomeConfigSchema),
  ladder: namedDraft(draftLadderConfigSchema),
  birthday: namedDraft(draftBirthdayConfigSchema),
  come_back: namedDraft(draftComeBackConfigSchema),
  campaigns: z.array(draftCampaignSchema).length(4),
  // Not part of the AI structured-output call (see ai.ts) — filled
  // deterministically from the intake's lead-magnet choice, using WS1's
  // canonical joinPageSchema directly (no loosening needed, it has no
  // cross-field refinements). Null = operator picked no explicit magnet;
  // resolveJoinPage's default (ladder-if-exists else vip) applies.
  join_page: joinPageSchema.nullable(),
});

export type GeneratedSetup = z.infer<typeof generatedSetupSchema>;
export type DraftCampaign = z.infer<typeof draftCampaignSchema>;

/** Deterministic — not AI-authored. Ladder magnet never carries a program_id from the generator (the program doesn't exist yet); resolveJoinPage falls back to the first active ladder, which will be the one just created. */
export function joinPageFromLeadMagnet(leadMagnet: LeadMagnetIntake): JoinPage {
  const headline = leadMagnet.headline.trim() || undefined;
  switch (leadMagnet.choice) {
    case "vip":
      return { magnet: "vip", headline };
    case "custom":
      return { magnet: "custom", custom_text: leadMagnet.customText.trim(), headline };
    case "ladder":
    default:
      return { magnet: "ladder" };
  }
}

// ---------------------------------------------------------------------------
// Hand-written JSON Schema for OpenAI structured outputs (strict mode).
// Strict mode requires every property listed in `required` and
// `additionalProperties: false` on every object — optional fields become
// nullable instead of omittable, which is why the zod shapes above use
// `.nullable()` rather than `.optional()` for ring_up_note.
// ---------------------------------------------------------------------------

function namedConfigJsonSchema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      config: {
        type: "object",
        additionalProperties: false,
        properties,
        required,
      },
    },
    required: ["name", "config"],
  };
}

const ringUpNoteProp = { type: ["string", "null"] };

export const tenantSetupJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    welcome: namedConfigJsonSchema(
      { reward: { type: "string" }, ring_up_note: ringUpNoteProp, valid_days: { type: "integer" } },
      ["reward", "ring_up_note", "valid_days"]
    ),
    ladder: namedConfigJsonSchema(
      {
        endowed_start: { type: "integer" },
        loop: { type: "boolean" },
        rungs: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              visits: { type: "integer" },
              options: {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: { reward: { type: "string" }, ring_up_note: ringUpNoteProp },
                  required: ["reward", "ring_up_note"],
                },
              },
            },
            required: ["visits", "options"],
          },
        },
      },
      ["endowed_start", "loop", "rungs"]
    ),
    birthday: namedConfigJsonSchema(
      { reward: { type: "string" }, mode: { type: "string", enum: ["window"] }, window_days: { type: "integer" } },
      ["reward", "mode", "window_days"]
    ),
    come_back: namedConfigJsonSchema(
      {
        blocks: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: { id: { type: "string" }, reward: { type: "string" }, valid_days: { type: "integer" } },
            required: ["id", "reward", "valid_days"],
          },
        },
      },
      ["blocks"]
    ),
    campaigns: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          body: { type: "string" },
          audience: { type: "string", enum: [...CAMPAIGN_AUDIENCES] },
          suggested_send_note: { type: "string" },
        },
        required: ["body", "audience", "suggested_send_note"],
      },
    },
  },
  required: ["welcome", "ladder", "birthday", "come_back", "campaigns"],
} as const;
