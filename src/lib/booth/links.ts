import "server-only";
import { sendTransactional } from "@/lib/sms/dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getMessageTemplates } from "./settings-data";
import { renderTemplate, withStopSuffix } from "./template";
import type { Member } from "./types";
import { newMagicToken, sha256Hex } from "./tokens";

type LinkRestaurant = { id: string; name: string; sms_from?: string | null };

export async function createMemberCardLink(memberId: string): Promise<string> {
  const rawToken = newMagicToken();
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("magic_tokens").insert({
    token_hash: sha256Hex(rawToken), member_id: memberId,
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_APP_URL must be set");
  return `${baseUrl.replace(/\/$/, "")}/c/${rawToken}`;
}

export async function sendMemberCardLink(member: Member, restaurant: LinkRestaurant): Promise<string> {
  const link = await createMemberCardLink(member.id);
  const result = await sendTransactional({
    restaurantId: restaurant.id,
    memberId: member.id,
    body: `${restaurant.name}: your rewards card → ${link}  Reply STOP to opt out.`,
  });
  if (result.status === "failed") throw new Error(result.error ?? "Could not send member card link");
  return link;
}

/**
 * Join-flow-only sibling of sendMemberCardLink: same link-minting, but the
 * body honors the owner's `message_templates.welcome` override (vars
 * {restaurant} {link}) when set, falling back to sendMemberCardLink's exact
 * generic wording otherwise. Kept separate from sendMemberCardLink itself
 * because that function is also used for the inbound CARD/re-send path
 * (src/app/api/sms/inbound/route.ts), which is a resend, not a welcome, and
 * must never pick up welcome-specific copy.
 */
export async function sendWelcomeCardLink(member: Member, restaurant: LinkRestaurant): Promise<string> {
  const link = await createMemberCardLink(member.id);
  const templates = await getMessageTemplates(restaurant.id);
  const body = withStopSuffix(
    templates.welcome
      ? renderTemplate(templates.welcome, { restaurant: restaurant.name, link })
      : `${restaurant.name}: your rewards card → ${link}`
  );
  const result = await sendTransactional({ restaurantId: restaurant.id, memberId: member.id, body });
  if (result.status === "failed") throw new Error(result.error ?? "Could not send welcome card link");
  return link;
}
