import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseMessageTemplates, parseRestaurantSettings, type MessageTemplates, type RestaurantSettings } from "./settings";

/** Server-side fetchers for restaurants.settings / .message_templates — kept separate from settings.ts so the pure zod schemas there stay importable from client components (e.g. the birthday editor's save-time validation). */

export async function getRestaurantSettings(restaurantId: string): Promise<RestaurantSettings> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("restaurants").select("settings").eq("id", restaurantId).single();
  if (error) throw error;
  return parseRestaurantSettings(data.settings);
}

export async function getMessageTemplates(restaurantId: string): Promise<MessageTemplates> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("restaurants").select("message_templates").eq("id", restaurantId).single();
  if (error) throw error;
  return parseMessageTemplates(data.message_templates);
}
