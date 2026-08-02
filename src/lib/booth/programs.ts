import { z } from "zod";
import type { RestaurantType, RewardProgram } from "./types";
import { validateTemplate } from "./template";

/**
 * Config shapes per reward_programs.type — documented in the migrations
 * (supabase/migrations/20260716000000_init.sql + 20260718000000_plan_v2.sql),
 * enforced here. Post-Plan-V2: canonical shapes only, no legacy branches.
 */

export const welcomeConfigSchema = z.object({
  reward: z.string().min(1),
  ring_up_note: z.string().min(1).optional(),
  valid_days: z.number().int().positive(),
});
export type WelcomeConfig = z.infer<typeof welcomeConfigSchema>;

const ladderOptionSchema = z.object({
  reward: z.string().min(1),
  ring_up_note: z.string().min(1).optional(),
});
export type LadderOption = z.infer<typeof ladderOptionSchema>;

const ladderRungSchema = z.object({
  visits: z.number().int().positive(),
  options: z.array(ladderOptionSchema).min(1),
});
export type LadderRung = z.infer<typeof ladderRungSchema>;

export const visitLadderConfigSchema = z
  .object({
    endowed_start: z.number().int().min(0),
    loop: z.boolean(),
    rungs: z.array(ladderRungSchema).min(1),
  })
  .superRefine((config, ctx) => {
    for (let i = 1; i < config.rungs.length; i++) {
      if (config.rungs[i].visits <= config.rungs[i - 1].visits) {
        ctx.addIssue({
          code: "custom",
          message: "rungs must be strictly increasing by visits",
          path: ["rungs", i, "visits"],
        });
      }
    }
    const firstRungVisits = config.rungs[0]?.visits;
    if (firstRungVisits !== undefined && config.endowed_start >= firstRungVisits) {
      ctx.addIssue({
        code: "custom",
        message: "endowed_start must be strictly less than the first rung's visits",
        path: ["endowed_start"],
      });
    }
  });
export type VisitLadderConfig = z.infer<typeof visitLadderConfigSchema>;

export const birthdayConfigSchema = z
  .object({
    reward: z.string().min(1),
    mode: z.enum(["window", "month"]).default("window"),
    window_days: z.number().int().positive().optional(),
    // WS-D — optional owner-authored message ({name} {reward} {restaurant}
    // {link}). Absent = the cron's coded fallback copy. Sent standalone
    // (the cron doesn't append a separate link), so it must carry {link}.
    message: z.string().min(1).optional(),
  })
  .superRefine((config, ctx) => {
    if (config.mode === "window" && config.window_days === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "window_days is required when mode is 'window'",
        path: ["window_days"],
      });
    }
    if (config.message !== undefined && validateTemplate(config.message, { requireLink: true }) === "missing_link") {
      ctx.addIssue({
        code: "custom",
        message: "Must include {link} so the member gets back to their card.",
        path: ["message"],
      });
    }
  });
export type BirthdayConfig = z.infer<typeof birthdayConfigSchema>;

const comeBackBlockSchema = z.object({
  id: z.string().min(1),
  days_quiet: z.number().int().positive(),
  reward: z.string().min(1),
  valid_days: z.number().int().positive(),
});
export type ComeBackBlock = z.infer<typeof comeBackBlockSchema>;

export const comeBackConfigSchema = z
  .object({
    blocks: z.array(comeBackBlockSchema).min(1),
    // Re-nudge guard: minimum days between automated win-back texts to the same
    // member (come-back cron only — never blocks manual blasts). 0 = off.
    // Missing on older/seeded configs -> defaults to 10.
    min_days_between_contact: z.number().int().min(0).default(10),
  })
  .superRefine((config, ctx) => {
    for (let i = 1; i < config.blocks.length; i++) {
      if (config.blocks[i].days_quiet <= config.blocks[i - 1].days_quiet) {
        ctx.addIssue({
          code: "custom",
          message: "blocks must be strictly increasing by days_quiet",
          path: ["blocks", i, "days_quiet"],
        });
      }
    }
    const seenIds = new Set<string>();
    config.blocks.forEach((block, i) => {
      if (seenIds.has(block.id)) {
        ctx.addIssue({ code: "custom", message: "block ids must be unique", path: ["blocks", i, "id"] });
      }
      seenIds.add(block.id);
    });
  });
export type ComeBackConfig = z.infer<typeof comeBackConfigSchema>;

