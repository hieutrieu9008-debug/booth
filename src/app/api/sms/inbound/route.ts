import { getProvider } from "@/lib/sms/provider";
import { sendComplianceReply } from "@/lib/sms/dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { recordConsentEvent, smsConsentPairFor, smsConsentVersionFor } from "@/lib/booth/consent";
import { sendMemberCardLink } from "@/lib/booth/links";
import type { Member } from "@/lib/booth/types";

/**
 * Provider-agnostic inbound SMS webhook. Handles the compliance-floor
 * commands (STOP/START/HELP) — hard-coded platform behavior, never
 * per-tenant-overridable (PRD). Every inbound message is logged to
 * `messages` regardless of command.
 */
const OPT_OUT_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const OPT_IN_KEYWORDS = new Set(["START", "UNSTOP"]);

export async function POST(req: Request) {
  const provider = getProvider();
  const raw = await req.text();

  if (!(await provider.verifyWebhook(req, raw))) {
    return new Response("Forbidden", { status: 403 });
  }

  const inbound = provider.parseInbound(raw, req.headers.get("content-type"));
  if (!inbound) {
    return new Response("Bad Request", { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  // Keyword matching is carrier-standard first-word semantics: only the
  // message's first word is compared against the keyword list, so "please
  // stop" does NOT opt out (first word is PLEASE) while "stop sending me
  // these" does (first word is STOP). Phone autocorrect routinely adds
  // punctuation to that first word ("Stop!", "STOP.") so we strip leading
  // and trailing non-alphanumeric characters before comparing, without
  // touching interior characters.
  const rawFirstWord = inbound.body.trim().split(/\s+/)[0] ?? "";
  const firstWord = rawFirstWord.toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");

  const { data: restaurant } = await admin
    .from("restaurants")
    .select("id, name, country")
    .eq("sms_from", inbound.to)
    .maybeSingle();

  let restaurantId: string | null = restaurant?.id ?? null;
  let restaurantName = restaurant?.name ?? "Booth";
  let memberId: string | null = null;

  if (OPT_OUT_KEYWORDS.has(firstWord)) {
    if (restaurant) {
      const { data: member } = await admin
        .from("members")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("phone", inbound.from)
        .maybeSingle();
      if (member) {
        memberId = member.id;
        await admin
          .from("members")
          .update({ opted_out: true, opted_out_ts: new Date().toISOString() })
          .eq("id", member.id);
        await admin.from("audit_log").insert({
          restaurant_id: restaurant.id,
          actor: "system",
          action: "member.stop",
          detail: { member_id: member.id, phone: inbound.from },
        });
        // Version+wording always travel as one pair (smsConsentPairFor) so
        // the tag can never point at language it doesn't describe.
        const stopPair = smsConsentPairFor(restaurant.country, restaurant.name);
        await recordConsentEvent(admin, {
          restaurantId: restaurant.id,
          memberId: member.id,
          action: "optout_sms",
          consentVersion: stopPair.version,
          wording: stopPair.wording,
          source: "sms_inbound",
        });
      }
    } else {
      // Shared-number fallback: no restaurant owns this sending number, so
      // opt the phone number out platform-wide across every member row.
      const { data: members } = await admin.from("members").select("id, restaurant_id").eq("phone", inbound.from);
      // Review finding #3: these STOPs must land in consent_events too, not
      // just audit_log — batch-fetch each member's restaurant for the
      // country/name the wording snapshot needs.
      const fallbackRestaurantIds = [...new Set((members ?? []).map((m) => m.restaurant_id))];
      const { data: fallbackRestaurants } = fallbackRestaurantIds.length
        ? await admin.from("restaurants").select("id, name, country").in("id", fallbackRestaurantIds)
        : { data: [] };
      const restaurantById = new Map((fallbackRestaurants ?? []).map((r) => [r.id, r]));
      for (const m of members ?? []) {
        await admin
          .from("members")
          .update({ opted_out: true, opted_out_ts: new Date().toISOString() })
          .eq("id", m.id);
        await admin.from("audit_log").insert({
          restaurant_id: m.restaurant_id,
          actor: "system",
          action: "member.stop",
          detail: { member_id: m.id, phone: inbound.from },
        });
        const r = restaurantById.get(m.restaurant_id);
        if (r) {
          const pair = smsConsentPairFor(r.country, r.name);
          await recordConsentEvent(admin, {
            restaurantId: m.restaurant_id,
            memberId: m.id,
            action: "optout_sms",
            consentVersion: pair.version,
            wording: pair.wording,
            source: "sms_inbound",
          });
        }
      }
      if (members && members.length > 0) {
        memberId = members[0].id;
        restaurantId = members[0].restaurant_id;
      }
    }

    if (restaurantId) {
      restaurantName = restaurant?.name ?? restaurantName;
      await logInbound(admin, { restaurantId, memberId, body: inbound.body });
      await sendComplianceReply({
        restaurantId,
        memberId,
        to: inbound.from,
        from: inbound.to,
        body: `${restaurantName}: you're opted out and won't get more texts. Reply START to rejoin.`,
      });
    }
    return new Response("OK", { status: 200 });
  }

  if (OPT_IN_KEYWORDS.has(firstWord)) {
    if (restaurant) {
      const { data: member } = await admin
        .from("members")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("phone", inbound.from)
        .maybeSingle();
      if (member) {
        memberId = member.id;
        await admin
          .from("members")
          .update({
            opted_out: false,
            // Re-consent clears the opt-out flag/timestamp so the member can
            // be messaged again; the audit_log row for the original STOP is
            // left untouched — that's the historical record, not live state.
            opted_out_ts: null,
            consent_ts: new Date().toISOString(),
            consent_version: smsConsentVersionFor(restaurant.country),
          })
          .eq("id", member.id);
        const startPair = smsConsentPairFor(restaurant.country, restaurant.name);
        await recordConsentEvent(admin, {
          restaurantId: restaurant.id,
          memberId: member.id,
          action: "optin_sms",
          consentVersion: startPair.version,
          wording: startPair.wording,
          source: "sms_inbound",
        });
      }
      await logInbound(admin, { restaurantId: restaurant.id, memberId, body: inbound.body });
    }
    return new Response("OK", { status: 200 });
  }

  if (firstWord === "CARD" || firstWord === "LINK") {
    let member: Member | null = null;

    if (restaurant) {
      const { data } = await admin
        .from("members")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("phone", inbound.from)
        .maybeSingle();
      member = (data as Member | null) ?? null;
      memberId = member?.id ?? null;
      await logInbound(admin, { restaurantId: restaurant.id, memberId, body: inbound.body });
    } else {
      // Shared-number fallback, same idiom as the generic HELP catch-all
      // below: only resolve a restaurant when the phone maps unambiguously
      // to exactly one member row.
      const { data: members } = await admin.from("members").select("*").eq("phone", inbound.from);
      if (members && members.length === 1) {
        member = members[0] as Member;
        memberId = member.id;
        restaurantId = member.restaurant_id;
        const { data: resolvedRestaurant } = await admin
          .from("restaurants")
          .select("name")
          .eq("id", member.restaurant_id)
          .maybeSingle();
        restaurantName = resolvedRestaurant?.name ?? restaurantName;
        await logInbound(admin, { restaurantId: member.restaurant_id, memberId, body: inbound.body });
      }
      // If neither resolves, skip logging AND skip the reply below — same as
      // the generic HELP catch-all's unattributable-message case.
    }

    if (restaurantId && member && !member.opted_out) {
      await sendMemberCardLink(member, { id: restaurantId, name: restaurantName });
    } else if (restaurantId) {
      await sendComplianceReply({
        restaurantId,
        memberId,
        to: inbound.from,
        from: inbound.to,
        body: member?.opted_out
          ? `${restaurantName}: you're opted out, so we can't text a card link. Reply START to rejoin first.`
          : `${restaurantName}: we couldn't find a rewards card for this number. Ask staff, or join at the door.`,
      });
    }
    return new Response("OK", { status: 200 });
  }

  // HELP (explicit keyword, punctuation-tolerant) or anything else
  // unrecognized — same resolution logic either way, only the reply text
  // differs below.
  if (restaurant) {
    const { data: member } = await admin
      .from("members")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("phone", inbound.from)
      .maybeSingle();
    memberId = member?.id ?? null;
    await logInbound(admin, { restaurantId: restaurant.id, memberId, body: inbound.body });
  } else {
    // No restaurant resolved by sms_from — fall back to the member's own
    // restaurant if the phone number matches exactly one member row.
    const { data: members } = await admin.from("members").select("id, restaurant_id").eq("phone", inbound.from);
    if (members && members.length === 1) {
      const resolvedRestaurantId: string = members[0].restaurant_id;
      memberId = members[0].id;
      restaurantId = resolvedRestaurantId;
      // Unlike the shared-number STOP fallback (which may span several
      // restaurants and can't pick one brand), this match is unambiguous —
      // load the real name instead of leaving the generic "Booth" default.
      const { data: resolvedRestaurant } = await admin
        .from("restaurants")
        .select("name")
        .eq("id", resolvedRestaurantId)
        .maybeSingle();
      restaurantName = resolvedRestaurant?.name ?? restaurantName;
      await logInbound(admin, { restaurantId: resolvedRestaurantId, memberId, body: inbound.body });
    }
    // If neither resolves, skip logging AND skip the reply below — a
    // message we can't attribute to a restaurant can't be logged either.
  }

  if (restaurantId) {
    // HELP gets the genuinely helpful reply (names the restaurant, points to
    // the CARD resend path above, and STOP); the generic catch-all for
    // anything else unrecognized keeps its existing terse copy unchanged.
    const body =
      firstWord === "HELP"
        ? `${restaurantName}: rewards programme. Reply CARD to get your card link. Reply STOP to opt out.`
        : `${restaurantName}: rewards programme. Reply STOP to opt out.`;
    await sendComplianceReply({
      restaurantId,
      memberId,
      to: inbound.from,
      from: inbound.to,
      body,
    });
  }

  return new Response("OK", { status: 200 });
}

async function logInbound(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  args: { restaurantId: string; memberId: string | null; body: string },
) {
  await admin.from("messages").insert({
    restaurant_id: args.restaurantId,
    member_id: args.memberId,
    direction: "inbound",
    kind: "transactional",
    body: args.body,
    status: "received",
  });
}
