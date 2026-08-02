"use server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type BookCallState = {
  status: "idle" | "error" | "success";
  error?: string;
  fieldErrors?: { name?: string; restaurantName?: string; phone?: string; email?: string };
};

export async function bookCallAction(_state: BookCallState, formData: FormData): Promise<BookCallState> {
  const name = String(formData.get("name") ?? "").trim();
  const restaurantName = String(formData.get("restaurantName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  const fieldErrors: NonNullable<BookCallState["fieldErrors"]> = {};
  if (!name) fieldErrors.name = "Enter your name.";
  if (!restaurantName) fieldErrors.restaurantName = "Enter your restaurant name.";
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 8 || phoneDigits.length > 15) fieldErrors.phone = "That number doesn't look right.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "That email doesn't look right.";
  if (Object.keys(fieldErrors).length) return { status: "error", fieldErrors };

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("leads").insert({
      name,
      restaurant_name: restaurantName,
      phone,
      email: email || null,
    });
    if (error) throw error;
    return { status: "success" };
  } catch (caught) {
    console.error(caught);
    return { status: "error", error: "We couldn't send that. Please try again." };
  }
}
