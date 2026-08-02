import { z } from "zod";
import { validateTemplate } from "./template";

/**
 * WS-D — restaurants.settings and restaurants.message_templates jsonb.
 * Both are app-validated (not DB-validated), version-tagged per
 * ARCHITECTURE.md's config-versioning convention. This module owns parsing
 * both columns so the read side (Settings page, engine.ts's notify path,
 * WS-E's expiry-reminder cron) all agree on the same shape and defaults.
 */

export const restaurantSettingsSchema = z.object({
  version: z.literal(1).default(1),
  extend_notify_default: z.boolean().default(true),
  expiry_reminder_days: z.number().int().positive().default(3),
});
export type RestaurantSettings = z.infer<typeof restaurantSettingsSchema>;

/** Parses restaurants.settings jsonb, applying coded defaults for any missing/absent keys (including `{}`). */
export function parseRestaurantSettings(json: unknown): RestaurantSettings {
  const parsed = restaurantSettingsSchema.safeParse(json ?? {});
  if (parsed.success) return parsed.data;
  // A malformed row (shouldn't happen — this module is the only writer)
  // still gets a usable default rather than throwing in a read path.
  return restaurantSettingsSchema.parse({});
}

export const messageTemplatesSchema = z.object({
  version: z.literal(1).default(1),
  welcome: z.string().min(1).optional(),
  reward_earned: z.string().min(1).optional(),
  reward_earned_choice: z.string().min(1).optional(),
  come_back: z.string().min(1).optional(),
});
export type MessageTemplates = z.infer<typeof messageTemplatesSchema>;

export function parseMessageTemplates(json: unknown): MessageTemplates {
  const parsed = messageTemplatesSchema.safeParse(json ?? {});
  if (parsed.success) return parsed.data;
  return messageTemplatesSchema.parse({});
}

/** Every template key here is sent standalone (the sender appends no separate card link), so each must carry {link} itself. */
const TEMPLATE_KEYS_REQUIRING_LINK: (keyof Omit<MessageTemplates, "version">)[] = [
  "welcome",
  "reward_earned",
  "reward_earned_choice",
  "come_back",
];

/** Save-time validation for the Settings/birthday-editor template forms — returns field->error, empty when clean. */
export function validateMessageTemplates(templates: Partial<Record<string, string>>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of TEMPLATE_KEYS_REQUIRING_LINK) {
    const value = templates[key];
    if (!value) continue;
    if (validateTemplate(value, { requireLink: true }) === "missing_link") {
      errors[key] = "Must include {link} so the member gets back to their card.";
    }
  }
  return errors;
}
