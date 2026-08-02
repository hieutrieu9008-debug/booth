"use server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getMemberSession, type MemberSession } from "../../c/[token]/data";
import { notifyNewGrants } from "@/lib/booth/engine";
import { isOpenNow, todayHoursLabel, type OpenHours } from "@/lib/booth/open-hours";
import { InvalidSelfScanTokenError, recordVisit } from "@/lib/booth/scan";

export type CheckInResult =
  | { kind: "checked_in"; memberName: string; progressLabel: string | null }
  | { kind: "already_today"; memberName: string }
  | { kind: "closed"; hoursLabel: string }
  | { kind: "no_session" }
  | { kind: "wrong_tenant" }
  | { kind: "invalid_code" };

/** GET-time result: either every guard passed and the diner just needs to tap confirm, or one of CheckInResult's terminal (non-mutating) states. */
export type CheckInValidation = { kind: "ready" } | CheckInResult;

type RestaurantForCheckIn = {
  id: string;
  name: string;
  timezone: string;
  visit_mode: string;
  self_scan_token: string | null;
  open_hours: OpenHours | null;
};

async function getRestaurantBySlugForCheckIn(slug: string): Promise<RestaurantForCheckIn | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurants")
    .select("id, name, timezone, visit_mode, self_scan_token, open_hours")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as RestaurantForCheckIn | null;
}

/**
 * Every guard EXCEPT the actual visit mutation (Codex #1): token, tenant
 * cookie, open hours. Safe to call on a GET request — link-preview bots,
 * prefetches, and page refreshes never touch this from a POST boundary, so
 * calling it repeatedly can never stamp a visit. Only `confirmCheckIn`
 * (below, driven from the diner's explicit tap) goes on to mutate.
 */
async function validateCheckIn(
  slug: string,
  token: string,
  session: MemberSession | null,
): Promise<{ kind: "ready"; restaurant: RestaurantForCheckIn; session: MemberSession } | CheckInResult> {
  const restaurant = await getRestaurantBySlugForCheckIn(slug);
  if (!restaurant) return { kind: "invalid_code" };
  if (restaurant.visit_mode === "staff_scan" || !restaurant.self_scan_token) return { kind: "invalid_code" };
  if (token !== restaurant.self_scan_token) return { kind: "invalid_code" };

  if (!session) return { kind: "no_session" };
  if (session.restaurantId !== restaurant.id) return { kind: "wrong_tenant" };

  if (!isOpenNow(restaurant.open_hours, restaurant.timezone)) {
    return { kind: "closed", hoursLabel: todayHoursLabel(restaurant.open_hours, restaurant.timezone) };
  }

  return { kind: "ready", restaurant, session };
}

/** Wraps validateCheckIn with the real request's member-session cookie — the only entry point page.tsx's GET render should call. Never mutates. */
export async function validateCheckInAction(slug: string, token: string): Promise<CheckInValidation> {
  const session = await getMemberSession();
  const result = await validateCheckIn(slug, token, session);
  return result.kind === "ready" ? { kind: "ready" } : result;
}

/**
 * Core /v/[slug] check-in logic, factored out from the cookie-reading
 * wrapper below so tests can drive every guard with an explicit session
 * instead of a real request's cookies (see actions.test.ts). This is the
 * ONLY function in this module that records a visit — it must only ever be
 * reached from confirmCheckInAction's POST-backed Server Action (the
 * diner's explicit "I'm here" tap), never from page.tsx's GET render.
 */
export async function performCheckIn(
  slug: string,
  token: string,
  session: MemberSession | null
): Promise<CheckInResult> {
  const validation = await validateCheckIn(slug, token, session);
  if (validation.kind !== "ready") return validation;
  const { restaurant, session: activeSession } = validation;

  try {
    const result = await recordVisit({ selfScanToken: token, memberId: activeSession.memberId, source: "self_scan" });
    if (result.status === "member_not_found") return { kind: "invalid_code" };
    if (result.status === "already_today") {
      return { kind: "already_today", memberName: result.memberName ?? "" };
    }
    if (result.newGrants.length > 0) {
      // The visit is already committed above — a notification failure must
      // never fail the whole check-in and must never look like the visit
      // didn't happen (Codex #3). Log it (console.error + a best-effort
      // audit_log row) and still return the committed "checked_in" result.
      try {
        await notifyNewGrants({ id: activeSession.memberId }, restaurant, result.newGrants);
      } catch (notifyError) {
        console.error("notifyNewGrants failed after committed self check-in", notifyError);
        try {
          const admin = createSupabaseAdminClient();
          await admin.from("audit_log").insert({
            restaurant_id: restaurant.id,
            actor: "system",
            action: "check_in.notify_failed",
            detail: {
              member_id: activeSession.memberId,
              error: notifyError instanceof Error ? notifyError.message : String(notifyError),
            },
          });
        } catch (auditError) {
          console.error("audit_log insert also failed for check_in.notify_failed", auditError);
        }
      }
    }
    return { kind: "checked_in", memberName: result.memberName ?? "", progressLabel: result.progressDisplays[0]?.label ?? null };
  } catch (caught) {
    // resolveMemberId's self_scan_token cross-check (src/lib/booth/scan.ts) is
    // the actual server-side backstop — the checks above are a friendlier
    // early exit, not the only guard.
    if (caught instanceof InvalidSelfScanTokenError) return { kind: "invalid_code" };
    throw caught;
  }
}

/**
 * The diner's explicit "I'm here — check in" tap (Codex #1). Bound to
 * (slug, token) by the client confirm button and driven through
 * useActionState, so this only ever runs from a POST form submission — never
 * from rendering the page. Reads the real request's member-session cookie,
 * same as the old GET-time checkInAction used to.
 */
export async function confirmCheckInAction(
  slug: string,
  token: string,
  _prevState: CheckInResult | null,
  _formData: FormData,
): Promise<CheckInResult> {
  const session = await getMemberSession();
  return performCheckIn(slug, token, session);
}
