"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashStaffPin } from "@/lib/booth/tokens";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VISIT_MODES = ["staff_scan", "self_scan", "both"];

export type CreateRestaurantState = {
  status: "idle" | "error" | "success";
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createRestaurantAction(
  _prevState: CreateRestaurantState,
  formData: FormData
): Promise<CreateRestaurantState> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const phonePrefix = String(formData.get("phone_prefix") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim();
  const avgTicketRaw = String(formData.get("avg_ticket") ?? "").trim();
  const visitMode = String(formData.get("visit_mode") ?? "staff_scan");
  const brandColor = String(formData.get("brand_color") ?? "").trim() || "#F26649";
  const ownerEmail = String(formData.get("owner_email") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Enter a restaurant name.";
  if (!SLUG_RE.test(slug)) fieldErrors.slug = "Lowercase letters, numbers, hyphens only (e.g. demo-kitchen).";
  if (!timezone) fieldErrors.timezone = "Select a timezone.";
  if (!phonePrefix) fieldErrors.phone_prefix = "Select a phone prefix.";
  if (!currency) fieldErrors.currency = "Select a currency.";
  if (!VISIT_MODES.includes(visitMode)) fieldErrors.visit_mode = "Pick a visit mode.";

  let avgTicket: number | null = null;
  if (avgTicketRaw) {
    avgTicket = Number(avgTicketRaw);
    if (!Number.isFinite(avgTicket) || avgTicket < 0) fieldErrors.avg_ticket = "Enter a valid number.";
  }
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors };

  const admin = createSupabaseAdminClient();
  const { data: restaurant, error } = await admin
    .from("restaurants")
    .insert({
      name,
      slug,
      timezone,
      phone_prefix: phonePrefix,
      currency,
      avg_ticket: avgTicket,
      visit_mode: visitMode,
      brand_color: brandColor,
    })
    .select("id")
    .single();

  if (error) {
    return { status: "error", error: error.code === "23505" ? "That slug is already taken." : error.message };
  }

  if (ownerEmail) {
    // Invite flow (deliberate): the owner receives a set-password email
    // and chooses their own password — no temp passwords over the phone.
    const { data: userData, error: userError } = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password`,
    });
    if (userError) {
      return { status: "error", error: `Restaurant created, but the owner invite failed: ${userError.message}` };
    }
    const { error: linkError } = await admin.from("restaurants").update({ owner_id: userData.user.id }).eq("id", restaurant.id);
    if (linkError) return { status: "error", error: `Restaurant created, but linking the owner failed: ${linkError.message}` };
  }

  revalidatePath("/internal");
  return { status: "success" };
}

export type StaffPinState = { status: "idle" | "error" | "success"; error?: string };

export async function addStaffPinAction(
  restaurantId: string,
  slug: string,
  _prevState: StaffPinState,
  formData: FormData
): Promise<StaffPinState> {
  const label = String(formData.get("label") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!label) return { status: "error", error: "Enter a label." };
  if (!/^\d{4,6}$/.test(pin)) return { status: "error", error: "PIN must be 4-6 digits." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("staff_pins").insert({
    restaurant_id: restaurantId,
    label,
    pin_hash: hashStaffPin(pin),
  });
  if (error) return { status: "error", error: error.message };

  revalidatePath(`/internal/${slug}`);
  return { status: "success" };
}
