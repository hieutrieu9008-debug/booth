"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { menuItemsSchema, type MenuItem } from "@/lib/booth/programs";
import { parseMenuText } from "@/lib/generator/menu-parser";
import { parseMenuWithAI } from "@/lib/generator/ai";
import { newVenueToken } from "@/lib/booth/tokens";
import { openHoursSchema, type OpenHours } from "@/lib/booth/open-hours";
import { provisionNumber as provisionNumberCore, type ProvisionResult } from "./provision-number";

/** Thin "use server" wrapper — the real implementation lives in provision-number.ts (see its docstring for why). */
export async function provisionNumber(restaurantId: string): Promise<ProvisionResult> {
  return provisionNumberCore(restaurantId);
}

export type ProvisionNumberFormState = { status: "idle" | "error" | "success"; error?: string; phoneNumber?: string };

export async function provisionNumberAction(
  restaurantId: string,
  slug: string,
  _prevState: ProvisionNumberFormState,
  _formData: FormData,
): Promise<ProvisionNumberFormState> {
  const result = await provisionNumberCore(restaurantId);
  revalidatePath(`/internal/${slug}`);
  return result.ok ? { status: "success", phoneNumber: result.phoneNumber } : { status: "error", error: result.reason };
}

// ---------------------------------------------------------------------------
// Menu import (WS5 item 3)
// ---------------------------------------------------------------------------

export type ParseMenuResult = { items: MenuItem[]; usedAI: boolean; notice: string | null };

/**
 * Deterministic parse first; AI-assist (existing generator OPENAI path) only
 * kicks in as a fallback when the deterministic pass finds nothing AND a key
 * is configured — never silently overrides a decent deterministic result.
 */
export async function parseMenuAction(text: string): Promise<ParseMenuResult> {
  const deterministic = parseMenuText(text);
  if (deterministic.length > 0) return { items: deterministic, usedAI: false, notice: null };
  if (!process.env.OPENAI_API_KEY) {
    return { items: [], usedAI: false, notice: "No items found in the pasted text. Edit the rows below manually." };
  }
  try {
    const items = await parseMenuWithAI(text);
    return { items, usedAI: true, notice: items.length > 0 ? "AI-assisted parse — review before saving." : "No items found. Edit the rows below manually." };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "unknown error";
    return { items: [], usedAI: false, notice: `AI-assist failed (${message}). Edit the rows below manually.` };
  }
}

export type SaveMenuState = { status: "idle" | "error" | "success"; error?: string };

export async function saveMenuItemsAction(restaurantId: string, slug: string, items: MenuItem[]): Promise<SaveMenuState> {
  const parsed = menuItemsSchema.safeParse(items);
  if (!parsed.success) return { status: "error", error: parsed.error.issues.map((i) => i.message).join("; ") };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("restaurants").update({ menu_items: parsed.data }).eq("id", restaurantId);
  if (error) return { status: "error", error: error.message };

  revalidatePath(`/internal/${slug}`);
  revalidatePath(`/internal/${slug}/generate`);
  return { status: "success" };
}

// ---------------------------------------------------------------------------
// Self check-in provisioning (WS-B item 4): self_scan_token + visit_mode +
// open_hours. No editor existed for these before this chunk.
// ---------------------------------------------------------------------------

export type GenerateSelfScanTokenState = { status: "idle" | "error" | "success"; error?: string; token?: string };

/** Generates + saves a fresh venue-wide check-in token (crypto-random, never client-supplied). */
export async function generateSelfScanTokenAction(restaurantId: string, slug: string): Promise<GenerateSelfScanTokenState> {
  const token = newVenueToken();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("restaurants").update({ self_scan_token: token }).eq("id", restaurantId);
  if (error) return { status: "error", error: error.message };

  revalidatePath(`/internal/${slug}`);
  return { status: "success", token };
}

const VISIT_MODES = ["staff_scan", "self_scan", "both"] as const;

export type SelfScanSettingsState = { status: "idle" | "error" | "success"; error?: string };

export async function saveSelfScanSettingsAction(
  restaurantId: string,
  slug: string,
  input: { visitMode: string; openHours: OpenHours }
): Promise<SelfScanSettingsState> {
  if (!(VISIT_MODES as readonly string[]).includes(input.visitMode)) {
    return { status: "error", error: "Invalid check-in mode." };
  }
  const parsedHours = openHoursSchema.safeParse(input.openHours);
  if (!parsedHours.success) {
    return { status: "error", error: parsedHours.error.issues.map((i) => i.message).join("; ") };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("restaurants")
    .update({ visit_mode: input.visitMode, open_hours: parsedHours.data })
    .eq("id", restaurantId);
  if (error) return { status: "error", error: error.message };

  revalidatePath(`/internal/${slug}`);
  return { status: "success" };
}
