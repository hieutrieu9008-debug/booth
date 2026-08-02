"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { generateSetupWithAI } from "@/lib/generator/ai";
import { manualDraft } from "@/lib/generator/manual-draft";
import { applyGeneratedSetup, type ApplyResult } from "@/lib/generator/apply";
import { generatedSetupSchema, type GeneratedSetup } from "@/lib/generator/schema";
import type { IntakeInput } from "@/lib/generator/types";

export type GenerateResult = { usedAI: boolean; notice: string | null; draft: GeneratedSetup };

/** Tries AI, falls back to the manual draft (with a notice) if the key is missing or the call fails. */
export async function runGenerate(intake: IntakeInput): Promise<GenerateResult> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      usedAI: false,
      notice: "OPENAI_API_KEY is not set — showing a manual draft. Edit freely below, or add the key and try again.",
      draft: manualDraft(intake),
    };
  }
  try {
    const draft = await generateSetupWithAI(intake);
    return { usedAI: true, notice: null, draft };
  } catch (caught) {
    console.error("generateSetupWithAI failed", caught);
    const message = caught instanceof Error ? caught.message : "unknown error";
    return {
      usedAI: false,
      notice: `AI generation failed (${message}) — showing a manual draft. Edit freely below.`,
      draft: manualDraft(intake),
    };
  }
}

async function getRestaurantId(slug: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("restaurants").select("id").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Restaurant not found");
  return data.id;
}

export async function applySetup(slug: string, draftInput: GeneratedSetup, replaceExisting: boolean): Promise<ApplyResult> {
  // safeParse, not parse: the client may have edited the draft into an
  // invalid shape (e.g. cleared a required field to ""), and a throw here
  // used to reject the server action with no visible feedback (WS5 bug —
  // see docs/qa/ws5 repro notes). A structured error keeps the draft on
  // screen and tells the operator what to fix.
  const parsed = generatedSetupSchema.safeParse(draftInput);
  if (!parsed.success) {
    return { ok: false, conflict: false, errors: { _draft: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };
  }
  const restaurantId = await getRestaurantId(slug);
  const result = await applyGeneratedSetup(restaurantId, parsed.data, { replaceExisting });
  if (result.ok) revalidatePath(`/internal/${slug}`);
  return result;
}
