import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getMessageTemplates, getRestaurantSettings } from "@/lib/booth/settings-data";
import { PLATFORM_QUIET_START, PLATFORM_QUIET_END } from "@/lib/sms/quiet-hours";
import type { MessageTemplates, RestaurantSettings } from "@/lib/booth/settings";

export type SettingsPageData = {
  timezone: string;
  country: string;
  currency: string;
  tenantQuietStart: number;
  tenantQuietEnd: number;
  platformQuietStart: number;
  platformQuietEnd: number;
  settings: RestaurantSettings;
  messageTemplates: MessageTemplates;
};

export async function getSettingsPageData(restaurantId: string): Promise<SettingsPageData> {
  const admin = createSupabaseAdminClient();
  const [{ data: restaurant, error }, settings, messageTemplates] = await Promise.all([
    admin
      .from("restaurants")
      .select("timezone, country, currency, quiet_hours_start, quiet_hours_end")
      .eq("id", restaurantId)
      .single(),
    getRestaurantSettings(restaurantId),
    getMessageTemplates(restaurantId),
  ]);
  if (error) throw error;
  return {
    timezone: restaurant.timezone,
    country: restaurant.country,
    currency: restaurant.currency,
    tenantQuietStart: restaurant.quiet_hours_start,
    tenantQuietEnd: restaurant.quiet_hours_end,
    platformQuietStart: PLATFORM_QUIET_START,
    platformQuietEnd: PLATFORM_QUIET_END,
    settings,
    messageTemplates,
  };
}
