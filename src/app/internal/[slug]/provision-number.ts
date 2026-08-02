import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getProvisioner } from "@/lib/sms/provisioning";

export type ProvisionResult = { ok: true; phoneNumber: string } | { ok: false; reason: string };

export const PROVIDER_UNCONFIGURED_MESSAGE = "Provider account not connected yet — see RUNBOOK step 0.";

/**
 * One-touch UK number provisioning: search -> purchase -> write
 * restaurants.sms_from -> audit_log. A no-op (returns the existing number)
 * if sms_from is already set. Never throws — every failure mode (provider
 * account not connected, RC bundle env missing, provider API error) comes
 * back as a `reason` string so callers can surface it inline, including
 * best-effort callers (the generator apply flow) that must not fail on a
 * provisioning failure.
 *
 * Lives outside actions.ts (a "use server" file, which may only export async
 * functions) so it can also export the ProvisionResult type + the
 * PROVIDER_UNCONFIGURED_MESSAGE constant, and so it's importable/mockable in
 * isolation for the unit test.
 */
export async function provisionNumber(restaurantId: string): Promise<ProvisionResult> {
  // Both are external-blocker prerequisites (docs/RUNBOOK-WHITE-GLOVE.md step 0)
  // — check before touching the DB so an unconfigured account never issues a
  // stray query.
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_UK_BUNDLE_SID) {
    return { ok: false, reason: PROVIDER_UNCONFIGURED_MESSAGE };
  }

  const admin = createSupabaseAdminClient();
  const { data: restaurant, error } = await admin
    .from("restaurants")
    .select("id, sms_from")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!restaurant) return { ok: false, reason: "Restaurant not found." };
  if (restaurant.sms_from) return { ok: true, phoneNumber: restaurant.sms_from };

  try {
    const provisioner = getProvisioner();
    const [candidate] = await provisioner.searchUkMobile(1);
    if (!candidate) return { ok: false, reason: "No UK mobile numbers available right now." };

    const { providerNumberSid } = await provisioner.purchase(candidate.phoneNumber);

    const { error: updateError } = await admin
      .from("restaurants")
      .update({ sms_from: candidate.phoneNumber })
      .eq("id", restaurantId);
    if (updateError) return { ok: false, reason: updateError.message };

    await admin.from("audit_log").insert({
      restaurant_id: restaurantId,
      actor: "system",
      action: "number.provisioned",
      detail: { phone_number: candidate.phoneNumber, provider_sid: providerNumberSid },
    });

    return { ok: true, phoneNumber: candidate.phoneNumber };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    // Belt-and-braces: TwilioProvisioner.assertConfigured() throws its own
    // "not configured" error if envs got cleared between the check above and here.
    return { ok: false, reason: message.includes("not configured") ? PROVIDER_UNCONFIGURED_MESSAGE : message };
  }
}
