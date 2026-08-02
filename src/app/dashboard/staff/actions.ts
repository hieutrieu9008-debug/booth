"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerRestaurant } from "@/lib/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashStaffPin } from "@/lib/booth/tokens";

export type AddPinResult = { ok: true; pin: string } | { ok: false; error: string };

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function addStaffPin(label: string, requestedPin?: string): Promise<AddPinResult> {
  const restaurant = await requireOwnerRestaurant();
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return { ok: false, error: "Give this PIN a label (e.g. Front till)." };

  const pin = requestedPin?.trim() || randomPin();
  if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "PIN must be 4-6 digits." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("staff_pins").insert({
    restaurant_id: restaurant.id,
    label: trimmedLabel,
    pin_hash: hashStaffPin(pin),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That PIN is already in use, try another." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard/staff");
  return { ok: true, pin };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function deactivateStaffPin(pinId: string): Promise<ActionResult> {
  const restaurant = await requireOwnerRestaurant();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("staff_pins")
    .update({ active: false })
    .eq("id", pinId)
    .eq("restaurant_id", restaurant.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/staff");
  return { ok: true };
}