export const anytimeConfigSchema = z.object({
  reward: z.string().min(1),
  per_member_limit: z.number().int().positive(),
});
export type AnytimeConfig = z.infer<typeof anytimeConfigSchema>;

export const timedConfigSchema = z.object({
  reward: z.string().min(1),
  starts_at: z.string(),
  ends_at: z.string(),
});
export type TimedConfig = z.infer<typeof timedConfigSchema>;

// ---------------------------------------------------------------------------
// 'custom' — the single, always-inactive per-restaurant bucket program that
// parents one-off per-member offers (Plan V3, WS-C deferral). It carries no
// meaningful config of its own (each grant off it stamps its own reward_text
// at issuance) — permissive/passthrough so the bucket never fails to parse
// regardless of what shape (today: `{}`) it was created with.
// ---------------------------------------------------------------------------

export const customConfigSchema = z.object({}).passthrough();
export type CustomConfig = z.infer<typeof customConfigSchema>;

export type ProgramConfig =
  | { type: "welcome"; config: WelcomeConfig }
  | { type: "visit_ladder"; config: VisitLadderConfig }
  | { type: "birthday"; config: BirthdayConfig }
  | { type: "come_back"; config: ComeBackConfig }
  | { type: "anytime"; config: AnytimeConfig }
  | { type: "timed"; config: TimedConfig }
  | { type: "custom"; config: CustomConfig };

/** Parses a reward_programs.config jsonb value against the schema for its type. Throws a ZodError on mismatch. */
export function parseProgramConfig(type: RestaurantType, json: unknown): ProgramConfig {
  switch (type) {
    case "welcome":
      return { type, config: welcomeConfigSchema.parse(json) };
    case "visit_ladder":
      return { type, config: visitLadderConfigSchema.parse(json) };
    case "birthday":
      return { type, config: birthdayConfigSchema.parse(json) };
    case "come_back":
      return { type, config: comeBackConfigSchema.parse(json) };
    case "anytime":
      return { type, config: anytimeConfigSchema.parse(json) };
    case "timed":
      return { type, config: timedConfigSchema.parse(json) };
    case "custom":
      return { type, config: customConfigSchema.parse(json) };
  }
}

// ---------------------------------------------------------------------------
// restaurants.menu_items — WS5 builds the import flow; no engine behavior here.
// ---------------------------------------------------------------------------

export const menuItemSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative().optional(),
  category: z.string().min(1).optional(),
});
export const menuItemsSchema = z.array(menuItemSchema);
export type MenuItem = z.infer<typeof menuItemSchema>;

// ---------------------------------------------------------------------------
// restaurants.join_page — lead-magnet framing for the /j/[slug] page [Cx2-22/23]
// ---------------------------------------------------------------------------

export const joinPageSchema = z.discriminatedUnion("magnet", [
  z.object({ magnet: z.literal("ladder"), program_id: z.string().uuid().optional() }),
  z.object({ magnet: z.literal("vip"), headline: z.string().min(1).optional() }),
  z.object({ magnet: z.literal("custom"), custom_text: z.string().min(1), headline: z.string().min(1).optional() }),
]);
export type JoinPage = z.infer<typeof joinPageSchema>;

export type JoinPageRenderModel =
  | { magnet: "ladder"; program: RewardProgram }
  | { magnet: "vip"; headline: string | null }
  | { magnet: "custom"; headline: string | null; customText: string };

/**
 * Concrete render model for the join page: an explicit valid+active
 * program_id wins; else the first active ladder; else vip framing. A null
 * config (never set) behaves the same as magnet:'ladder' with no program_id.
 */
export function resolveJoinPage(
  joinPage: JoinPage | null | undefined,
  activeLadders: RewardProgram[]
): JoinPageRenderModel {
  if (joinPage?.magnet === "custom") {
    return { magnet: "custom", headline: joinPage.headline ?? null, customText: joinPage.custom_text };
  }
  if (joinPage?.magnet === "vip") {
    return { magnet: "vip", headline: joinPage.headline ?? null };
  }
  if (joinPage?.magnet === "ladder" && joinPage.program_id) {
    const explicit = activeLadders.find((p) => p.id === joinPage.program_id);
    if (explicit) return { magnet: "ladder", program: explicit };
  }
  if (activeLadders.length > 0) return { magnet: "ladder", program: activeLadders[0] };
  return { magnet: "vip", headline: null };
}
