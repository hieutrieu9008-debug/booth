"use server";
import { JoinCapExceededError, SuppressedPhoneError, joinMember } from "@/lib/booth";
import { consentVersionFor } from "@/lib/booth/consent";
import { formatPhoneNational, isValidBirthday, normalizePhone } from "@/lib/booth/format";
import { sendWelcomeCardLink } from "@/lib/booth/links";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// NOTE: "use server" modules may only export async functions — the initial
// state value lives in join-form.tsx (exporting a const from here silently
// breaks client hydration).
export type JoinState = { status: "idle" | "error" | "success" | "opted_out"; error?: string; fieldErrors?: { name?: string; phone?: string; consent?: string; birthday?: string }; result?: { name: string; phone: string; cardUrl: string; welcomeReward: string | null; repeatJoin: boolean } };
const JOIN_THROTTLE_WINDOW_MS = 60 * 60 * 1000;
const JOIN_THROTTLE_MAX = 30;

export async function joinAction(slug: string, _state: JoinState, formData: FormData): Promise<JoinState> {
  // Honeypot: real visitors never see or fill this field (hidden in join-form.tsx).
  // A non-empty value means a bot filled the form — pretend it worked, write nothing.
  if (String(formData.get("website") ?? "").trim().length > 0) {
    const name = String(formData.get("name") ?? "").trim() || "there";
    const phone = String(formData.get("phone") ?? "");
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    return { status: "success", result: { name, phone, cardUrl: `${appUrl}/c/none`, welcomeReward: null, repeatJoin: false } };
  }

  const admin = createSupabaseAdminClient();
  const { data: restaurant, error } = await admin.from("restaurants").select("id, name, phone_prefix, country, sms_from").eq("slug", slug).maybeSingle();
  if (error || !restaurant) return { status: "error", error: "We couldn't find this rewards programme." };

  const since = new Date(Date.now() - JOIN_THROTTLE_WINDOW_MS).toISOString();
  const { count: recentJoinCount, error: throttleError } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .gte("joined_at", since);
  if (throttleError) {
    console.error(throttleError);
    return { status: "error", error: "We couldn't finish that. Please try again." };
  }
  if ((recentJoinCount ?? 0) >= JOIN_THROTTLE_MAX) {
    if (recentJoinCount === JOIN_THROTTLE_MAX) {
      await admin.from("audit_log").insert({
        restaurant_id: restaurant.id,
        actor: "system",
        action: "join.throttled",
        detail: { count: recentJoinCount },
      });
    }
    return { status: "error", error: "We couldn't finish that. Please try again." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""), restaurant.phone_prefix);
  const consent = formData.get("consent") === "on"; const fieldErrors: NonNullable<JoinState["fieldErrors"]> = {};
  if (!name) fieldErrors.name = "Enter your first name.";
  if (!phone) fieldErrors.phone = "That number doesn't look right.";
  if (!consent) fieldErrors.consent = "Please agree before continuing.";
  const month = String(formData.get("birthdayMonth") ?? ""); const day = String(formData.get("birthdayDay") ?? "");
  const birthdayMonth = month ? Number(month) : undefined;
  const birthdayDay = day ? Number(day) : undefined;
  if (birthdayMonth !== undefined && birthdayDay !== undefined && !isValidBirthday(birthdayMonth, birthdayDay)) {
    fieldErrors.birthday = "That's not a real date. Please check the month and day.";
  }
  if (Object.keys(fieldErrors).length) return { status: "error", fieldErrors };
  try {
    const joined = await joinMember({ restaurantId: restaurant.id, phone: phone!, name, birthdayMonth, birthdayDay, consentVersion: consentVersionFor(restaurant.country), source: "self_scan", viaWebJoin: true });
    if (joined.optedOutBlocked) {
      // Web-join guard (Task B): this number opted out and the public form
      // can't verify who's holding it, so we refuse to reactivate. SMS START
      // is phone-verified by definition, so it stays the only rejoin route.
      const error = restaurant.sms_from
        ? `This number is opted out of texts from ${restaurant.name}. Text START to ${formatPhoneNational(restaurant.sms_from, restaurant.phone_prefix)} to rejoin.`
        : `This number is opted out of texts from ${restaurant.name}. Ask a member of staff to help you rejoin.`;
      return { status: "opted_out", error };
    }
    const cardUrl = await sendWelcomeCardLink(joined.member, restaurant);
    return { status: "success", result: { name: joined.member.name, phone: joined.member.phone, cardUrl, welcomeReward: joined.welcomeGrant?.rewardText ?? null, repeatJoin: joined.repeatJoin } };
  } catch (caught) {
    if (caught instanceof JoinCapExceededError) return { status: "error", error: "Too many joins from this number today. Ask staff for help." };
    if (caught instanceof SuppressedPhoneError) {
      // Erased-while-opted-out number. The member row is gone, so SMS START
      // cannot rejoin it either; staff (white-glove) is the only route back.
      return { status: "opted_out", error: `This number previously opted out of texts from ${restaurant.name}. Ask a member of staff to help you rejoin.` };
    }
    console.error(caught); return { status: "error", error: "We couldn't finish that. Please try again." };
  }
}
