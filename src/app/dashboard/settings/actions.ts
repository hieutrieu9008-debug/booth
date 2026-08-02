"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerRestaurant } from "@/lib/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { messageTemplatesSchema, restaurantSettingsSchema, validateMessageTemplates } from "@/lib/booth/settings";
import { getMessageTemplates } from "@/lib/booth/settings-data";

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

export type UpdateSettingsInput = { extendNotifyDefault: boolean; expiryReminderDays: number };

export async function updateSettingsAction(input: UpdateSettingsInput): Promise<SettingsActionResult> {
  const restaurant = await requireOwnerRestaurant();
  const parsed = restaurantSettingsSchema.safeParse({
    version: 1,
    extend_notify_default: input.extendNotifyDefault,
    expiry_reminder_days: input.expiryReminderDays,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("restaurants").update({ settings: parsed.data }).eq("id", restaurant.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export type UpdateMessageTemplatesInput = { welcome: string; comeBack: string };

/**
 * Writes only the `welcome`/`come_back` keys of restaurants.message_templates
 * — merged onto whatever's already stored (reward_earned/reward_earned_choice
 * have no editor yet, so this must never clobber them). Blank input clears
 * that key back to the coded fallback copy (schema field goes undefined).
 */
export async function updateMessageTemplatesAction(input: UpdateMessageTemplatesInput): Promise<SettingsActionResult> {
  const restaurant = await requireOwnerRestaurant();
  const welcome = input.welcome.trim() || undefined;
  const comeBack = input.comeBack.trim() || undefined;

  const errors = validateMessageTemplates({ welcome, come_back: comeBack });
  if (Object.keys(errors).length > 0) return { ok: false, error: Object.values(errors)[0] };

  const current = await getMessageTemplates(restaurant.id);
  const parsed = messageTemplatesSchema.safeParse({ ...current, welcome, come_back: comeBack });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("restaurants").update({ message_templates: parsed.data }).eq("id", restaurant.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
